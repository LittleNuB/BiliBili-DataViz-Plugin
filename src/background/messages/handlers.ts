import type { BiliVizRequest, BiliVizContentMessage, BiliVizResponse, PlayerActionPayload, PlayerHeartbeatPayload, RequestAction, SyncNowResult } from '../../shared/types/messages';
import type { HistorySyncStatus } from '../../shared/types/history-sync';
import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
  CurrentVideoNoContext,
  CurrentVideoSubtitleSourceState,
} from '../../shared/types/current-video-context';
import type { CurrentVideoTranscriptEvidenceState } from '../../shared/types/current-video-transcript';
import type {
  CurrentVideoSegmentRetrievalResult,
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from '../../shared/types/current-video-segment-retrieval';
import type { CurrentVideoRelatedFavoritesResponse } from '../../shared/types/current-video-related-favorites';
import type { CurrentVideoSummaryResult } from '../../shared/types/current-video-summary';
import type { VideoKnowledgeJumpResponse, VideoKnowledgeResult } from '../../shared/types/video-knowledge';
import type { DynamicBillFeedbackScope, DynamicBillStatusFilter } from '../../shared/types/dynamic-bill';
import type { SmartIndexResult } from '../../shared/types/favorite';
import type { SmartFavoriteIndexRebuildResult } from '../../shared/types/local-data-privacy';
import { normalizePageLimit, runInitialBackfill } from '../sync/initial-backfill';
import { probeHistoryTailCoverage } from '../sync/history-tail-probe';
import {
  saveConfig,
  getLastSyncTime,
  getHistorySyncing,
  getHistorySyncProgress,
  getBackfillComplete,
  loadConfig,
  requestHistorySyncCancel,
  clearOrphanedHistorySyncLock,
  setDeviceTypeMigrationComplete,
} from '../storage/config-store';
import { db } from '../storage/db';
import type { UserConfig } from '../../shared/types/config';
import { generateCurrentVideoSummary } from '../current-video-summary';
import {
  probeCurrentVideoSubtitleSource,
  withSubtitleSourceState,
} from '../current-video-subtitle-probe';
import { cacheCurrentVideoTranscriptEvidence } from '../current-video-transcript-cache';
import {
  buildCurrentVideoTranscriptEvidenceState,
  withTranscriptEvidenceState,
} from '../../shared/current-video-transcript-cache';
import {
  rewriteCurrentVideoSegmentQuery,
  searchCurrentVideoSegments,
} from '../../shared/current-video-segment-retrieval';
import { cancelledCurrentVideoSummary } from '../../shared/current-video-summary';
import { searchCurrentVideoSegmentsWithAiRerank } from '../current-video-segment-rerank';
import {
  buildCurrentVideoRelatedFavoritesHint,
  emptyCurrentVideoRelatedFavoritesResponse,
} from '../../shared/current-video-related-favorites';
import {
  blockedTimestampJumpResponse,
  blockedTimestampReturnResponse,
  formatTimestampJumpFailureReason,
} from '../../shared/current-video-timestamp-jump';
import { buildVideoKnowledgeResult, findVideoKnowledgeNode } from '../../shared/video-knowledge';
import {
  getQuickStats,
  getDashboardOverview,
  getPreferenceData,
  getCreatorData,
  getBehaviorData,
  getExperimentData,
  computeStoredHistoryAggregates,
} from '../analytics/engine';
import { getDeviceData } from '../analytics/device';
import { abortCurrentHistorySync, hasActiveHistorySyncAbortScope } from '../sync/sync-control';
import { syncFavorites } from '../favorites/sync';
import { probeFavoriteFolderGap } from '../favorites/folder-gap-probe';
import { buildSmartFavoriteIndex, getSmartFavoriteOverview, getSmartFavoritesByPath, searchSmartFavorites } from '../favorites/smart';
import { answerSmartFavoriteQuestion } from '../favorites/qa';
import { buildDynamicBillExplanations } from '../dynamic-bill/ai';
import { generateDynamicBillItems } from '../dynamic-bill/generator';
import { ensureDynamicBill013Migration } from '../dynamic-bill/migration';
import { DYNAMIC_BILL_STRATEGY } from '../dynamic-bill/strategy';
import { getDynamicOverview, syncDynamicBillUpdates } from '../dynamic-bill/sync';
import {
  extractBvidFromUrl,
  extractPageFromUrl,
  isBilibiliVideoUrl,
  resolveCurrentVideoTabState,
  type CurrentVideoTabSnapshot,
} from '../current-video-context-resolver';
import {
  clearSmartFavoriteIndex,
  countFavoriteItems,
} from '../storage/favorite-repo';
import {
  clearAllLocalData,
  clearCurrentVideoSubtitleCache,
  getLocalDataPrivacySummary,
} from '../storage/local-data-privacy-repo';
import {
  getDynamicBillFilterPreference,
  getDynamicBillItems,
  addDynamicBillFeedback,
  markDynamicBillItemOpened,
  markDynamicBillItemProcessed,
  markDynamicBillItemsConsumedByBvid,
  setDynamicBillFilterPreference,
} from '../storage/dynamic-bill-repo';
import {
  getCurrentVideoTranscriptEvidenceState,
  getCurrentVideoTranscriptSegments,
} from '../storage/current-video-transcript-repo';
import {
  clearTemporaryCurrentVideoTranscriptCacheForTab,
  retainTemporaryCurrentVideoTranscriptOwner,
  type CurrentVideoTemporaryTranscriptOwner,
} from '../current-video-temporary-transcript-cache.ts';
import { retainTemporaryTranscriptOwnerForContextSnapshot } from '../current-video-transcript-owner.ts';
import { testAiConnection } from '../ai/openai-compatible';

const EXPORT_PAGE_LIMIT_MAX = 1000;
const SUBTITLE_PROBE_CACHE_MS = 5 * 60 * 1000;
const DYNAMIC_BILL_MIGRATION_GATED_ACTIONS = new Set<RequestAction>([
  'GET_LOCAL_DATA_PRIVACY_SUMMARY',
  'GET_DYNAMIC_BILL_OVERVIEW',
  'SYNC_DYNAMIC_UPDATES',
  'GENERATE_DYNAMIC_BILL',
  'BUILD_DYNAMIC_BILL_EXPLANATIONS',
  'GET_DYNAMIC_BILL_ITEMS',
  'GET_DYNAMIC_BILL_FILTER',
  'UPDATE_DYNAMIC_BILL_FILTER',
  'ADD_DYNAMIC_BILL_FEEDBACK',
  'OPEN_DYNAMIC_BILL_VIDEO',
  'MARK_DYNAMIC_BILL_ITEM_PROCESSED',
]);
const currentVideoContexts = new Map<number, CurrentVideoContextResult>();
const currentVideoSubtitleProbes = new Map<string, CurrentVideoSubtitleSourceState>();
const currentVideoSubtitleProbeRequests = new Map<string, Promise<CurrentVideoSubtitleSourceState>>();
const PRIMARY_TEXT_SELECTION_NOT_READY_MESSAGE = '主要文本来源选择还在读取中，请稍等本页保存的选择读取完成后再试。';

interface CurrentVideoLookupOptions {
  forceContextRefresh?: boolean;
  forceSubtitleProbe?: boolean;
}

interface CurrentVideoContextLookupResult {
  tab: CurrentVideoTabSnapshot | null;
  context: CurrentVideoContextResult;
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner;
}

interface BilibiliVideoUrlIdentity {
  bvid: string;
  page: number;
}

export function setupMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle content script messages
    const contentMsg = message as BiliVizContentMessage;
    if (contentMsg.action && ['PLAYER_HEARTBEAT', 'PLAYER_ACTION', 'PAGE_NAVIGATION', 'CURRENT_VIDEO_CONTEXT_UPDATE'].includes(contentMsg.action)) {
      handleContentMessage(contentMsg, sender.tab?.id ?? 0, sender.tab?.url ?? null).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        sendResponse({ success: false, error: errorMessage(err) });
      });
      return true; // keep channel open
    }

    // Handle UI request messages
    const request = message as BiliVizRequest;
    if (request.action) {
      handleRequest(request, sender.tab?.id ?? null).then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: errorMessage(err) });
      });
      return true;
    }

    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    currentVideoContexts.delete(tabId);
    clearTemporaryCurrentVideoTranscriptCacheForTab(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const nextUrl = changeInfo.url;
    if (!nextUrl) return;
    currentVideoContexts.delete(tabId);
    clearTemporaryCurrentVideoTranscriptCacheForTab(tabId);
  });
}

