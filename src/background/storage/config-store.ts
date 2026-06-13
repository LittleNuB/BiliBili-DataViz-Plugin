import { DEFAULT_CONFIG, type UserConfig } from '../../shared/types/config.ts';
import type { HistorySyncProgress } from '../../shared/types/history-sync.ts';

const CONFIG_KEY = 'userConfig';
const HISTORY_SYNC_PROGRESS_KEY = 'historySyncProgress';
const HISTORY_SYNC_CANCEL_KEY = 'historySyncCancelRequested';
const HISTORY_SYNC_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

export async function loadConfig(): Promise<UserConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  if (result[CONFIG_KEY]) {
    return {
      ...DEFAULT_CONFIG,
      ...result[CONFIG_KEY],
      ai: {
        ...DEFAULT_CONFIG.ai,
        ...(result[CONFIG_KEY].ai ?? {}),
      },
      assistant: {
        ...DEFAULT_CONFIG.assistant,
        ...(result[CONFIG_KEY].assistant ?? {}),
      },
      dynamicBill: {
        ...DEFAULT_CONFIG.dynamicBill,
        ...(result[CONFIG_KEY].dynamicBill ?? {}),
      },
    };
  }
  return DEFAULT_CONFIG;
}

export async function saveConfig(config: Partial<UserConfig>): Promise<void> {
  const current = await loadConfig();
  const updated = {
    ...current,
    ...config,
    ai: {
      ...current.ai,
      ...(config.ai ?? {}),
    },
    assistant: {
      ...current.assistant,
      ...(config.assistant ?? {}),
    },
    dynamicBill: {
      ...current.dynamicBill,
      ...(config.dynamicBill ?? {}),
    },
  };
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

export async function getHistorySyncProgress(): Promise<HistorySyncProgress | null> {
  const result = await chrome.storage.local.get(HISTORY_SYNC_PROGRESS_KEY);
  return normalizeHistorySyncProgress(result[HISTORY_SYNC_PROGRESS_KEY] ?? null);
}

export async function setHistorySyncProgress(progress: HistorySyncProgress): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_SYNC_PROGRESS_KEY]: progress });
}

export async function patchHistorySyncProgress(progress: Partial<HistorySyncProgress>): Promise<void> {
  const current = await getHistorySyncProgress();
  if (!current) return;
  await setHistorySyncProgress({
    ...current,
    ...progress,
    updatedAt: Date.now(),
  });
}

export async function requestHistorySyncCancel(): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_SYNC_CANCEL_KEY]: Date.now() });
}

export async function clearHistorySyncCancel(clearRequestedBefore?: number): Promise<void> {
  if (clearRequestedBefore !== undefined) {
    const result = await chrome.storage.local.get(HISTORY_SYNC_CANCEL_KEY);
    const requestedAt = Number(result[HISTORY_SYNC_CANCEL_KEY] ?? 0);
    if (requestedAt > clearRequestedBefore) return;
  }
  await chrome.storage.local.remove(HISTORY_SYNC_CANCEL_KEY);
}

export async function getHistorySyncCancelRequested(): Promise<boolean> {
  const result = await chrome.storage.local.get(HISTORY_SYNC_CANCEL_KEY);
  return Boolean(result[HISTORY_SYNC_CANCEL_KEY]);
}

export async function clearOrphanedHistorySyncLock(): Promise<void> {
  const result = await chrome.storage.local.get('historySyncing');
  if (!result.historySyncing) return;
  await setHistorySyncing(false);
  await patchHistorySyncProgress({ syncing: false, stoppedReason: 'service_worker_restarted' });
}

export async function getBackfillComplete(): Promise<boolean> {
  const result = await chrome.storage.local.get('backfillComplete');
  return result.backfillComplete ?? false;
}

export async function setBackfillComplete(complete = true): Promise<void> {
  await chrome.storage.local.set({ backfillComplete: complete });
}

export async function getDeviceTypeMigrationComplete(): Promise<boolean> {
  const result = await chrome.storage.local.get('deviceTypeMigrationComplete');
  return result.deviceTypeMigrationComplete ?? false;
}

export async function setDeviceTypeMigrationComplete(): Promise<void> {
  await chrome.storage.local.set({ deviceTypeMigrationComplete: true });
}

function normalizeHistorySyncProgress(value: unknown): HistorySyncProgress | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<HistorySyncProgress> & {
    skippedCount?: unknown;
    duplicateCount?: unknown;
    unsupportedBusinessCount?: unknown;
    liveExcludedCount?: unknown;
    missingIdCount?: unknown;
    requestedPageLimit?: unknown;
    finalCursor?: unknown;
  };

  const fetchedCount = asRequiredNumber(raw.fetchedCount, 0);
  const insertedCount = asRequiredNumber(raw.insertedCount, 0);
  const duplicateCount = Math.max(0, asRequiredNumber(raw.duplicateCount, 0));
  const unsupportedBusinessCount = Math.max(0, asRequiredNumber(raw.unsupportedBusinessCount, 0));
  const liveExcludedCount = Math.max(0, asRequiredNumber(raw.liveExcludedCount, 0));
  const missingIdCount = Math.max(0, asRequiredNumber(raw.missingIdCount, 0));
  const skippedCount = Math.max(
    0,
    asRequiredNumber(
      raw.skippedCount,
      duplicateCount + unsupportedBusinessCount + liveExcludedCount + missingIdCount,
    ),
  );

  return {
    syncing: raw.syncing === true,
    mode: raw.mode === 'full' || raw.mode === 'incremental' ? raw.mode : null,
    requestedPageLimit: raw.requestedPageLimit == null ? null : asOptionalNumber(raw.requestedPageLimit, null),
    pageLimit: asRequiredNumber(raw.pageLimit, 0),
    currentTask: typeof raw.currentTask === 'string' ? raw.currentTask : '',
    startedAt: asRequiredNumber(raw.startedAt, 0),
    updatedAt: asRequiredNumber(raw.updatedAt, 0),
    fetchedPages: asRequiredNumber(raw.fetchedPages, 0),
    fetchedCount,
    insertedCount,
    updatedCount: asRequiredNumber(raw.updatedCount, 0),
    skippedCount,
    duplicateCount,
    unsupportedBusinessCount,
    liveExcludedCount,
    missingIdCount,
    stoppedReason: typeof raw.stoppedReason === 'string' ? raw.stoppedReason : '',
    reachedEnd: raw.reachedEnd === true,
    oldestFetchedAt: asOptionalNumber(raw.oldestFetchedAt, null),
    newestFetchedAt: asOptionalNumber(raw.newestFetchedAt, null),
    finalCursor: normalizeCursor(raw.finalCursor),
  };
}

function normalizeCursor(value: unknown): HistorySyncProgress['finalCursor'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  return {
    max: asOptionalNumber(raw.max, null),
    viewAt: asOptionalNumber(raw.viewAt, null),
    business: typeof raw.business === 'string' ? raw.business : null,
    hasMore: typeof raw.hasMore === 'boolean' ? raw.hasMore : null,
  };
}

function asRequiredNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
