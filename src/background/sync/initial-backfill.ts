import { fetchHistoryPage } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { isHistoryItemStored } from './dedup';
import { bulkInsert, updateDeviceTypesFromHistory } from '../storage/watch-history-repo';
import {
  getBackfillComplete,
  clearHistorySyncCancel,
  getHistorySyncCancelRequested,
  getHistorySyncing,
  setBackfillComplete,
  setHistorySyncing,
  setHistorySyncProgress,
  setLastSyncTime,
} from '../storage/config-store';
import { MAX_BACKFILL_PAGES } from '../../shared/constants';
import {
  classifyHistoryPageStop,
  isHistoryCursorEnd,
  normalizeHistoryPageLimit,
} from '../../shared/history-sync-core';
import type { HistorySyncMode, HistorySyncProgress } from '../../shared/types/history-sync';
import { beginHistorySyncAbortScope, endHistorySyncAbortScope } from './sync-control';
import { abortableDelay } from '../utils/abortable-delay';
import { markDynamicBillItemsConsumedByHistoryRecords } from '../storage/dynamic-bill-repo';
import { executeHistorySync } from './history-sync-executor';

export interface BackfillResult extends Omit<HistorySyncProgress, 'syncing' | 'startedAt' | 'updatedAt'> {}

export interface HistorySyncOptions {
  maxPages?: number;
}

export async function runInitialBackfill(
  mode: HistorySyncMode = 'full',
  force = false,
  options: HistorySyncOptions = {},
): Promise<BackfillResult> {
  const startingAt = Date.now();
  if (await getHistorySyncing()) {
    throw new Error('HISTORY_SYNC_IN_PROGRESS');
  }

  const signal = beginHistorySyncAbortScope();
  try {
    await setHistorySyncing(true);
    await clearHistorySyncCancel(startingAt);
    return await runHistorySyncUnlocked(mode, force, options, signal);
  } catch (error) {
    await setHistorySyncProgress({
      ...createResult(mode, error instanceof Error ? error.message : 'sync_failed'),
      syncing: false,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    throw error;
  } finally {
    endHistorySyncAbortScope(signal);
    await clearHistorySyncCancel();
    await setHistorySyncing(false);
  }
}

async function runHistorySyncUnlocked(
  mode: HistorySyncMode,
  force: boolean,
  options: HistorySyncOptions,
  signal: AbortSignal,
): Promise<BackfillResult> {
  const alreadyDone = await getBackfillComplete();
  if (mode === 'full' && alreadyDone && !force) {
    console.log('[BiliViz] Initial backfill already completed');
    return createResult(mode, 'already_complete');
  }

  console.log(`[BiliViz] Starting ${mode} history sync...`);
  const requestedPageLimit = Number.isFinite(options.maxPages) ? Math.floor(options.maxPages!) : null;
  const pageLimit = normalizeHistoryPageLimit(options.maxPages);
  const { result } = await executeHistorySync(
    {
      mode,
      pageLimit,
      requestedPageLimit,
      signal,
    },
    {
      fetchPage: fetchHistoryPage,
      isCancelRequested: getHistorySyncCancelRequested,
      isStored: isHistoryItemStored,
      updateDeviceTypes: updateDeviceTypesFromHistory,
      fetchVideoInfo: batchFetchVideoInfo,
      insertRecords: bulkInsert,
      afterInsert: markDynamicBillItemsConsumedByHistoryRecords,
      writeProgress,
      delay: abortableDelay,
    },
  );

  if (mode === 'full' && result.reachedEnd) {
    await setBackfillComplete(true);
  } else if (mode === 'full') {
    await setBackfillComplete(false);
  }
  await setLastSyncTime(Date.now());

  console.log(`[BiliViz] ${mode} history sync complete: ${result.insertedCount} inserted, ${result.updatedCount} updated`);
  return result;
}

function createResult(
  mode: HistorySyncMode,
  stoppedReason: string,
  pageLimit = MAX_BACKFILL_PAGES,
  requestedPageLimit: number | null = null,
): BackfillResult {
  return {
    mode,
    requestedPageLimit,
    pageLimit,
    currentTask: stoppedReason,
    fetchedPages: 0,
    fetchedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    unsupportedBusinessCount: 0,
    liveExcludedCount: 0,
    missingIdCount: 0,
    stoppedReason,
    reachedEnd: false,
    oldestFetchedAt: null,
    newestFetchedAt: null,
    finalCursor: null,
  };
}

export const normalizePageLimit = normalizeHistoryPageLimit;

async function writeProgress(result: BackfillResult, startedAt: number, syncing: boolean): Promise<void> {
  await setHistorySyncProgress({
    syncing,
    mode: result.mode,
    requestedPageLimit: result.requestedPageLimit,
    pageLimit: result.pageLimit,
    currentTask: result.currentTask,
    startedAt,
    updatedAt: Date.now(),
    fetchedPages: result.fetchedPages,
    fetchedCount: result.fetchedCount,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    skippedCount: result.skippedCount,
    duplicateCount: result.duplicateCount,
    unsupportedBusinessCount: result.unsupportedBusinessCount,
    liveExcludedCount: result.liveExcludedCount,
    missingIdCount: result.missingIdCount,
    stoppedReason: result.stoppedReason,
    reachedEnd: result.reachedEnd,
    oldestFetchedAt: result.oldestFetchedAt,
    newestFetchedAt: result.newestFetchedAt,
    finalCursor: result.finalCursor,
  });
}

export const classifyPageStop = classifyHistoryPageStop;
export const isCursorEnd = isHistoryCursorEnd;