async function handleContentMessage(
  msg: BiliVizContentMessage,
  tabId: number,
  senderTabUrl: string | null = null,
): Promise<void> {
  switch (msg.action) {
    case 'CURRENT_VIDEO_CONTEXT_UPDATE': {
      if (tabId > 0) {
        const context = msg.payload as CurrentVideoContextResult;
        if (context.kind !== 'video') {
          if (!senderTabUrl || !isBilibiliVideoUrl(senderTabUrl)) {
            currentVideoContexts.delete(tabId);
            clearTemporaryCurrentVideoTranscriptCacheForTab(tabId);
          }
          break;
        }
        if (!canAcceptCurrentVideoContextUpdate(context, senderTabUrl)) {
          break;
        }
        currentVideoContexts.set(tabId, context);
        if (context.cid) {
          retainTemporaryCurrentVideoTranscriptOwner({
            ownerTabId: tabId,
            bvid: context.bvid,
            cid: context.cid,
            page: context.currentPart.page,
          });
        } else {
          clearTemporaryCurrentVideoTranscriptCacheForTab(tabId);
        }
      }
      break;
    }
    case 'PLAYER_HEARTBEAT': {
      const p = msg.payload as PlayerHeartbeatPayload;
      await db.playerEvents.add({
        bvid: p.bvid,
        cid: p.cid,
        eventType: 'heartbeat',
        timestamp: Date.now(),
        currentTime: p.currentTime,
        duration: p.duration,
        playbackRate: p.playbackRate ?? 1,
        tabId,
      });
      await markConsumedFromPlayerEvent(p);
      break;
    }
    case 'PLAYER_ACTION': {
      const p = msg.payload as PlayerActionPayload;
      await db.playerEvents.add({
        bvid: p.bvid,
        cid: p.cid,
        eventType: p.action,
        timestamp: Date.now(),
        currentTime: p.currentTime,
        duration: p.duration,
        playbackRate: p.playbackRate ?? 1,
        seekFrom: p.seekFrom,
        seekTo: p.seekTo,
        tabId,
      });
      await markConsumedFromPlayerEvent(p);
      break;
    }
    case 'PAGE_NAVIGATION':
      currentVideoContexts.delete(tabId);
      clearTemporaryCurrentVideoTranscriptCacheForTab(tabId);
      break;
  }
}

function canAcceptCurrentVideoContextUpdate(
  context: CurrentVideoContext,
  senderTabUrl: string | null,
): boolean {
  const contextUrlIdentity = bilibiliVideoUrlIdentity(context.url);
  if (!contextUrlIdentity || !contextMatchesVideoUrlIdentity(context, contextUrlIdentity)) {
    return false;
  }

  if (!senderTabUrl) return true;
  const senderUrlIdentity = bilibiliVideoUrlIdentity(senderTabUrl);
  return Boolean(
    senderUrlIdentity
    && senderUrlIdentity.bvid === contextUrlIdentity.bvid
    && senderUrlIdentity.page === contextUrlIdentity.page,
  );
}

function bilibiliVideoUrlIdentity(url: string | null | undefined): BilibiliVideoUrlIdentity | null {
  if (!url || !isBilibiliVideoUrl(url)) return null;
  const bvid = extractBvidFromUrl(url);
  if (!bvid) return null;
  return {
    bvid,
    page: extractPageFromUrl(url),
  };
}

function contextMatchesVideoUrlIdentity(
  context: CurrentVideoContext,
  identity: BilibiliVideoUrlIdentity,
): boolean {
  return context.bvid === identity.bvid
    && context.currentPart.page === identity.page;
}

