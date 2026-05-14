import { fetchHistoryPage } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems } from './dedup';
import { bulkInsert, updateDeviceTypesFromHistory } from '../storage/watch-history-repo';
import { setLastSyncTime } from '../storage/config-store';
import { getHistoryBvid, getHistoryDeviceType, toWatchHistoryRecord } from './watch-history-mapper';

export async function syncLatestHistory(): Promise<number> {
  const { list } = await fetchHistoryPage({ ps: 30 });
  if (list.length === 0) return 0;

  await updateDeviceTypesFromHistory(
    list.map(item => ({
      kid: item.kid,
      avid: item.avid ?? item.history?.oid ?? 0,
      cid: item.cid ?? item.history?.cid ?? 0,
      viewAt: item.view_at,
      deviceType: getHistoryDeviceType(item),
    })),
  );

  const newItems = await filterNewItems(list);
  if (newItems.length === 0) {
    await setLastSyncTime(Date.now());
    return 0;
  }

  const bvids = [...new Set(newItems.map(getHistoryBvid).filter(Boolean))];
  const videoInfo = await batchFetchVideoInfo(bvids);

  const records = newItems.map(item => toWatchHistoryRecord(item, videoInfo.get(getHistoryBvid(item))));
  await bulkInsert(records);
  await setLastSyncTime(Date.now());

  console.log(`[BiliViz] Synced ${records.length} new watch history records`);
  return records.length;
}
