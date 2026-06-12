type HistorySyncMode = 'full' | 'incremental';

const MAX_BACKFILL_PAGES = 300;

export function normalizeHistoryPageLimit(maxPages: number | undefined): number {
  if (!Number.isFinite(maxPages)) return MAX_BACKFILL_PAGES;
  return Math.max(1, Math.min(MAX_BACKFILL_PAGES, Math.floor(maxPages!)));
}

export function classifyHistoryPageStop(args: {
  mode: HistorySyncMode;
  listCount: number;
  firstStored: boolean;
  lastStored: boolean;
  newItemsCount: number;
  cursor: { max: number; view_at: number; has_more?: boolean; business?: string };
}): {
  stoppedReason: string | null;
  reachedEnd: boolean;
} {
  if (args.listCount === 0) {
    return isHistoryCursorEnd(args.cursor)
      ? { stoppedReason: 'api_end_empty_page', reachedEnd: true }
      : { stoppedReason: 'empty_page_cursor_anomaly', reachedEnd: false };
  }

  if (args.mode === 'incremental') {
    if (args.newItemsCount === 0) {
      return { stoppedReason: 'no_new_records', reachedEnd: false };
    }
    if (args.firstStored && args.lastStored) {
      return { stoppedReason: 'boundary_records_seen', reachedEnd: false };
    }
  }

  if (isHistoryCursorEnd(args.cursor)) {
    return { stoppedReason: 'api_end', reachedEnd: true };
  }

  return { stoppedReason: null, reachedEnd: false };
}

export function isHistoryCursorEnd(cursor: { max: number; view_at: number; has_more?: boolean }): boolean {
  return cursor.has_more === false || (cursor.max === 0 && cursor.view_at === 0);
}