async function handleRequest<T>(
  request: BiliVizRequest,
  requestTabId: number | null,
): Promise<BiliVizResponse<T>> {
  if (DYNAMIC_BILL_MIGRATION_GATED_ACTIONS.has(request.action)) {
    await ensureDynamicBill013Migration();
  }
  switch (request.action) {
    case 'GET_QUICK_STATS':
      return { success: true, data: await getQuickStats() as T };
    case 'GET_DASHBOARD_DATA':
      return { success: true, data: await getDashboardOverview() as T };
    case 'GET_PREFERENCE_DATA':
      return { success: true, data: await getPreferenceData(request.params) as T };
    case 'GET_CREATOR_DATA':
      return { success: true, data: await getCreatorData() as T };
    case 'GET_BEHAVIOR_DATA':
      return { success: true, data: await getBehaviorData() as T };
    case 'GET_EXPERIMENT_DATA':
      return { success: true, data: await getExperimentData() as T };
    case 'GET_DEVICE_DATA':
      return { success: true, data: await getDeviceData() as T };
    case 'SYNC_NOW':
      {
        const requestedMode = request.params?.mode === 'full' ? 'full' : request.params?.mode === 'incremental' ? 'incremental' : null;
        const requestedMaxPages = Number(request.params?.maxPages);
        const maxPages = Number.isFinite(requestedMaxPages) ? requestedMaxPages : undefined;
        const normalizedMaxPages = normalizePageLimit(maxPages);
        const storedCount = await db.watchHistory.count();
        const mode = requestedMode ?? (storedCount === 0 ? 'full' : 'incremental');
        if (await getHistorySyncing()) {
          throw new Error('HISTORY_SYNC_IN_PROGRESS');
        }

        void runInitialBackfill(mode, requestedMode === 'full', { maxPages })
          .then(async (result) => {
            await setDeviceTypeMigrationComplete();
            await computeStoredHistoryAggregates(result);
          })
          .catch((err) => {
            console.error('[BiliViz] Manual history sync failed:', err);
          });

        return {
          success: true,
          data: {
            synced: true,
            mode,
            requestedPageLimit: maxPages ?? null,
            pageLimit: normalizedMaxPages,
            currentTask: 'sync_started',
            fetchedPages: 0,
            fetchedCount: 0,
            insertedCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            duplicateCount: 0,
            unsupportedBusinessCount: 0,
            liveExcludedCount: 0,
            missingIdCount: 0,
            stoppedReason: 'sync_started',
            reachedEnd: false,
            oldestFetchedAt: null,
            newestFetchedAt: null,
            finalCursor: null,
          } satisfies SyncNowResult as T,
        };
      }
    case 'CANCEL_SYNC':
      await requestHistorySyncCancel();
      abortCurrentHistorySync();
      return { success: true };
    case 'GET_CONFIG':
      return { success: true, data: await loadConfig() as T };
    case 'UPDATE_CONFIG':
      await saveConfig(request.params as Partial<UserConfig>);
      return { success: true };
    case 'EXPORT_DATA': {
      const allRecords = await db.watchHistory.toArray();
      const format = (request.params?.format as string) ?? 'json';
      return { success: true, data: { records: allRecords, format } as T };
    }
    case 'EXPORT_DATA_PAGE': {
      const offset = normalizeNonNegativeInteger(request.params?.offset, 0);
      const limit = Math.max(1, Math.min(normalizeNonNegativeInteger(request.params?.limit, 500), EXPORT_PAGE_LIMIT_MAX));
      const [records, total] = await Promise.all([
        db.watchHistory.orderBy('viewAt').offset(offset).limit(limit).toArray(),
        db.watchHistory.count(),
      ]);
      const nextOffset = offset + records.length;
      return {
        success: true,
        data: {
          records,
          total,
          offset,
          nextOffset,
          hasMore: nextOffset < total,
        } as T,
      };
    }
    case 'GET_SYNC_STATUS': {
      if (await getHistorySyncing() && !hasActiveHistorySyncAbortScope()) {
        await clearOrphanedHistorySyncLock();
      }
      const lastSync = await getLastSyncTime();
      const count = await db.watchHistory.count();
      const [syncProgress, backfillComplete] = await Promise.all([
        getHistorySyncProgress(),
        getBackfillComplete(),
      ]);
      return {
        success: true,
        data: {
          lastSyncTime: lastSync,
          totalRecords: count,
          backfillComplete,
          syncProgress,
        } satisfies HistorySyncStatus as T,
      };
    }
    case 'PROBE_HISTORY_TAIL': {
      const requestedMaxPages = Number(request.params?.maxPages);
      if (await getHistorySyncing()) {
        throw new Error('HISTORY_SYNC_IN_PROGRESS');
      }
      return {
        success: true,
        data: await probeHistoryTailCoverage({
          maxPages: Number.isFinite(requestedMaxPages) ? requestedMaxPages : undefined,
        }) as T,
      };
    }
    case 'TEST_AI_CONNECTION':
      return { success: true, data: await testAiConnection(normalizeAiConfigParam(request.params?.ai)) as T };
    case 'GET_LOCAL_DATA_PRIVACY_SUMMARY':
      return { success: true, data: await getLocalDataPrivacySummary() as T };
    case 'CLEAR_CURRENT_VIDEO_SUBTITLE_CACHE':
      return { success: true, data: await clearCurrentVideoSubtitleCache() as T };
    case 'REBUILD_SMART_FAVORITE_INDEX':
      return { success: true, data: await rebuildSmartFavoriteIndex(request.params) as T };
    case 'CLEAR_ALL_LOCAL_DATA':
      return { success: true, data: await clearAllLocalData(request.params?.confirmation) as T };
    case 'GET_CURRENT_VIDEO_CONTEXT':
      return { success: true, data: await getCurrentVideoContextForActiveTab(currentVideoLookupOptions(request.params), requestTabId) as T };
    case 'PROBE_CURRENT_VIDEO_SUBTITLE_SOURCE':
      return { success: true, data: await probeSubtitleSourceForActiveTab(request.params, requestTabId) as T };
    case 'GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE':
      return { success: true, data: await getTranscriptEvidenceForActiveTab(request.params, requestTabId) as T };
    case 'GET_CURRENT_VIDEO_SUMMARY': {
      if (!primaryTextSelectionsReady(request.params)) {
        return { success: true, data: primaryTextSelectionNotReadySummary() as T };
      }
      const lookup = await getCurrentVideoContextLookupWithSelection(request.params, requestTabId);
      const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(lookup.context, lookup.temporaryOwner);
      return { success: true, data: await generateCurrentVideoSummary(lookup.context, { transcriptSegments }) as T };
    }
    case 'GET_VIDEO_KNOWLEDGE': {
      if (!primaryTextSelectionsReady(request.params)) {
        return { success: true, data: primaryTextSelectionNotReadyKnowledge() as T };
      }
      const lookup = await getCurrentVideoContextLookupWithSelection(request.params, requestTabId);
      const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(lookup.context, lookup.temporaryOwner);
      return { success: true, data: buildVideoKnowledgeResult(lookup.context, { transcriptSegments }) as T };
    }
    case 'SEARCH_CURRENT_VIDEO_SEGMENTS': {
      const query = String(request.params?.query ?? '');
      if (!primaryTextSelectionsReady(request.params)) {
        return { success: true, data: primaryTextSelectionNotReadySegmentResult(query) as T };
      }
      const lookup = await getCurrentVideoContextLookupWithSelection(request.params, requestTabId);
      const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(lookup.context, lookup.temporaryOwner);
      const videoKnowledge = buildVideoKnowledgeResult(lookup.context, { transcriptSegments });
      return {
        success: true,
        data: await searchCurrentVideoSegmentsWithAiRerank(lookup.context, {
          query,
          transcriptSegments,
          videoKnowledge,
        }) as T,
      };
    }
    case 'GET_CURRENT_VIDEO_RELATED_FAVORITES': {
      const context = await getCurrentVideoContextForActiveTab();
      return {
        success: true,
        data: await getCurrentVideoRelatedFavorites(context, request.params) as T,
      };
    }
    case 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP':
      return { success: true, data: await requestCurrentVideoSegmentJump(request.params, requestTabId) as T };
    case 'RETURN_CURRENT_VIDEO_SEGMENT_JUMP':
      return { success: true, data: await returnCurrentVideoSegmentJump(requestTabId) as T };
    case 'REQUEST_VIDEO_KNOWLEDGE_JUMP':
      return { success: true, data: await requestVideoKnowledgeJump(request.params) as T };
    case 'GET_SMART_FAVORITES':
      return { success: true, data: await getSmartFavoriteOverview() as T };
    case 'GET_SMART_FAVORITES_BY_PATH': {
      const rawPath = request.params?.path;
      const path = Array.isArray(rawPath)
        ? rawPath.map(part => String(part))
        : String(rawPath ?? '').split('/').map(part => part.trim()).filter(Boolean);
      const limit = Number(request.params?.limit);
      return {
        success: true,
        data: await getSmartFavoritesByPath(path, Number.isFinite(limit) ? limit : undefined) as T,
      };
    }
    case 'SYNC_FAVORITES':
      return { success: true, data: await syncFavorites() as T };
    case 'PROBE_FAVORITE_FOLDER_GAP': {
      const mediaId = normalizePositiveInteger(request.params?.mediaId, 0);
      if (mediaId <= 0) {
        throw new Error('INVALID_FAVORITE_MEDIA_ID');
      }
      const maxPages = Math.min(normalizePositiveInteger(request.params?.maxPages, 12), 50);
      return {
        success: true,
        data: await probeFavoriteFolderGap(mediaId, maxPages) as T,
      };
    }
    case 'BUILD_SMART_FAVORITE_INDEX': {
      const maxItems = Number(request.params?.maxItems);
      const includeFailed = request.params?.includeFailed === true;
      const failedOnly = request.params?.failedOnly === true;
      return {
        success: true,
        data: await buildSmartFavoriteIndex(
          Number.isFinite(maxItems) ? maxItems : undefined,
          { includeFailed, failedOnly },
        ) as T,
      };
    }
    case 'SEARCH_SMART_FAVORITES': {
      const query = String(request.params?.query ?? '');
      const limit = Number(request.params?.limit);
      return {
        success: true,
        data: await searchSmartFavorites(query, Number.isFinite(limit) ? limit : undefined) as T,
      };
    }
    case 'ASK_SMART_FAVORITES': {
      const query = String(request.params?.query ?? '');
      const limit = Number(request.params?.limit);
      return {
        success: true,
        data: await answerSmartFavoriteQuestion(query, Number.isFinite(limit) ? limit : undefined) as T,
      };
    }
    case 'GET_DYNAMIC_BILL_OVERVIEW':
      return { success: true, data: await getDynamicOverview() as T };
    case 'SYNC_DYNAMIC_UPDATES':
      return { success: true, data: await syncDynamicBillUpdates() as T };
    case 'GENERATE_DYNAMIC_BILL':
      return { success: true, data: await generateDynamicBillItems() as T };
    case 'BUILD_DYNAMIC_BILL_EXPLANATIONS': {
      const maxItems = normalizePositiveInteger(request.params?.maxItems, 6);
      const includeFailed = request.params?.includeFailed !== false;
      return {
        success: true,
        data: await buildDynamicBillExplanations({ maxItems, includeFailed }) as T,
      };
    }
    case 'GET_DYNAMIC_BILL_ITEMS':
      return { success: true, data: await getDynamicBillItems() as T };
    case 'GET_DYNAMIC_BILL_FILTER':
      return { success: true, data: await getDynamicBillFilterPreference() as T };
    case 'UPDATE_DYNAMIC_BILL_FILTER': {
      const status = normalizeDynamicBillStatusFilter(request.params?.status);
      return { success: true, data: await setDynamicBillFilterPreference(status) as T };
    }
    case 'ADD_DYNAMIC_BILL_FEEDBACK': {
      const billKey = requireStringParam(request.params?.billKey, 'billKey');
      const scope = normalizeDynamicBillFeedbackScope(request.params?.scope);
      return { success: true, data: await addDynamicBillFeedback(billKey, scope) as T };
    }
    case 'OPEN_DYNAMIC_BILL_VIDEO': {
      const billKey = requireStringParam(request.params?.billKey, 'billKey');
      const item = await markDynamicBillItemOpened(billKey);
      if (!item) throw new Error('DYNAMIC_BILL_ITEM_NOT_FOUND');
      await chrome.tabs.create({ url: videoUrl(item.evidence.newVideo.bvid) });
      return { success: true, data: item as T };
    }
    case 'MARK_DYNAMIC_BILL_ITEM_PROCESSED': {
      const billKey = requireStringParam(request.params?.billKey, 'billKey');
      const item = await markDynamicBillItemProcessed(billKey);
      if (!item) throw new Error('DYNAMIC_BILL_ITEM_NOT_FOUND');
      return { success: true, data: item as T };
    }
    default:
      return { success: false, error: `Unknown action: ${request.action}` };
  }
}

