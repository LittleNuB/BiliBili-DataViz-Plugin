import { HISTORY_PAGE_SIZE } from './constants.ts';
import { isHistoryCursorEnd } from './history-sync-core.ts';
import type { HistoryTailProbePageDiagnostic, HistoryTailProbeStopReason } from './types/history-tail-probe.ts';
import type { HistorySyncCursorSnapshot } from './types/history-sync.ts';
import type { HistoryCursorItem } from './types/video-info.ts';

export function classifyHistoryTailProbeStop(args: {
  listCount: number;
  cursor: { max: number; view_at: number; has_more?: boolean };
  repeatedCursor: boolean;
}): {
  stopReason: HistoryTailProbeStopReason | null;
  reachedDeclaredEnd: boolean;
} {
  if (args.repeatedCursor) {
    return { stopReason: 'repeated_cursor', reachedDeclaredEnd: false };
  }

  if (args.listCount === 0) {
    return isHistoryCursorEnd(args.cursor)
      ? { stopReason: 'api_end_empty_page', reachedDeclaredEnd: true }
      : { stopReason: 'empty_page_cursor_anomaly', reachedDeclaredEnd: false };
  }

  if (isHistoryCursorEnd(args.cursor)) {
    return { stopReason: 'api_end', reachedDeclaredEnd: true };
  }

  return { stopReason: null, reachedDeclaredEnd: false };
}

export function buildHistoryTailProbePageDiagnostic(args: {
  pageIndex: number;
  list: Pick<HistoryCursorItem, 'view_at'>[];
  requestedCursor: HistorySyncCursorSnapshot | null;
  responseCursor: HistorySyncCursorSnapshot;
  repeatedCursor: boolean;
  pageSize?: number;
}): HistoryTailProbePageDiagnostic {
  let newestViewAt: number | null = null;
  let oldestViewAt: number | null = null;

  for (const item of args.list) {
    newestViewAt = newestViewAt === null ? item.view_at : Math.max(newestViewAt, item.view_at);
    oldestViewAt = oldestViewAt === null ? item.view_at : Math.min(oldestViewAt, item.view_at);
  }

  const declaredEnd = args.responseCursor.hasMore === false
    || (args.responseCursor.max === 0 && args.responseCursor.viewAt === 0);
  const emptyPage = args.list.length === 0;
  const shortPageAnomaly = args.list.length > 0
    && args.list.length < (args.pageSize ?? HISTORY_PAGE_SIZE)
    && !declaredEnd;

  return {
    pageIndex: args.pageIndex,
    itemCount: args.list.length,
    newestViewAt,
    oldestViewAt,
    requestedCursor: args.requestedCursor,
    responseCursor: args.responseCursor,
    repeatedCursor: args.repeatedCursor,
    shortPageAnomaly,
    emptyPage,
    declaredEnd,
  };
}

export function createHistoryTailCursorKey(cursor: HistorySyncCursorSnapshot): string {
  return `${cursor.max ?? 'null'}:${cursor.viewAt ?? 'null'}:${cursor.business ?? 'null'}:${cursor.hasMore == null ? 'null' : String(cursor.hasMore)}`;
}
