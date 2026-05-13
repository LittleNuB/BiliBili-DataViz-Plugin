import { fetchHistoryPage } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems } from './dedup';
import { bulkInsert, getNewestRecord } from '../storage/watch-history-repo';
import { setLastSyncTime } from '../storage/config-store';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type { HistoryCursorItem } from '../../shared/types/video-info';

export async function syncLatestHistory(): Promise<number> {
  const { list } = await fetchHistoryPage({ ps: 30 });
  if (list.length === 0) return 0;

  const newItems = await filterNewItems(list);
  if (newItems.length === 0) {
    await setLastSyncTime(Date.now());
    return 0;
  }

  const bvids = [...new Set(newItems.map(i => i.bvid))];
  await batchFetchVideoInfo(bvids);

  const records: WatchHistoryRecord[] = newItems.map(toWatchHistoryRecord);
  await bulkInsert(records);
  await setLastSyncTime(Date.now());

  console.log(`[BiliViz] Synced ${records.length} new watch history records`);
  return records.length;
}

function toWatchHistoryRecord(item: HistoryCursorItem): WatchHistoryRecord {
  return {
    kid: item.kid,
    avid: item.avid ?? 0,
    bvid: item.bvid,
    cid: item.cid ?? 0,
    title: item.title,
    authorName: item.author_name,
    authorMid: item.author_mid,
    tagName: item.tag_name ?? '',
    tags: item.tags ? item.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    cover: item.cover ?? '',
    viewAt: item.view_at,
    progress: item.progress,
    duration: item.duration,
    actualCompletion: item.duration > 0 ? item.progress / item.duration : 0,
    deviceType: item.device ?? 3,
    isFavorite: item.is_fav !== 0,
    business: item.business,
    dt: item.dt ?? 0,
    syncedAt: Date.now(),
  };
}