async function getCurrentVideoRelatedFavorites(
  context: CurrentVideoContextResult,
  params?: Record<string, unknown>,
): Promise<CurrentVideoRelatedFavoritesResponse> {
  const now = Date.now();
  if (context.kind !== 'video') {
    return emptyCurrentVideoRelatedFavoritesResponse(context, now);
  }

  const hint = buildCurrentVideoRelatedFavoritesHint(context, {
    question: typeof params?.question === 'string' ? params.question : null,
    summaryHint: typeof params?.summaryHint === 'string' ? params.summaryHint : null,
  });

  if (!hint.query) {
    return emptyCurrentVideoRelatedFavoritesResponse(context, now);
  }

  const requestedLimit = Number(params?.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 8))
    : 5;
  const favorites = await answerSmartFavoriteQuestion(hint.query, limit);

  return {
    status: 'ready',
    contextTitle: context.title,
    query: hint.query,
    hintSourceLabels: hint.sourceLabels,
    favorites,
    generatedAt: now,
    limitations: hint.limitations,
  };
}

async function requestVideoKnowledgeJump(params: Record<string, unknown> | undefined): Promise<VideoKnowledgeJumpResponse> {
  const nodeId = requireStringParam(params?.nodeId, 'nodeId');
  const confirmed = params?.confirmed === true;
  if (!confirmed) {
    return {
      ok: false,
      message: 'CONFIRMATION_REQUIRED',
      nodeId,
      previousPositionSeconds: null,
      targetSeconds: null,
      targetPage: null,
    };
  }

  const target = await resolveCurrentVideoLookupState();
  const tabId = target.tab?.id ?? 0;
  if (!target.tab?.url || tabId <= 0 || !isBilibiliVideoUrl(target.tab.url)) {
    throw new Error('NO_ACTIVE_BILIBILI_VIDEO_TAB');
  }

  if (target.context?.kind !== 'video') {
    throw new Error('VIDEO_CONTEXT_UNAVAILABLE');
  }
  const knowledge = buildVideoKnowledgeResult(target.context);
  const node = findVideoKnowledgeNode(knowledge, nodeId);
  if (!node || !node.jumpAction) {
    throw new Error('VIDEO_KNOWLEDGE_JUMP_TARGET_UNAVAILABLE');
  }

  return await chrome.tabs.sendMessage(tabId, {
    action: 'VIDEO_KNOWLEDGE_MANUAL_JUMP',
    payload: {
      node,
      contextBvid: target.context.bvid,
      confirmed: true,
    },
  });
}

