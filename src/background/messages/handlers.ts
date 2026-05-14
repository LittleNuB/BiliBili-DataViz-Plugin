import type { BiliVizRequest, BiliVizContentMessage, BiliVizResponse, PlayerActionPayload, PlayerHeartbeatPayload } from '../../shared/types/messages';
import { syncLatestHistory } from '../sync/history-sync';
import { runInitialBackfill } from '../sync/initial-backfill';
import {
  loadConfig,
  saveConfig,
  getLastSyncTime,
  getBackfillComplete,
  getDeviceTypeMigrationComplete,
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
        const backfillComplete = await getBackfillComplete();
        const deviceMigrationComplete = await getDeviceTypeMigrationComplete();
        const storedCount = await db.watchHistory.count();
        const shouldBackfill = !backfillComplete || storedCount === 0 || !deviceMigrationComplete;
        const count = shouldBackfill
          ? await runInitialBackfill(storedCount === 0 || !deviceMigrationComplete)
          : await syncLatestHistory();
        if (!deviceMigrationComplete) {
          await setDeviceTypeMigrationComplete();
        }
        await computeStoredHistoryAggregates();
        return { success: true, data: { synced: true, count } as T };
      }
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
      return { success: true, data: { lastSyncTime: lastSync, totalRecords: count } as T };
    }
    default:
      return { success: false, error: `Unknown action: ${request.action}` };
  }
}
