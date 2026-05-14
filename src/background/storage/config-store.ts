import { DEFAULT_CONFIG, type UserConfig } from '../../shared/types/config';
import type { SyncProgress } from '../../shared/types/messages';

const CONFIG_KEY = 'userConfig';
const HISTORY_SYNC_PROGRESS_KEY = 'historySyncProgress';
const HISTORY_SYNC_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

export async function loadConfig(): Promise<UserConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  if (result[CONFIG_KEY]) {
    return { ...DEFAULT_CONFIG, ...result[CONFIG_KEY] };
  }
  return DEFAULT_CONFIG;
}

export async function saveConfig(config: Partial<UserConfig>): Promise<void> {
  const current = await loadConfig();
  const updated = { ...current, ...config };
  await chrome.storage.local.set({ [CONFIG_KEY]: updated });
}

export async function getLastSyncTime(): Promise<number> {
  const result = await chrome.storage.local.get('lastSyncTime');
  return result.lastSyncTime ?? 0;
}

export async function setLastSyncTime(timestamp: number): Promise<void> {
  await chrome.storage.local.set({ lastSyncTime: timestamp });
}

export async function getHistorySyncing(): Promise<boolean> {
  const result = await chrome.storage.local.get(['historySyncing', 'historySyncStartedAt']);
  if (!result.historySyncing) return false;

  const startedAt = Number(result.historySyncStartedAt ?? 0);
  if (!startedAt || Date.now() - startedAt > HISTORY_SYNC_LOCK_TIMEOUT_MS) {
    await setHistorySyncing(false);
    await patchHistorySyncProgress({ syncing: false, stoppedReason: 'stale_lock_cleared' });
    return false;
  }

  return true;
}

export async function setHistorySyncing(syncing: boolean): Promise<void> {
  if (syncing) {
    await chrome.storage.local.set({
      historySyncing: true,
      historySyncStartedAt: Date.now(),
    });
    return;
  }

  await chrome.storage.local.set({ historySyncing: false });
  await chrome.storage.local.remove('historySyncStartedAt');
}

export async function getHistorySyncProgress(): Promise<SyncProgress | null> {
  const result = await chrome.storage.local.get(HISTORY_SYNC_PROGRESS_KEY);
  return result[HISTORY_SYNC_PROGRESS_KEY] ?? null;
}

export async function setHistorySyncProgress(progress: SyncProgress): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_SYNC_PROGRESS_KEY]: progress });
}

export async function patchHistorySyncProgress(progress: Partial<SyncProgress>): Promise<void> {
  const current = await getHistorySyncProgress();
  if (!current) return;
  await setHistorySyncProgress({
    ...current,
    ...progress,
    updatedAt: Date.now(),
  });
}

export async function getBackfillComplete(): Promise<boolean> {
  const result = await chrome.storage.local.get('backfillComplete');
  return result.backfillComplete ?? false;
}

export async function setBackfillComplete(): Promise<void> {
  await chrome.storage.local.set({ backfillComplete: true });
}

export async function getDeviceTypeMigrationComplete(): Promise<boolean> {
  const result = await chrome.storage.local.get('deviceTypeMigrationComplete');
  return result.deviceTypeMigrationComplete ?? false;
}

export async function setDeviceTypeMigrationComplete(): Promise<void> {
  await chrome.storage.local.set({ deviceTypeMigrationComplete: true });
}