async function requestCurrentVideoSegmentJump(
  params: Record<string, unknown> | undefined,
  requestTabId: number | null,
): Promise<CurrentVideoTimestampJumpResponse> {
  const candidateId = requireStringParam(params?.candidateId, 'candidateId');
  const query = requireStringParam(params?.query, 'query');
  const confirmed = params?.confirmed === true;
  if (!confirmed) {
    return blockedTimestampJumpResponse(
      candidateId,
      'confirmation_required',
      formatTimestampJumpFailureReason('confirmation_required'),
    );
  }
  if (!primaryTextSelectionsReady(params)) {
    return blockedTimestampJumpResponse(
      candidateId,
      'no_context',
      PRIMARY_TEXT_SELECTION_NOT_READY_MESSAGE,
    );
  }

  const lookup = await getCurrentVideoContextLookupWithSelection(params, requestTabId);
  const tabId = lookup.tab?.id ?? 0;
  if (!lookup.tab?.url || tabId <= 0 || !isBilibiliVideoUrl(lookup.tab.url)) {
    return blockedTimestampJumpResponse(
      candidateId,
      'no_context',
      formatTimestampJumpFailureReason('no_context'),
    );
  }

  const context = lookup.context;
  if (context.kind !== 'video') {
    return blockedTimestampJumpResponse(
      candidateId,
      'no_context',
      formatTimestampJumpFailureReason('no_context'),
    );
  }

  const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(context, lookup.temporaryOwner);
  const videoKnowledge = buildVideoKnowledgeResult(context, { transcriptSegments });
  const result = searchCurrentVideoSegments(context, {
    query,
    transcriptSegments,
    videoKnowledge,
  });
  const candidate = result.candidates.find(item => item.id === candidateId);
  if (!candidate) {
    const reason = result.status === 'stale_context'
      ? 'stale_context'
      : result.status === 'no_context'
        ? 'no_context'
        : 'candidate_not_found';
    return blockedTimestampJumpResponse(
      candidateId,
      reason,
      formatTimestampJumpFailureReason(reason),
    );
  }

  const preview = candidate.jumpPreview;
  if (!preview.canJump || preview.targetSeconds === null || preview.targetTimeLabel === null) {
    const reason = preview.disabledReason ?? 'invalid_timestamp';
    return blockedTimestampJumpResponse(candidateId, reason, preview.message);
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'CURRENT_VIDEO_TIMESTAMP_JUMP',
      payload: {
        candidateId,
        confirmed: true,
        contextBvid: context.bvid,
        contextCid: context.cid,
        contextPage: context.currentPart.page,
        contextUrl: context.url,
        contextCollectedAt: context.collectedAt,
        targetSeconds: preview.targetSeconds,
        targetTimeLabel: preview.targetTimeLabel,
        sourceLabel: preview.sourceLabel,
        confidence: preview.confidence,
        confidenceLabel: preview.confidenceLabel,
        evidencePreview: preview.evidencePreview,
      },
    });
    return response as CurrentVideoTimestampJumpResponse;
  } catch {
    return blockedTimestampJumpResponse(
      candidateId,
      'player_unavailable',
      formatTimestampJumpFailureReason('player_unavailable'),
    );
  }
}

