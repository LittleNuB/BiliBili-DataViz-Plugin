import type { BiliVizRequest, BiliVizContentMessage, BiliVizResponse } from '../../shared/types/messages';
import { syncLatestHistory } from '../sync/history-sync';
import { loadConfig, saveConfig } from '../storage/config-store';
import type { UserConfig } from '../../shared/types/config';

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
    case 'PLAYER_HEARTBEAT':
    case 'PLAYER_ACTION':
      console.log(`[BiliViz] Player event: ${msg.action}`, msg.payload);
      // TODO: Store player events (Phase 3)
      break;
    case 'PAGE_NAVIGATION':
      console.log(`[BiliViz] Page navigation:`, msg.payload);
      break;
  }
}

async function handleRequest<T>(request: BiliVizRequest): Promise<BiliVizResponse<T>> {
  switch (request.action) {
    case 'GET_QUICK_STATS':
      return { success: true, data: await getQuickStats() as T };
    case 'GET_DASHBOARD_DATA':
      return { success: true, data: {} as T };
    case 'GET_PREFERENCE_DATA':
      return { success: true, data: {} as T };
    case 'GET_CREATOR_DATA':
      return { success: true, data: {} as T };
    case 'GET_BEHAVIOR_DATA':
      return { success: true, data: {} as T };
    case 'GET_EXPERIMENT_DATA':
      return { success: true, data: {} as T };
    case 'SYNC_NOW':
      await syncLatestHistory();
      return { success: true, data: { synced: true } as T };
    case 'UPDATE_CONFIG':
      await saveConfig(request.params as Partial<UserConfig>);
      return { success: true };
    default:
      return { success: false, error: `Unknown action: ${request.action}` };
  }
}

async function getQuickStats() {
  const config = await loadConfig();
  return {
    todayWatchTime: 0,
    dailyGoal: config.dailyWatchGoal,
    streakDays: 0,
    avgCompletion: 0,
    efficiencyScore: 0,
    weeklyWatchTime: 0,
  };
}
