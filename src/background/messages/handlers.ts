import type { BiliVizRequest, BiliVizContentMessage, BiliVizResponse, PlayerActionPayload, PlayerHeartbeatPayload, SyncNowResult } from '../../shared/types/messages';
import type { HistorySyncStatus } from '../../shared/types/history-sync';
import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
  CurrentVideoNoContext,
  CurrentVideoSubtitleSourceState,
} from '../../shared/types/current-video-context';
import type { CurrentVideoTranscriptEvidenceState } from '../../shared/types/current-video-transcript';
import type {
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from '../../shared/types/current-video-segment-retrieval';
import type { VideoKnowledgeJumpResponse } from '../../shared/types/video-knowledge';
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
import { searchCurrentVideoSegments } from '../../shared/current-video-segment-retrieval';
import { searchCurrentVideoSegmentsWithAiRerank } from '../current-video-segment-rerank';
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
import { DYNAMIC_BILL_STRATEGY } from '../dynamic-bill/strategy';
import { getDynamicOverview, syncDynamicBillUpdates } from '../dynamic-bill/sync';
import {
  extractBvidFromUrl,
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
import { testAiConnection } from '../ai/openai-compatible';

const EXPORT_PAGE_LIMIT_MAX = 1000;
const SUBTITLE_PROBE_CACHE_MS = 5 * 60 * 1000;
const currentVideoContexts = new Map<number, CurrentVideoContextResult>();
const currentVideoSubtitleProbes = new Map<string, CurrentVideoSubtitleSourceState>();
const currentVideoSubtitleProbeRequests = new Map<string, Promise<CurrentVideoSubtitleSourceState>>();

interface CurrentVideoLookupOptions {
  forceContextRefresh?: boolean;
  forceSubtitleProbe?: boolean;
}

export function setupMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle content script messages
    const contentMsg = message as BiliVizContentMessage;
    if (contentMsg.action && ['PLAYER_HEARTBEAT', 'PLAYER_ACTION', 'PAGE_NAVIGATION', 'CURRENT_VIDEO_CONTEXT_UPDATE'].includes(contentMsg.action)) {
      handleContentMessage(contentMsg, sender.tab?.id ?? 0).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true; // keep channel open
    }

    // Handle UI request messages
    const request = message as BiliVizRequest;
    if (request.action) {
      handleRequest(request).then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true;
    }

    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    currentVideoContexts.delete(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const nextUrl = changeInfo.url;
    if (!nextUrl) return;
    if (!isBilibiliVideoUrl(nextUrl)) {
      currentVideoContexts.delete(tabId);
      return;
    }

    const cached = currentVideoContexts.get(tabId);
    if (cached?.kind === 'video' && cached.bvid !== extractBvidFromUrl(nextUrl)) {
      currentVideoContexts.delete(tabId);
    }
  });
}