async function returnCurrentVideoSegmentJump(
  requestTabId: number | null,
): Promise<CurrentVideoTimestampReturnResponse> {
  const target = await resolveCurrentVideoLookupState(requestTabId);
  const tabId = target.tab?.id ?? 0;
  if (!target.tab?.url || tabId <= 0 || !isBilibiliVideoUrl(target.tab.url)) {
    return blockedTimestampReturnResponse(formatTimestampJumpFailureReason('no_context'));
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'CURRENT_VIDEO_TIMESTAMP_RETURN',
      payload: {},
    });
    return response as CurrentVideoTimestampReturnResponse;
  } catch {
    return blockedTimestampReturnResponse(formatTimestampJumpFailureReason('player_unavailable'));
  }
}

async function markConsumedFromPlayerEvent(
  payload: PlayerHeartbeatPayload | PlayerActionPayload,
): Promise<void> {
  if (!payload.bvid || !isEffectivePlayerWatch(payload)) return;
  await markDynamicBillItemsConsumedByBvid(payload.bvid, Date.now());
}

async function getCurrentVideoContextForActiveTab(
  options: CurrentVideoLookupOptions = {},
  requestTabId: number | null = null,
): Promise<CurrentVideoContextResult> {
  return (await getCurrentVideoContextLookup(options, requestTabId)).context;
}

async function getCurrentVideoContextForActiveTabWithSelection(
  params: Record<string, unknown> | undefined,
  requestTabId: number | null = null,
): Promise<CurrentVideoContextResult> {
  return (await getCurrentVideoContextLookupWithSelection(params, requestTabId)).context;
}

async function getCurrentVideoContextLookupWithSelection(
  params: Record<string, unknown> | undefined,
  requestTabId: number | null = null,
): Promise<CurrentVideoContextLookupResult> {
  const lookup = await getCurrentVideoContextLookup(currentVideoLookupOptions(params), requestTabId);
  return {
    ...lookup,
    context: await bindSelectedCurrentVideoTranscriptEvidence(
      lookup.context,
      selectedSourceIdentityKey(params),
      lookup.temporaryOwner,
    ),
  };
}

async function getCurrentVideoContextLookup(
  options: CurrentVideoLookupOptions = {},
  requestTabId: number | null = null,
): Promise<CurrentVideoContextLookupResult> {
  const lookup = await getRawCurrentVideoContextLookup(options, requestTabId);
  if (lookup.context.kind !== 'video') return lookup;
  const withSubtitle = await enrichCurrentVideoContextWithSubtitleProbe(lookup.context, options);
  return {
    ...lookup,
    context: await enrichCurrentVideoContextWithTranscriptEvidence(withSubtitle, lookup.temporaryOwner),
  };
}

async function getRawCurrentVideoContextLookup(
  options: CurrentVideoLookupOptions = {},
  requestTabId: number | null = null,
): Promise<CurrentVideoContextLookupResult> {
  const { tab, context } = await resolveCurrentVideoLookupState(requestTabId);
  const url = tab?.url ?? null;
  let resolvedContext: CurrentVideoContextResult;

  if (!url || !isBilibiliVideoUrl(url)) {
    resolvedContext = buildNoContext(url, 'non_video_page', 'non_video');
  } else if (tab?.id && (options.forceContextRefresh || context?.kind !== 'video')) {
    const refreshed = await requestFreshCurrentVideoContext(tab.id, url);
    resolvedContext = refreshed ?? buildNoContext(url, 'video_context_unavailable', 'video');
  } else if (context?.kind === 'video') {
    resolvedContext = context;
  } else {
    resolvedContext = buildNoContext(url, 'video_context_unavailable', 'video');
  }

  return {
    tab,
    context: resolvedContext,
    temporaryOwner: retainTemporaryTranscriptOwnerForContextSnapshot(resolvedContext, tab?.id ?? null),
  };
}

async function probeSubtitleSourceForActiveTab(
  params: Record<string, unknown> | undefined,
  requestTabId: number | null = null,
): Promise<CurrentVideoSubtitleSourceState> {
  const options = currentVideoLookupOptions({
    ...params,
    forceSubtitleProbe: params?.force === true || params?.forceSubtitleProbe === true,
    forceContextRefresh: params?.force === true || params?.forceContextRefresh === true,
  });
  const context = await getCurrentVideoContextForActiveTab(options, requestTabId);
  if (context.kind === 'video' && context.subtitleProbe) {
    return context.subtitleProbe;
  }
  return await probeCurrentVideoSubtitleSource(context);
}

async function getTranscriptEvidenceForActiveTab(
  params: Record<string, unknown> | undefined,
  requestTabId: number | null = null,
): Promise<CurrentVideoTranscriptEvidenceState> {
  const lookup = await getRawCurrentVideoContextLookup(currentVideoLookupOptions(params), requestTabId);
  const requestedLanguage = typeof params?.language === 'string'
    ? params.language
    : null;
  return await cacheCurrentVideoTranscriptEvidence(lookup.context, {
    requestedLanguage,
    protectedSourceIdentityKeys: currentVideoProtectedSourceIdentityKeys(lookup.context, params),
    temporaryOwner: lookup.temporaryOwner,
  });
}

async function bindSelectedCurrentVideoTranscriptEvidence(
  context: CurrentVideoContextResult,
  sourceIdentityKey: string | null,
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner,
): Promise<CurrentVideoContextResult> {
  if (context.kind !== 'video' || !sourceIdentityKey || !context.cid) return context;
  const transcriptEvidence = await getCurrentVideoTranscriptEvidenceState({
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
    sourceIdentityKey,
  }, Date.now(), temporaryOwner);
  return withTranscriptEvidenceState(context, transcriptEvidence);
}

