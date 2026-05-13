import { biliGet } from './client';
import { HISTORY_ENDPOINT, HISTORY_PAGE_SIZE } from '../../shared/constants';
import type { HistoryCursorData, HistoryCursorItem } from '../../shared/types/video-info';

export interface HistoryCursorParams {
  max?: number;
  viewAt?: number;
  business?: string;
  ps?: number;
}

export async function fetchHistoryPage(params: HistoryCursorParams = {}): Promise<{
  list: HistoryCursorItem[];
  cursor: HistoryCursorData['cursor'];
}> {
  const queryParams: Record<string, string> = {
    ps: String(params.ps ?? HISTORY_PAGE_SIZE),
  };

  if (params.max !== undefined && params.max !== 0) {
    queryParams.max = String(params.max);
  }
  if (params.viewAt !== undefined && params.viewAt !== 0) {
    queryParams.view_at = String(params.viewAt);
  }
  if (params.business) {
    queryParams.business = params.business;
  }

  const data = await biliGet<HistoryCursorData>(HISTORY_ENDPOINT, queryParams);
  return {
    list: data.list ?? [],
    cursor: data.cursor,
  };
}

export async function fetchAllHistory(
  onPage: (items: HistoryCursorItem[]) => Promise<void>,
  maxPages = 30,
): Promise<number> {
  let cursor: HistoryCursorParams = {};
  let pageCount = 0;
  let totalItems = 0;

  while (pageCount < maxPages) {
    const { list, cursor: nextCursor } = await fetchHistoryPage(cursor);

    if (list.length === 0) break;

    await onPage(list);
    totalItems += list.length;
    pageCount++;

    if (nextCursor.max === 0 || !nextCursor.has_more) break;

    cursor = {
      max: nextCursor.max,
      viewAt: nextCursor.view_at,
      business: nextCursor.business,
    };
  }

  return totalItems;
}
