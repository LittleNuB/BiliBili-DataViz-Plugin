import { fetchAllHistory } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems } from './dedup';
import { bulkInsert } from '../storage/watch-history-repo';
import { setBackfillComplete, getBackfillComplete } from '../storage/config-store';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type { HistoryCursorItem, VideoInfo } from '../../shared/types/video-info';
import { MAX_BACKFILL_PAGES } from '../../shared/constants';

export async function runInitialBackfill(force = false): Promise<number> {
  const alreadyDone = await getBackfillComplete();
  if (alreadyDone && !force) {
    console.log('[BiliViz] Initial backfill already completed');
    return 0;
  }

  console.log('[BiliViz] Starting initial backfill...');
  let totalItems = 0;

  await fetchAllHistory(async (items: HistoryCursorItem[]) => {
    const newItems = await filterNewItems(items);
    if (newItems.length === 0) return;

    const bvids = [...new Set(newItems.map(i => i.bvid))];
    const videoInfo = await batchFetchVideoInfo(bvids);

    const records: WatchHistoryRecord[] = newItems.map(item => toWatchHistoryRecord(item, videoInfo.get(item.bvid)));

    await bulkInsert(records);
    totalItems += records.length;
    console.log(`[BiliViz] Backfill page: ${records.length} items (total: ${totalItems})`);
  }, MAX_BACKFILL_PAGES);

  await setBackfillComplete();
  console.log(`[BiliViz] Backfill complete: ${totalItems} total items`);
  return totalItems;
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
