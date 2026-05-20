import type { BiliVizRequest, BiliVizContentMessage, BiliVizResponse, PlayerActionPayload, PlayerHeartbeatPayload, SyncNowResult } from '../../shared/types/messages';
import { runInitialBackfill } from '../sync/initial-backfill';
import {
  saveConfig,
  getLastSyncTime,
  getHistorySyncing,
  getHistorySyncProgress,
  loadConfig,
  requestHistorySyncCancel,
  setDeviceTypeMigrationComplete,
} from '../storage/config-store';
import { db } from '../storage/db';
import type { UserConfig } from '../../shared/types/config';
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
import { abortCurrentHistorySync } from '../sync/sync-control';
import { syncFavorites } from '../favorites/sync';
import { buildSmartFavoriteIndex, getSmartFavoriteOverview, getSmartFavoritesByPath, searchSmartFavorites } from '../favorites/smart';

export function setupMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle content script messages
    const contentMsg = message as BiliVizContentMessage;
    if (contentMsg.action && ['PLAYER_HEARTBEAT', 'PLAYER_ACTION', 'PAGE_NAVIGATION'].includes(contentMsg.action)) {
      handleContentMessage(contentMsg).then(() => {
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
}

async function handleContentMessage(msg: BiliVizContentMessage): Promise<void> {
  switch (msg.action) {
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
        tabId: 0,
      });
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
        tabId: 0,
      });
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
          .then(async () => {
            await setDeviceTypeMigrationComplete();
            await computeStoredHistoryAggregates();
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
    case 'GET_SYNC_STATUS': {
      const lastSync = await getLastSyncTime();
      const count = await db.watchHistory.count();
      const syncProgress = await getHistorySyncProgress();
      return { success: true, data: { lastSyncTime: lastSync, totalRecords: count, syncProgress } as T };
    }
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
      return {
        success: true,
        data: await buildSmartFavoriteIndex(Number.isFinite(maxItems) ? maxItems : undefined) as T,
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
    default:
      return { success: false, error: `Unknown action: ${request.action}` };
  }
}
