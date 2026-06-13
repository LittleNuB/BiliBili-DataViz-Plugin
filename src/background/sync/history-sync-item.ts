import type { HistoryCursorItem } from '../../shared/types/video-info.ts';
import { getHistoryAvid, getHistoryBvid, getHistoryBusiness, getHistoryCid } from './watch-history-mapper.ts';

export type HistorySyncDropReason =
  | 'live_excluded'
  | 'unsupported_business'
  | 'missing_id';

export interface HistorySyncItemClassification {
  item: HistoryCursorItem;
  action: 'store' | 'drop';
  reason: HistorySyncDropReason | null;
  business: string;
  avid: number;
  bvid: string;
  cid: number;
}

export function classifyHistoryItemForSync(item: HistoryCursorItem): HistorySyncItemClassification {
  const business = normalizeHistoryBusiness(item);
  const avid = getHistoryAvid(item);
  const bvid = getHistoryBvid(item).trim();
  const cid = getHistoryCid(item);

  if (business === 'live') {
    return { item, action: 'drop', reason: 'live_excluded', business, avid, bvid, cid };
  }

  if (bvid || (avid > 0 && cid > 0)) {
    return { item, action: 'store', reason: null, business, avid, bvid, cid };
  }

  if (business && business !== 'archive') {
    return { item, action: 'drop', reason: 'unsupported_business', business, avid, bvid, cid };
  }

  return { item, action: 'drop', reason: 'missing_id', business, avid, bvid, cid };
}

export function normalizeHistoryBusiness(item: HistoryCursorItem): string {
  return getHistoryBusiness(item).trim().toLowerCase();
}

export function shouldUseAvidCidViewAtFallback(item: HistoryCursorItem): boolean {
  return normalizeHistoryBusiness(item) !== 'live'
    && getHistoryAvid(item) > 0
    && getHistoryCid(item) > 0;
}
