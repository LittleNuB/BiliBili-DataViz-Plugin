import {
  SYNC_INTERVAL_MINUTES,
  AGGREGATE_INTERVAL_MINUTES,
  CLEANUP_INTERVAL_MINUTES,
} from '../../shared/constants';

const SYNC_ALARM = 'history-sync';
const AGGREGATE_ALARM = 'daily-aggregate';
const CLEANUP_ALARM = 'cleanup';

export function setupAlarms(): void {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });
  chrome.alarms.create(AGGREGATE_ALARM, { periodInMinutes: AGGREGATE_INTERVAL_MINUTES });
  chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: CLEANUP_INTERVAL_MINUTES });
  console.log('[BiliViz] Alarms registered');
}

export function onAlarm(callback: (name: string) => void): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    callback(alarm.name);
  });
}
