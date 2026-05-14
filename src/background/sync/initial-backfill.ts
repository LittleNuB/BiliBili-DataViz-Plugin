import { fetchAllHistory } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems } from './dedup';
import { bulkInsert, updateDeviceTypesFromHistory } from '../storage/watch-history-repo';
import { setBackfillComplete, getBackfillComplete } from '../storage/config-store';
import type { HistoryCursorItem } from '../../shared/types/video-info';
import { MAX_BACKFILL_PAGES } from '../../shared/constants';
import { getHistoryBvid, getHistoryDeviceType, toWatchHistoryRecord } from './watch-history-mapper';

export async function runInitialBackfill(force = false): Promise<number> {
  const alreadyDone = await getBackfillComplete();
  if (alreadyDone && !force) {
    console.log('[BiliViz] Initial backfill already completed');
    return 0;
  }

  console.log('[BiliViz] Starting initial backfill...');
  let totalItems = 0;

  await fetchAllHistory(async (items: HistoryCursorItem[]) => {
    await updateDeviceTypesFromHistory(
      items.map(item => ({
        kid: item.kid,
        avid: item.avid ?? item.history?.oid ?? 0,
        cid: item.cid ?? item.history?.cid ?? 0,
        viewAt: item.view_at,
        deviceType: getHistoryDeviceType(item),
      })),
    );

    const newItems = await filterNewItems(items);
    if (newItems.length === 0) return;

    const bvids = [...new Set(newItems.map(getHistoryBvid).filter(Boolean))];
    const videoInfo = await batchFetchVideoInfo(bvids);

    const records = newItems.map(item => toWatchHistoryRecord(item, videoInfo.get(getHistoryBvid(item))));

    await bulkInsert(records);
    totalItems += records.length;
    console.log(`[BiliViz] Backfill page: ${records.length} items (total: ${totalItems})`);
  }, MAX_BACKFILL_PAGES);

  await setBackfillComplete();
  console.log(`[BiliViz] Backfill complete: ${totalItems} total items`);
  return totalItems;
}
