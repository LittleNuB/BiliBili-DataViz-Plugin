import { fetchHistoryPage } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems } from './dedup';
import { bulkInsert, getNewestRecord } from '../storage/watch-history-repo';
import { setLastSyncTime } from '../storage/config-store';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type { HistoryCursorItem, VideoInfo } from '../../shared/types/video-info';

export async function syncLatestHistory(): Promise<number> {
  const { list } = await fetchHistoryPage({ ps: 30 });
  if (list.length === 0) return 0;

  const newItems = await filterNewItems(list);
  if (newItems.length === 0) {
    await setLastSyncTime(Date.now());
    return 0;
  }

  const bvids = [...new Set(newItems.map(i => i.bvid))];
  const videoInfo = await batchFetchVideoInfo(bvids);

  const records: WatchHistoryRecord[] = newItems.map(item => toWatchHistoryRecord(item, videoInfo.get(item.bvid)));
  await bulkInsert(records);
  await setLastSyncTime(Date.now());

  console.log(`[BiliViz] Synced ${records.length} new watch history records`);
  return records.length;
}

function toWatchHistoryRecord(item: HistoryCursorItem, info?: VideoInfo): WatchHistoryRecord {
  const duration = item.duration || info?.duration || 0;
  const tags = item.tags ? item.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  return {
    kid: item.kid,
    avid: item.avid ?? info?.avid ?? 0,
    bvid: item.bvid,
    cid: item.cid ?? 0,
    title: item.title || info?.title || '',
    authorName: item.author_name || info?.owner?.name || '',
    authorMid: item.author_mid || info?.owner?.mid || 0,
    tagName: item.tag_name || info?.tname || '',
    tags: tags.length > 0 ? tags : Array.isArray(info?.tags) ? info.tags : [],
    cover: item.cover || info?.pic || '',
    viewAt: item.view_at,
    progress: item.progress,
    duration,
    actualCompletion: duration > 0 ? Math.min(item.progress / duration, 1) : 0,
    deviceType: item.device ?? 3,
    isFavorite: item.is_fav !== 0,
    business: item.business,
    dt: item.dt ?? 0,
    syncedAt: Date.now(),
  };
}