async function handleContentMessage(msg: BiliVizContentMessage, tabId: number): Promise<void> {
  switch (msg.action) {
    case 'CURRENT_VIDEO_CONTEXT_UPDATE': {
      if (tabId > 0) {
        currentVideoContexts.set(tabId, msg.payload as CurrentVideoContextResult);
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
      break;
  }
}

async function handleRequest<T>(request: BiliVizRequest): Promise<BiliVizResponse<T>> {
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
      return { success: true, data: await getCurrentVideoContextForActiveTab(currentVideoLookupOptions(request.params)) as T };
    case 'PROBE_CURRENT_VIDEO_SUBTITLE_SOURCE':
      return { success: true, data: await probeSubtitleSourceForActiveTab(request.params) as T };
    case 'GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE':
      return { success: true, data: await getTranscriptEvidenceForActiveTab(request.params) as T };
    case 'GET_CURRENT_VIDEO_SUMMARY': {
      const context = await getCurrentVideoContextForActiveTab();
      const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(context);
      return { success: true, data: await generateCurrentVideoSummary(context, { transcriptSegments }) as T };
    }
    case 'GET_VIDEO_KNOWLEDGE': {
      const context = await getCurrentVideoContextForActiveTab();
      const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(context);
      return { success: true, data: buildVideoKnowledgeResult(context, { transcriptSegments }) as T };
    }
    case 'SEARCH_CURRENT_VIDEO_SEGMENTS': {
      const query = String(request.params?.query ?? '');
      const context = await getCurrentVideoContextForActiveTab();
      const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(context);
      const videoKnowledge = buildVideoKnowledgeResult(context, { transcriptSegments });
      return {
        success: true,
        data: await searchCurrentVideoSegmentsWithAiRerank(context, {
          query,
          transcriptSegments,
          videoKnowledge,
        }) as T,
      };
    }
    case 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP':
      return { success: true, data: await requestCurrentVideoSegmentJump(request.params) as T };
    case 'RETURN_CURRENT_VIDEO_SEGMENT_JUMP':
      return { success: true, data: await returnCurrentVideoSegmentJump() as T };
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

  const target = await resolveCurrentVideoLookupState();
  const tabId = target.tab?.id ?? 0;
  if (!target.tab?.url || tabId <= 0 || !isBilibiliVideoUrl(target.tab.url)) {
    return blockedTimestampJumpResponse(
      candidateId,
      'no_context',
      formatTimestampJumpFailureReason('no_context'),
    );
  }

  const context = await getCurrentVideoContextForActiveTab();
  if (context.kind !== 'video') {
    return blockedTimestampJumpResponse(
      candidateId,
      'no_context',
      formatTimestampJumpFailureReason('no_context'),
    );
  }

  const transcriptSegments = await getActiveCurrentVideoTranscriptSegments(context);
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

async function returnCurrentVideoSegmentJump(): Promise<CurrentVideoTimestampReturnResponse> {
  const target = await resolveCurrentVideoLookupState();
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
): Promise<CurrentVideoContextResult> {
  const context = await getRawCurrentVideoContextForActiveTab(options);
  if (context.kind !== 'video') return context;
  const withSubtitle = await enrichCurrentVideoContextWithSubtitleProbe(context, options);
  return await enrichCurrentVideoContextWithTranscriptEvidence(withSubtitle);
}

async function getRawCurrentVideoContextForActiveTab(
  options: CurrentVideoLookupOptions = {},
): Promise<CurrentVideoContextResult> {
  const { tab, context } = await resolveCurrentVideoLookupState();
  const url = tab?.url ?? null;

  if (!url || !isBilibiliVideoUrl(url)) {
    return buildNoContext(url, 'non_video_page', 'non_video');
  }

  if (tab?.id && (options.forceContextRefresh || context?.kind !== 'video')) {
    const refreshed = await requestFreshCurrentVideoContext(tab.id, url);
    if (refreshed) return refreshed;
  }

  if (context?.kind === 'video') {
    return context;
  }

  return buildNoContext(url, 'video_context_unavailable', 'video');
}

async function probeSubtitleSourceForActiveTab(
  params: Record<string, unknown> | undefined,
): Promise<CurrentVideoSubtitleSourceState> {
  const options = currentVideoLookupOptions({
    ...params,
    forceSubtitleProbe: params?.force === true || params?.forceSubtitleProbe === true,
    forceContextRefresh: params?.force === true || params?.forceContextRefresh === true,
  });
  const context = await getCurrentVideoContextForActiveTab(options);
  if (context.kind === 'video' && context.subtitleProbe) {
    return context.subtitleProbe;
  }
  return await probeCurrentVideoSubtitleSource(context);
}

async function getTranscriptEvidenceForActiveTab(
  params: Record<string, unknown> | undefined,
): Promise<CurrentVideoTranscriptEvidenceState> {
  const context = await getCurrentVideoContextForActiveTab(currentVideoLookupOptions(params));
  const requestedLanguage = typeof params?.language === 'string'
    ? params.language
    : null;
  return await cacheCurrentVideoTranscriptEvidence(context, { requestedLanguage });
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
  });
  return withTranscriptEvidenceState(context, state);
}

async function getActiveCurrentVideoTranscriptSegments(
  context: CurrentVideoContextResult,
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
    sourceHash: context.transcriptEvidence.sourceHash,
  });
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
    if (extractBvidFromUrl(tabUrl) !== response.bvid) return null;
    currentVideoContexts.set(tabId, response);
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

async function resolveCurrentVideoLookupState(): Promise<{
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
