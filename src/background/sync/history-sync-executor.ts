import type { HistoryCursorData, HistoryCursorItem, VideoInfo } from '../../shared/types/video-info.ts';
import type { WatchHistoryRecord } from '../../shared/types/watch-event.ts';
import type { HistorySyncCursorSnapshot, HistorySyncMode, HistorySyncProgress } from '../../shared/types/history-sync.ts';
import { classifyHistoryPageStop } from '../../shared/history-sync-core.ts';
import { getHistoryAvid, getHistoryBvid, getHistoryCid, getHistoryDeviceType, toWatchHistoryRecord } from './watch-history-mapper.ts';
import { classifyHistoryItemForSync } from './history-sync-item.ts';

export interface HistorySyncExecutionResult extends Omit<HistorySyncProgress, 'syncing' | 'startedAt' | 'updatedAt'> {}

export interface HistorySyncExecutionOptions {
  mode: HistorySyncMode;
  pageLimit: number;
  requestedPageLimit: number | null;
  signal?: AbortSignal;
  currentTask?: string;
}

export interface HistorySyncExecutionDependencies {
  fetchPage(cursor: HistoryCursorParams, signal?: AbortSignal): Promise<{
    list: HistoryCursorItem[];
    cursor: HistoryCursorData['cursor'];
  }>;
  isCancelRequested(): Promise<boolean>;
  isStored(item: HistoryCursorItem): Promise<boolean>;
  updateDeviceTypes(items: Array<{
    kid?: number;
    avid: number;
    cid: number;
    viewAt: number;
    deviceType: number;
  }>): Promise<number>;
  fetchVideoInfo(bvids: string[], signal?: AbortSignal): Promise<Map<string, VideoInfo>>;
  insertRecords(records: WatchHistoryRecord[]): Promise<unknown>;
  afterInsert?(records: WatchHistoryRecord[]): Promise<unknown>;
  writeProgress?(result: HistorySyncExecutionResult, startedAt: number, syncing: boolean): Promise<void>;
  delay?(ms: number, signal?: AbortSignal): Promise<void>;
  now?(): number;
}

export interface HistoryCursorParams {
  max?: number;
  viewAt?: number;
  business?: string;
}

const INTER_PAGE_DELAY_MS = 1000;