async function enrichCurrentVideoContextWithSubtitleProbe(
  context: CurrentVideoContext,
  options: CurrentVideoLookupOptions = {},
): Promise<CurrentVideoContext> {
  const cacheKey = subtitleProbeCacheKey(context);
  if (options.forceSubtitleProbe) {
    currentVideoSubtitleProbes.delete(cacheKey);
  }

  const existing = context.subtitleProbe;
  if (!options.forceSubtitleProbe && existing && Date.now() - existing.checkedAt < SUBTITLE_PROBE_CACHE_MS) {
    return withSubtitleSourceState(context, existing);
  }

  const cached = currentVideoSubtitleProbes.get(cacheKey);
  if (!options.forceSubtitleProbe && cached && Date.now() - cached.checkedAt < SUBTITLE_PROBE_CACHE_MS) {
    return withSubtitleSourceState(context, cached);
  }

  const existingRequest = currentVideoSubtitleProbeRequests.get(cacheKey);
  if (!options.forceSubtitleProbe && existingRequest) {
    const probe = await existingRequest;
    return withSubtitleSourceState(context, probe);
  }

  const request = probeCurrentVideoSubtitleSource(context).finally(() => {
    currentVideoSubtitleProbeRequests.delete(cacheKey);
  });
  currentVideoSubtitleProbeRequests.set(cacheKey, request);
  const probe = await request;
  currentVideoSubtitleProbes.set(cacheKey, probe);
  return withSubtitleSourceState(context, probe);
}

async function enrichCurrentVideoContextWithTranscriptEvidence(
  context: CurrentVideoContext,
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner,
): Promise<CurrentVideoContext> {
  if (!context.cid) {
    return withTranscriptEvidenceState(context, buildCurrentVideoTranscriptEvidenceState({
      status: 'unsupported',
      target: {
        bvid: context.bvid,
        cid: context.cid,
        page: context.currentPart.page,
      },
      now: Date.now(),
      reason: 'missing_cid',
      message: '当前视频缺少 CID，无法读取本地字幕正文证据状态。',
      warnings: ['cid_unknown'],
    }));
  }

  const state = await getCurrentVideoTranscriptEvidenceState({
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
  }, Date.now(), temporaryOwner);
  return withTranscriptEvidenceState(context, state);
}

async function getActiveCurrentVideoTranscriptSegments(
  context: CurrentVideoContextResult,
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner,
) {
  if (
    context.kind !== 'video'
    || !context.cid
    || context.transcriptEvidence?.active !== true
  ) {
    return [];
  }

  return await getCurrentVideoTranscriptSegments({
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
    language: context.transcriptEvidence.language,
    sourceIdentityKey: context.transcriptEvidence.sourceIdentityKey,
    sourceHash: context.transcriptEvidence.sourceHash,
  }, temporaryOwner);
}

function subtitleProbeCacheKey(context: CurrentVideoContext): string {
  return [
    context.bvid,
    context.cid ?? 'cid-unknown',
    context.currentPart.page,
  ].join(':');
}

async function requestFreshCurrentVideoContext(
  tabId: number,
  tabUrl: string,
): Promise<CurrentVideoContextResult | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'COLLECT_CURRENT_VIDEO_CONTEXT',
      payload: {},
    }) as CurrentVideoContextResult;
    if (response?.kind !== 'video') return response ?? null;
    if (!canAcceptCurrentVideoContextUpdate(response, tabUrl)) return null;
    currentVideoContexts.set(tabId, response);
    if (response.cid) {
      retainTemporaryCurrentVideoTranscriptOwner({
        ownerTabId: tabId,
        bvid: response.bvid,
        cid: response.cid,
        page: response.currentPart.page,
      });
    }
    return response;
  } catch {
    return null;
  }
}

function currentVideoLookupOptions(
  params: Record<string, unknown> | undefined,
): CurrentVideoLookupOptions {
  return {
    forceContextRefresh: params?.forceContextRefresh === true,
    forceSubtitleProbe: params?.forceSubtitleProbe === true,
  };
}

function primaryTextSelectionsReady(params: Record<string, unknown> | undefined): boolean {
  return params?.primaryTextSelectionsReady !== false
    && params?.primaryTextSelectionReady !== false;
}

function primaryTextSelectionNotReadySummary(now = Date.now()): CurrentVideoSummaryResult {
  return {
    ...cancelledCurrentVideoSummary(null, now),
    title: '主要文本来源尚未就绪',
    summary: PRIMARY_TEXT_SELECTION_NOT_READY_MESSAGE,
    missingSources: ['主要文本来源选择'],
    limitations: ['读取完成前不会使用当前可见字幕正文，也不会请求 AI。'],
    nextQuestions: [],
    ai: {
      status: 'not_requested',
      model: null,
      error: null,
      note: '主要文本来源选择尚未读取完成，因此没有请求 AI。',
    },
  };
}

function primaryTextSelectionNotReadyKnowledge(now = Date.now()): VideoKnowledgeResult {
  return {
    status: 'ready',
    title: '当前视频',
    generatedAt: now,
    sourceState: {
      metadata: false,
      description: false,
      pages: false,
      chapters: false,
      transcript: false,
      transcriptEvidence: false,
      contentText: false,
    },
    transcriptEvidence: null,
    nodes: [],
    warnings: ['primary_text_selection_not_ready'],
    limitations: [
      PRIMARY_TEXT_SELECTION_NOT_READY_MESSAGE,
      '读取完成前不会把当前可见字幕正文当作主要文本来源。',
    ],
  };
}

