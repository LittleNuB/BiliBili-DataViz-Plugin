import type { BiliVizRequest, BiliVizContentMessage, BiliVizResponse, PlayerActionPayload, PlayerHeartbeatPayload, SyncNowResult } from '../../shared/types/messages';
import type { CurrentVideoContextResult, CurrentVideoNoContext } from '../../shared/types/current-video-context';
import type { DynamicBillFeedbackScope, DynamicBillStatusFilter } from '../../shared/types/dynamic-bill';
import { runInitialBackfill } from '../sync/initial-backfill';
import {
  saveConfig,
  getLastSyncTime,
  getHistorySyncing,
  getHistorySyncProgress,
  loadConfig,
  requestHistorySyncCancel,
  clearOrphanedHistorySyncLock,
  setDeviceTypeMigrationComplete,
} from '../storage/config-store';
import { db } from '../storage/db';
import type { UserConfig } from '../../shared/types/config';
import { generateCurrentVideoSummary } from '../current-video-summary';
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
import { buildSmartFavoriteIndex, getSmartFavoriteOverview, getSmartFavoritesByPath, searchSmartFavorites } from '../favorites/smart';
import { buildDynamicBillExplanations } from '../dynamic-bill/ai';
import { generateDynamicBillItems } from '../dynamic-bill/generator';
import { DYNAMIC_BILL_STRATEGY } from '../dynamic-bill/strategy';
import { getDynamicOverview, syncDynamicBillUpdates } from '../dynamic-bill/sync';
import {
  getDynamicBillFilterPreference,
  getDynamicBillItems,
  addDynamicBillFeedback,
  markDynamicBillItemOpened,
  markDynamicBillItemProcessed,
  markDynamicBillItemsConsumedByBvid,
  setDynamicBillFilterPreference,
} from '../storage/dynamic-bill-repo';

const EXPORT_PAGE_LIMIT_MAX = 1000;
const currentVideoContexts = new Map<number, CurrentVideoContextResult>();

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
      return { success: true, data: await getPreferenceData() as T };
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
            pageLimit: maxPages ?? 0,
            currentTask: 'sync_started',
            fetchedPages: 0,
            fetchedCount: 0,
            insertedCount: 0,
            updatedCount: 0,
            stoppedReason: 'sync_started',
            reachedEnd: false,
            oldestFetchedAt: null,
            newestFetchedAt: null,
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
      const syncProgress = await getHistorySyncProgress();
      return { success: true, data: { lastSyncTime: lastSync, totalRecords: count, syncProgress } as T };
    }
    case 'GET_CURRENT_VIDEO_CONTEXT':
      return { success: true, data: await getCurrentVideoContextForActiveTab() as T };
    case 'GET_CURRENT_VIDEO_SUMMARY':
      return { success: true, data: await generateCurrentVideoSummary(await getCurrentVideoContextForActiveTab()) as T };
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

async function markConsumedFromPlayerEvent(
  payload: PlayerHeartbeatPayload | PlayerActionPayload,
): Promise<void> {
  if (!payload.bvid || !isEffectivePlayerWatch(payload)) return;
  await markDynamicBillItemsConsumedByBvid(payload.bvid, Date.now());
}

async function getCurrentVideoContextForActiveTab(): Promise<CurrentVideoContextResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? null;
  const tabId = tab?.id ?? 0;

  if (!url || !isBilibiliVideoUrl(url)) {
    return buildNoContext(url, 'non_video_page', 'non_video');
  }

  const context = tabId > 0 ? currentVideoContexts.get(tabId) : null;
  if (context?.kind === 'video' && context.bvid === extractBvidFromUrl(url)) {
    return context;
  }

  return buildNoContext(url, 'video_context_unavailable', 'video');
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

function isBilibiliVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('bilibili.com') && parsed.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

function extractBvidFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/)?.[1] ?? '';
  } catch {
    return '';
  }
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
