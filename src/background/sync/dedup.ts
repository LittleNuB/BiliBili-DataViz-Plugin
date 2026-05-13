import type { HistoryCursorItem } from '../../shared/types/video-info';
import { existsByKid, existsByAvidCidViewAt } from '../storage/watch-history-repo';

export async function filterNewItems(items: HistoryCursorItem[]): Promise<HistoryCursorItem[]> {
  const results = await Promise.all(
    items.map(async (item) => {
      const byKid = await existsByKid(item.kid);
      if (byKid) return null;
      const byComposite = await existsByAvidCidViewAt(item.avid || 0, item.cid ?? 0, item.view_at);
      if (byComposite) return null;
      return item;
    }),
  );
  return results.filter((item): item is HistoryCursorItem => item !== null);
}