function primaryTextSelectionNotReadySegmentResult(
  query: string,
  now = Date.now(),
): CurrentVideoSegmentRetrievalResult {
  const normalizedQuery = String(query ?? '').trim();
  const queryRewrite = rewriteCurrentVideoSegmentQuery(normalizedQuery);
  return {
    status: 'no_evidence',
    query: normalizedQuery,
    normalizedQuery: queryRewrite.normalizedQuery,
    title: '当前视频',
    generatedAt: now,
    candidates: [],
    summary: PRIMARY_TEXT_SELECTION_NOT_READY_MESSAGE,
    limitations: [
      '主要文本来源选择读取完成前不会检索当前可见字幕正文。',
      '本次没有请求 AI，也没有读取历史、收藏、关注或本地敏感文件。',
    ],
    queryRewrite,
    evidenceState: {
      transcriptSegmentCount: 0,
      timedKnowledgeNodeCount: 0,
      metadataHintAvailable: false,
      contextFresh: false,
    },
    aiRerank: {
      status: 'not_requested',
      model: null,
      note: '主要文本来源选择尚未读取完成，因此没有请求 AI 重排。',
      error: null,
      generatedAt: now,
      payloadCandidateCount: 0,
      appliedCandidateIds: [],
      explanations: [],
    },
    qa: {
      status: 'insufficient_evidence',
      answer: PRIMARY_TEXT_SELECTION_NOT_READY_MESSAGE,
      confidence: 0,
      confidenceLabel: '低',
      citedSegments: [],
      sourceState: {
        transcriptSegmentCount: 0,
        timedKnowledgeNodeCount: 0,
        metadataHintAvailable: false,
        contextFresh: false,
        hasCitableEvidence: false,
        hasOnlyMetadataHints: false,
      },
      aiState: {
        status: 'not_requested',
        model: null,
        note: '主要文本来源选择尚未读取完成，因此没有请求 AI 整理回答。',
        error: null,
        generatedAt: now,
        payloadCandidateCount: 0,
        citedCandidateIds: [],
      },
      limitations: ['请等本页保存的主要文本来源选择读取完成后再提问。'],
    },
  };
}

function currentVideoProtectedSourceIdentityKeys(
  context: CurrentVideoContextResult,
  params: Record<string, unknown> | undefined,
): string[] {
  const keys = new Set<string>();
  const addKey = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      keys.add(value.trim());
    }
  };

  if (context.kind === 'video') {
    addKey(context.transcriptEvidence?.sourceIdentityKey);
  }
  addKey(params?.sourceIdentityKey);
  addKey(params?.selectedSourceIdentityKey);

  if (Array.isArray(params?.protectedSourceIdentityKeys)) {
    for (const key of params.protectedSourceIdentityKeys) {
      addKey(key);
    }
  }

  return Array.from(keys);
}

function selectedSourceIdentityKey(params: Record<string, unknown> | undefined): string | null {
  const value = params?.selectedSourceIdentityKey ?? params?.sourceIdentityKey;
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

async function resolveCurrentVideoLookupState(
  requestTabId: number | null = null,
): Promise<{
  tab: CurrentVideoTabSnapshot | null;
  context: CurrentVideoContextResult | null;
}> {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const tabs = windows.flatMap(window => (window.tabs ?? []).map(tab => ({
    id: tab.id ?? 0,
    url: tab.url ?? null,
    active: tab.active ?? false,
    lastAccessed: typeof tab.lastAccessed === 'number' ? tab.lastAccessed : null,
  } satisfies CurrentVideoTabSnapshot)));

  if (requestTabId && requestTabId > 0) {
    const tab = tabs.find(candidate => candidate.id === requestTabId) ?? null;
    return {
      tab,
      context: tab ? currentVideoContexts.get(requestTabId) ?? null : null,
    };
  }

  return resolveCurrentVideoTabState(tabs, currentVideoContexts);
}

function buildNoContext(
  url: string | null,
  reason: CurrentVideoNoContext['reason'],
  pageType: CurrentVideoNoContext['pageType'],
): CurrentVideoContextResult {
  return {
    kind: 'no_context',
    url,
    collectedAt: Date.now(),
    reason,
    pageType,
  };
}

function isEffectivePlayerWatch(payload: PlayerHeartbeatPayload | PlayerActionPayload): boolean {
  if ('action' in payload) return payload.action === 'complete';
  const duration = Math.max(0, payload.duration);
  const currentTime = Math.max(0, payload.currentTime);
  const completion = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  return completion >= DYNAMIC_BILL_STRATEGY.positiveCompletionRate
    || currentTime >= DYNAMIC_BILL_STRATEGY.minPositiveWatchSeconds;
}

function normalizeDynamicBillStatusFilter(value: unknown): DynamicBillStatusFilter {
  if (
    value === 'active'
    || value === 'unopened'
    || value === 'opened'
    || value === 'consumed'
    || value === 'processed'
  ) {
    return value;
  }
  throw new Error('INVALID_DYNAMIC_BILL_STATUS_FILTER');
}

function normalizeDynamicBillFeedbackScope(value: unknown): DynamicBillFeedbackScope {
  if (value === 'creator' || value === 'topic') return value;
  throw new Error('INVALID_DYNAMIC_BILL_FEEDBACK_SCOPE');
}

function requireStringParam(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`MISSING_${name.toUpperCase()}`);
}

function normalizeAiConfigParam(value: unknown): UserConfig['ai'] {
  if (!value || typeof value !== 'object') {
    throw new Error('MISSING_AI_CONFIG');
  }
  const raw = value as Record<string, unknown>;
  return {
    baseURL: typeof raw.baseURL === 'string' ? raw.baseURL.trim() : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    chatModel: typeof raw.chatModel === 'string' ? raw.chatModel.trim() : '',
  };
}

async function rebuildSmartFavoriteIndex(
  params: Record<string, unknown> | undefined,
): Promise<SmartFavoriteIndexRebuildResult> {
  const batchSize = Math.min(normalizePositiveInteger(params?.batchSize, 25), 100);
  const totalItems = await countFavoriteItems();
  const clearedIndexes = await clearSmartFavoriteIndex();
  const result: SmartIndexResult = {
    processed: 0,
    indexed: 0,
    failed: 0,
    skipped: 0,
    notes: [],
  };
  let guard = Math.ceil(totalItems / batchSize) + 2;

  while (result.processed < totalItems && guard-- > 0) {
    const batch = await buildSmartFavoriteIndex(batchSize, { includeFailed: false });
    mergeSmartIndexResult(result, batch);
    if (batch.processed === 0) break;
  }

  return {
    totalItems,
    clearedIndexes,
    ...result,
    completedAt: Date.now(),
  };
}

function mergeSmartIndexResult(target: SmartIndexResult, batch: SmartIndexResult): void {
  target.processed += batch.processed;
  target.indexed += batch.indexed;
  target.failed += batch.failed;
  target.skipped += batch.skipped;
  for (const note of batch.notes) {
    if (!target.notes.includes(note)) {
      target.notes.push(note);
    }
  }
}

function videoUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
