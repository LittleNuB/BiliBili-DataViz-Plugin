import { fetchHistoryPage, type HistoryCursorParams } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems, isHistoryItemStored } from './dedup';
import { bulkInsert, updateDeviceTypesFromHistory } from '../storage/watch-history-repo';
import {
  getBackfillComplete,
  getHistorySyncing,
  setBackfillComplete,
  setHistorySyncing,
  setHistorySyncProgress,
  setLastSyncTime,
} from '../storage/config-store';
import type { HistoryCursorItem } from '../../shared/types/video-info';
import { MAX_BACKFILL_PAGES } from '../../shared/constants';
import { getHistoryBvid, getHistoryDeviceType, toWatchHistoryRecord } from './watch-history-mapper';
import type { HistorySyncMode } from '../../shared/types/messages';

export interface BackfillResult {
  mode: HistorySyncMode;
  pageLimit: number;
  currentTask: string;
  fetchedPages: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  stoppedReason: string;
  reachedEnd: boolean;
  oldestFetchedAt: number | null;
  newestFetchedAt: number | null;
}

export async function runInitialBackfill(mode: HistorySyncMode = 'full', force = false): Promise<BackfillResult> {
  if (await getHistorySyncing()) {
    throw new Error('HISTORY_SYNC_IN_PROGRESS');
  }

  await setHistorySyncing(true);
  try {
    return await runHistorySyncUnlocked(mode, force);
  } catch (error) {
    await setHistorySyncProgress({
      ...createResult(mode, error instanceof Error ? error.message : 'sync_failed'),
      syncing: false,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    throw error;
  } finally {
    await setHistorySyncing(false);
  }
}

async function runHistorySyncUnlocked(mode: HistorySyncMode, force: boolean): Promise<BackfillResult> {
  const alreadyDone = await getBackfillComplete();
  if (mode === 'full' && alreadyDone && !force) {
    console.log('[BiliViz] Initial backfill already completed');
    return createResult(mode, 'already_complete');
  }

  console.log(`[BiliViz] Starting ${mode} history sync...`);
  const result = createResult(mode, 'page_limit');
  const startedAt = Date.now();
  await writeProgress(result, startedAt, true);
  let cursor: HistoryCursorParams = {};

  while (result.fetchedPages < MAX_BACKFILL_PAGES) {
    result.currentTask = `正在请求第 ${result.fetchedPages + 1} 页历史记录`;
    await writeProgress(result, startedAt, true);

    const { list, cursor: nextCursor } = await fetchHistoryPage(cursor);
    if (list.length === 0) {
      result.stoppedReason = 'empty_page';
      result.currentTask = '接口返回空页，同步结束';
      result.reachedEnd = true;
      break;
    }

    result.fetchedPages++;
    result.fetchedCount += list.length;
    updateFetchedRange(result, list);
    result.currentTask = `已获取第 ${result.fetchedPages} 页，正在去重`;
    await writeProgress(result, startedAt, true);

    const [firstStored, lastStored] = await Promise.all([
      isHistoryItemStored(list[0]),
      isHistoryItemStored(list[list.length - 1]),
    ]);

    result.currentTask = `第 ${result.fetchedPages} 页：正在更新设备信息`;
    await writeProgress(result, startedAt, true);
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
    if (newItems.length > 0) {
      result.currentTask = `第 ${result.fetchedPages} 页：正在补全 ${newItems.length} 条视频信息`;
      await writeProgress(result, startedAt, true);
      const bvids = [...new Set(newItems.map(getHistoryBvid).filter(Boolean))];
      const videoInfo = await batchFetchVideoInfo(bvids);
      result.currentTask = `第 ${result.fetchedPages} 页：正在写入本地历史`;
      await writeProgress(result, startedAt, true);
      const records = newItems.map(item => toWatchHistoryRecord(item, videoInfo.get(getHistoryBvid(item))));
      await bulkInsert(records);
      result.insertedCount += records.length;
    }

    console.log(`[BiliViz] ${mode} sync page: ${newItems.length} new items (total inserted: ${result.insertedCount})`);
    result.currentTask = `第 ${result.fetchedPages} 页处理完成`;
    await writeProgress(result, startedAt, true);

    if (mode === 'incremental') {
      if (newItems.length === 0) {
        result.stoppedReason = 'no_new_records';
        result.currentTask = '未发现新记录，增量同步结束';
        await writeProgress(result, startedAt, true);
        break;
      }
      if (firstStored && lastStored) {
        result.stoppedReason = 'boundary_records_seen';
        result.currentTask = '已遇到本地边界记录，增量同步结束';
        await writeProgress(result, startedAt, true);
        break;
      }
    }

    if (isCursorEnd(nextCursor)) {
      result.stoppedReason = 'api_end';
      result.currentTask = 'B站接口已无更多历史记录';
      result.reachedEnd = true;
      await writeProgress(result, startedAt, true);
      break;
    }

    cursor = {
      max: nextCursor.max,
      viewAt: nextCursor.view_at,
      business: nextCursor.business,
    };

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (mode === 'full' && result.reachedEnd) {
    await setBackfillComplete();
  }
  await setLastSyncTime(Date.now());
  result.currentTask = '同步完成';
  await writeProgress(result, startedAt, false);

  console.log(`[BiliViz] ${mode} history sync complete: ${result.insertedCount} inserted, ${result.updatedCount} updated`);
  return result;
}

function createResult(mode: HistorySyncMode, stoppedReason: string): BackfillResult {
  return {
    mode,
    pageLimit: MAX_BACKFILL_PAGES,
    currentTask: stoppedReason,
    fetchedPages: 0,
    fetchedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    stoppedReason,
    reachedEnd: false,
    oldestFetchedAt: null,
    newestFetchedAt: null,
  };
}

async function writeProgress(result: BackfillResult, startedAt: number, syncing: boolean): Promise<void> {
  await setHistorySyncProgress({
    syncing,
    mode: result.mode,
    pageLimit: result.pageLimit,
    currentTask: result.currentTask,
    startedAt,
    updatedAt: Date.now(),
    fetchedPages: result.fetchedPages,
    fetchedCount: result.fetchedCount,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    stoppedReason: result.stoppedReason,
    reachedEnd: result.reachedEnd,
    oldestFetchedAt: result.oldestFetchedAt,
    newestFetchedAt: result.newestFetchedAt,
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

function isCursorEnd(cursor: { max: number; view_at: number; has_more?: boolean }): boolean {
  return cursor.has_more === false || (cursor.max === 0 && cursor.view_at === 0);
}
