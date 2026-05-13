import { fetchAllHistory } from '../api/history';
import { batchFetchVideoInfo } from '../api/video-info';
import { filterNewItems } from './dedup';
import { bulkInsert } from '../storage/watch-history-repo';
import { setBackfillComplete, getBackfillComplete } from '../storage/config-store';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type { HistoryCursorItem } from '../../shared/types/video-info';
import { MAX_BACKFILL_PAGES } from '../../shared/constants';

export async function runInitialBackfill(): Promise<number> {
  const alreadyDone = await getBackfillComplete();
  if (alreadyDone) {
    console.log('[BiliViz] Initial backfill already completed');
    return 0;
  }

  console.log('[BiliViz] Starting initial backfill...');
  let totalItems = 0;

  await fetchAllHistory(async (items: HistoryCursorItem[]) => {
    const newItems = await filterNewItems(items);
    if (newItems.length === 0) return;

    const bvids = [...new Set(newItems.map(i => i.bvid))];
    await batchFetchVideoInfo(bvids);

    const records: WatchHistoryRecord[] = newItems.map((item) => ({
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
    }));

    await bulkInsert(records);
    totalItems += records.length;
    console.log(`[BiliViz] Backfill page: ${records.length} items (total: ${totalItems})`);
  }, MAX_BACKFILL_PAGES);

  await setBackfillComplete();
  console.log(`[BiliViz] Backfill complete: ${totalItems} total items`);
  return totalItems;
}
