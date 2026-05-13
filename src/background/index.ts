import { setupAlarms, onAlarm } from './sync/scheduler';
import { syncLatestHistory } from './sync/history-sync';
import { runInitialBackfill } from './sync/initial-backfill';
import { setupMessageHandlers } from './messages/handlers';
import { deleteOlderThan } from './storage/watch-history-repo';
import { loadConfig } from './storage/config-store';

console.log('[BiliViz] Service Worker started');

// Register alarms for periodic tasks
setupAlarms();

// Listen for alarm events
onAlarm(async (name) => {
  switch (name) {
    case 'history-sync':
      try {
        await syncLatestHistory();
      } catch (e) {
        console.error('[BiliViz] History sync failed:', e);
      }
      break;

    case 'daily-aggregate':
      console.log('[BiliViz] Daily aggregate alarm fired');
      // Aggregate computation will be implemented in Phase 2
      break;

    case 'cleanup':
      try {
        const config = await loadConfig();
        const cutoff = Math.floor(Date.now() / 1000) - config.retentionDays * 86_400;
        const deleted = await deleteOlderThan(cutoff);
        if (deleted > 0) {
          console.log(`[BiliViz] Cleanup: deleted ${deleted} old records`);
        }
      } catch (e) {
        console.error('[BiliViz] Cleanup failed:', e);
      }
      break;
  }
});

// Run initial backfill on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[BiliViz] Extension installed/updated:', details.reason);
  if (details.reason === 'install') {
    try {
      await runInitialBackfill();
    } catch (e) {
      console.error('[BiliViz] Initial backfill failed:', e);
    }
  }
});

// Set up message handlers for popup/dashboard/content-script
setupMessageHandlers();