export async function executeHistorySync(
  options: HistorySyncExecutionOptions,
  deps: HistorySyncExecutionDependencies,
): Promise<{ result: HistorySyncExecutionResult; startedAt: number }> {
  const startedAt = deps.now?.() ?? Date.now();
  const result = createHistorySyncExecutionResult(options);
  await deps.writeProgress?.(result, startedAt, true);

  let cursor: HistoryCursorParams = {};

  while (result.fetchedPages < result.pageLimit) {
    if (options.signal?.aborted || await deps.isCancelRequested()) {
      result.stoppedReason = 'cancelled';
      break;
    }

    let page;
    try {
      page = await deps.fetchPage(cursor, options.signal);
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
        mode: options.mode,
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

    const classifications = list.map(classifyHistoryItemForSync);
    const storableItems = classifications
      .filter(classification => classification.action === 'store')
      .map(classification => classification.item);
    const [firstSupportedStored, lastSupportedStored] = await Promise.all([
      storableItems[0] ? deps.isStored(storableItems[0]) : Promise.resolve(false),
      storableItems.length > 0 ? deps.isStored(storableItems[storableItems.length - 1]) : Promise.resolve(false),
    ]);

    for (const classification of classifications) {
      switch (classification.reason) {
        case 'live_excluded':
          result.liveExcludedCount++;
          break;
        case 'unsupported_business':
          result.unsupportedBusinessCount++;
          break;
        case 'missing_id':
          result.missingIdCount++;
          break;
        default:
          break;
      }
    }

    if (storableItems.length > 0) {
      result.updatedCount += await deps.updateDeviceTypes(
        storableItems.map(item => ({
          kid: item.kid,
          avid: getHistoryAvid(item),
          cid: getHistoryCid(item),
          viewAt: item.view_at,
          deviceType: getHistoryDeviceType(item),
        })),
      );
    }

    const newItems = await filterNewItems(storableItems, deps.isStored);
    result.duplicateCount += Math.max(0, storableItems.length - newItems.length);
    result.skippedCount = result.duplicateCount
      + result.unsupportedBusinessCount
      + result.liveExcludedCount
      + result.missingIdCount;

    await deps.writeProgress?.(result, startedAt, true);

    if (newItems.length > 0) {
      const bvids = [...new Set(newItems.map(getHistoryBvid).filter(Boolean))];
      let videoInfo = new Map<string, VideoInfo>();
      if (bvids.length > 0) {
        try {
          if (options.signal?.aborted || await deps.isCancelRequested()) {
            result.stoppedReason = 'cancelled';
            break;
          }
          videoInfo = await deps.fetchVideoInfo(bvids, options.signal);
        } catch (error) {
          if (error instanceof Error && error.message === 'SYNC_CANCELLED') {
            result.stoppedReason = 'cancelled';
            break;
          }
          throw error;
        }
      }

      if (options.signal?.aborted || await deps.isCancelRequested()) {
        result.stoppedReason = 'cancelled';
        break;
      }

      const records = newItems.map(item => toWatchHistoryRecord(item, videoInfo.get(getHistoryBvid(item))));
      await deps.insertRecords(records);
      await deps.afterInsert?.(records);
      result.insertedCount += records.length;
    }

    await deps.writeProgress?.(result, startedAt, true);

    const stop = classifyHistoryPageStop({
      mode: options.mode,
      listCount: list.length,
      firstStored: firstSupportedStored,
      lastStored: lastSupportedStored,
      newItemsCount: newItems.length,
      cursor: nextCursor,
    });
    if (stop.stoppedReason) {
      result.stoppedReason = stop.stoppedReason;
      result.reachedEnd = stop.reachedEnd;
      await deps.writeProgress?.(result, startedAt, true);
      break;
    }

    cursor = {
      max: nextCursor.max,
      viewAt: nextCursor.view_at,
      business: nextCursor.business,
    };

    if (deps.delay) {
      try {
        await deps.delay(INTER_PAGE_DELAY_MS, options.signal);
      } catch (error) {
        if (error instanceof Error && error.message === 'SYNC_CANCELLED') {
          result.stoppedReason = 'cancelled';
          break;
        }
        throw error;
      }
    }
  }

  result.currentTask = result.stoppedReason === 'cancelled' ? 'sync_cancelled' : 'sync_complete';
  await deps.writeProgress?.(result, startedAt, false);
  return { result, startedAt };
}

async function filterNewItems(
  items: HistoryCursorItem[],
  isStored: (item: HistoryCursorItem) => Promise<boolean>,
): Promise<HistoryCursorItem[]> {
  const results = await Promise.all(
    items.map(async item => (await isStored(item)) ? null : item),
  );
  return results.filter((item): item is HistoryCursorItem => item !== null);
}

function createHistorySyncExecutionResult(options: HistorySyncExecutionOptions): HistorySyncExecutionResult {
  return {
    mode: options.mode,
    requestedPageLimit: options.requestedPageLimit,
    pageLimit: options.pageLimit,
    currentTask: options.currentTask ?? 'page_limit',
    fetchedPages: 0,
    fetchedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    unsupportedBusinessCount: 0,
    liveExcludedCount: 0,
    missingIdCount: 0,
    stoppedReason: 'page_limit',
    reachedEnd: false,
    oldestFetchedAt: null,
    newestFetchedAt: null,
    finalCursor: null,
  };
}

function updateFetchedRange(result: HistorySyncExecutionResult, items: HistoryCursorItem[]): void {
  for (const item of items) {
    result.oldestFetchedAt = result.oldestFetchedAt === null
      ? item.view_at
      : Math.min(result.oldestFetchedAt, item.view_at);
    result.newestFetchedAt = result.newestFetchedAt === null
      ? item.view_at
      : Math.max(result.newestFetchedAt, item.view_at);
  }
}

function toCursorSnapshot(cursor: { max: number; view_at: number; business?: string; has_more?: boolean }): HistorySyncCursorSnapshot {
  return {
    max: cursor.max,
    viewAt: cursor.view_at,
    business: cursor.business ?? null,
    hasMore: typeof cursor.has_more === 'boolean' ? cursor.has_more : null,
  };
}
