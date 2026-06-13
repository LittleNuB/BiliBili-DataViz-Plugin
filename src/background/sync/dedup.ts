import type { HistoryCursorItem } from '../../shared/types/video-info';
import { existsByAvidCidViewAt, existsBySessionKey } from '../storage/watch-history-repo';
import { buildWatchSessionKey } from '../../shared/utils/session-key';
import { getHistoryAvid, getHistoryBvid, getHistoryCid } from './watch-history-mapper';
import { shouldUseAvidCidViewAtFallback } from './history-sync-item';

export async function isHistoryItemStored(item: HistoryCursorItem): Promise<boolean> {
  const sessionKey = buildWatchSessionKey(item.kid, item.view_at, getHistoryBvid(item), getHistoryCid(item));
  const bySession = await existsBySessionKey(sessionKey);
  if (bySession) return true;
  if (!shouldUseAvidCidViewAtFallback(item)) return false;
  return existsByAvidCidViewAt(getHistoryAvid(item), getHistoryCid(item), item.view_at);
}

export async function filterNewItems(items: HistoryCursorItem[]): Promise<HistoryCursorItem[]> {
  const results = await Promise.all(
    items.map(async (item) => {
      if (await isHistoryItemStored(item)) return null;
      return item;
    }),
  );
  return results.filter((item): item is HistoryCursorItem => item !== null);
}
