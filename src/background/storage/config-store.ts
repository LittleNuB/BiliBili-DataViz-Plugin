import { DEFAULT_CONFIG, type UserConfig } from '../../shared/types/config';

const CONFIG_KEY = 'userConfig';

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
