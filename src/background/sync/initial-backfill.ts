import { fetchHistoryPage, type HistoryCursorParams } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems, isHistoryItemStored } from './dedup';
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
import type { HistoryCursorItem } from '../../shared/types/video-info';
import type { VideoInfo } from '../../shared/types/video-info';
import { MAX_BACKFILL_PAGES } from '../../shared/constants';
import {
  classifyHistoryPageStop,
  isHistoryCursorEnd,
  normalizeHistoryPageLimit,
} from '../../shared/history-sync-core';
import { getHistoryBvid, getHistoryDeviceType, toWatchHistoryRecord } from './watch-history-mapper';
import type { HistorySyncCursorSnapshot, HistorySyncMode, HistorySyncProgress } from '../../shared/types/history-sync';
import { beginHistorySyncAbortScope, endHistorySyncAbortScope } from './sync-control';
import { abortableDelay } from '../utils/abortable-delay';
import { markDynamicBillItemsConsumedByHistoryRecords } from '../storage/dynamic-bill-repo';

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
  const result = createResult(mode, 'page_limit', pageLimit, requestedPageLimit);
  const startedAt = Date.now();
  await writeProgress(result, startedAt, true);
  let cursor: HistoryCursorParams = {};

  while (result.fetchedPages < pageLimit) {
    if (signal.aborted || await getHistorySyncCancelRequested()) {
      result.stoppedReason = 'cancelled';
      break;
    }

    let page;
    try {
      page = await fetchHistoryPage(cursor, signal);
    } catch (error) {
      if (error instanceof Error && error.message === 'SYNC_CANCELLED') {
        result.stoppedReason = 'cancelled';
        break;
      }
      throw error;
    }

    const { list, cursor: nextCursor } = page;
    result.finalCursor = toCursorSnapshot(nextCursor);
    if (list.length === 0) {
      const stop = classifyHistoryPageStop({
        mode,
        listCount: 0,
        firstStored: false,
        lastStored: false,
        newItemsCount: 0,
        cursor: nextCursor,
      });
      if (stop.stoppedReason) {
        result.stoppedReason = stop.stoppedReason;
        result.reachedEnd = stop.reachedEnd;
      }
      break;
    }

    result.fetchedPages++;
    result.fetchedCount += list.length;
    updateFetchedRange(result, list);
    await writeProgress(result, startedAt, true);

    const [firstStored, lastStored] = await Promise.all([
      isHistoryItemStored(list[0]),
      isHistoryItemStored(list[list.length - 1]),
    ]);

    result.updatedCount += await updateDeviceTypesFromHistory(
      list.map(item => ({
        kid: item.kid,
        avid: item.avid ?? item.history?.oid ?? 0,
        cid: item.cid ?? item.history?.cid ?? 0,
        viewAt: item.view_at,
        deviceType: getHistoryDeviceType(item),
      })),
    );

    const newItems = await filterNewItems(list);
    result.skippedCount += Math.max(0, list.length - newItems.length);
    if (newItems.length > 0) {
      const bvids = [...new Set(newItems.map(getHistoryBvid).filter(Boolean))];
      let videoInfo: Map<string, VideoInfo>;
      try {
        if (signal.aborted || await getHistorySyncCancelRequested()) {
          result.stoppedReason = 'cancelled';
          break;
        }
        videoInfo = await batchFetchVideoInfo(bvids, signal);
      } catch (error) {
        if (error instanceof Error && error.message === 'SYNC_CANCELLED') {
          result.stoppedReason = 'cancelled';
          break;
        }
        throw error;
      }

      if (signal.aborted || await getHistorySyncCancelRequested()) {
        result.stoppedReason = 'cancelled';
        break;
      }

      const records = newItems.map(item => toWatchHistoryRecord(item, videoInfo.get(getHistoryBvid(item))));
      await bulkInsert(records);
      await markDynamicBillItemsConsumedByHistoryRecords(records);
      result.insertedCount += records.length;
    }

    console.log(`[BiliViz] ${mode} sync page: ${newItems.length} new items (total inserted: ${result.insertedCount})`);
    await writeProgress(result, startedAt, true);

    const stop = classifyHistoryPageStop({
      mode,
      listCount: list.length,
      firstStored,
      lastStored,
      newItemsCount: newItems.length,
      cursor: nextCursor,
    });
    if (stop.stoppedReason) {
      result.stoppedReason = stop.stoppedReason;
      result.reachedEnd = stop.reachedEnd;
      await writeProgress(result, startedAt, true);
      break;
    }

    cursor = {
      max: nextCursor.max,
      viewAt: nextCursor.view_at,
      business: nextCursor.business,
    };

    try {
      await abortableDelay(1000, signal);
    } catch (error) {
      if (error instanceof Error && error.message === 'SYNC_CANCELLED') {
        result.stoppedReason = 'cancelled';
        break;
      }
      throw error;
    }
  }

  if (mode === 'full' && result.reachedEnd) {
    await setBackfillComplete(true);
  } else if (mode === 'full') {
    await setBackfillComplete(false);
  }
  await setLastSyncTime(Date.now());
  result.currentTask = result.stoppedReason === 'cancelled' ? 'sync_cancelled' : 'sync_complete';
  await writeProgress(result, startedAt, false);

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
    stoppedReason: result.stoppedReason,
    reachedEnd: result.reachedEnd,
    oldestFetchedAt: result.oldestFetchedAt,
    newestFetchedAt: result.newestFetchedAt,
    finalCursor: result.finalCursor,
  });
}

function updateFetchedRange(result: BackfillResult, items: HistoryCursorItem[]): void {
  for (const item of items) {
    result.oldestFetchedAt = result.oldestFetchedAt === null
      ? item.view_at
      : Math.min(result.oldestFetchedAt, item.view_at);
    result.newestFetchedAt = result.newestFetchedAt === null
      ? item.view_at
      : Math.max(result.newestFetchedAt, item.view_at);
  }
}

export const classifyPageStop = classifyHistoryPageStop;
export const isCursorEnd = isHistoryCursorEnd;

function toCursorSnapshot(cursor: { max: number; view_at: number; business?: string; has_more?: boolean }): HistorySyncCursorSnapshot {
  return {
    max: cursor.max,
    viewAt: cursor.view_at,
    business: cursor.business ?? null,
    hasMore: typeof cursor.has_more === 'boolean' ? cursor.has_more : null,
  };
}
