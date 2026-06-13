import { fetchHistoryPage, type HistoryCursorParams } from '../api/history.ts';
import { HISTORY_PAGE_SIZE } from '../../shared/constants.ts';
import {
  buildHistoryTailProbePageDiagnostic,
  classifyHistoryTailProbeStop,
  createHistoryTailCursorKey,
} from '../../shared/history-tail-probe-core.ts';
import { normalizeHistoryPageLimit } from '../../shared/history-sync-core.ts';
import type { HistoryTailProbeReport } from '../../shared/types/history-tail-probe.ts';
import type { HistorySyncCursorSnapshot } from '../../shared/types/history-sync.ts';

export interface HistoryTailProbeOptions {
  maxPages?: number;
  signal?: AbortSignal;
}

export async function probeHistoryTailCoverage(options: HistoryTailProbeOptions = {}): Promise<HistoryTailProbeReport> {
  const startedAt = Date.now();
  const requestedMaxPages = Number.isFinite(options.maxPages) ? Math.floor(options.maxPages!) : null;
  const normalizedPageLimit = normalizeHistoryPageLimit(options.maxPages);
  const pages: HistoryTailProbeReport['pages'] = [];
  const seenResponseCursors = new Set<string>();
  let cursor: HistoryCursorParams = {};
  let fetchedItems = 0;
  let oldestFetchedAt: number | null = null;
  let newestFetchedAt: number | null = null;
  let repeatedCursorDetected = false;
  let shortPageAnomalyCount = 0;
  let emptyPageAnomalyCount = 0;
  let stopReason: HistoryTailProbeReport['stopReason'] = 'page_limit';
  let reachedDeclaredEnd = false;
  let finalCursor: HistorySyncCursorSnapshot | null = null;

  for (let pageIndex = 1; pageIndex <= normalizedPageLimit; pageIndex++) {
    if (options.signal?.aborted) {
      stopReason = 'cancelled';
      break;
    }

    const requestedCursor = toRequestedCursorSnapshot(cursor);
    const { list, cursor: responseCursorRaw } = await fetchHistoryPage(cursor, options.signal);
    const responseCursor = toResponseCursorSnapshot(responseCursorRaw);
    finalCursor = responseCursor;

    const cursorKey = createHistoryTailCursorKey(responseCursor);
    const repeatedCursor = seenResponseCursors.has(cursorKey);
    if (!repeatedCursor) {
      seenResponseCursors.add(cursorKey);
    } else {
      repeatedCursorDetected = true;
    }

    const page = buildHistoryTailProbePageDiagnostic({
      pageIndex,
      list,
      requestedCursor,
      responseCursor,
      repeatedCursor,
      pageSize: HISTORY_PAGE_SIZE,
    });
    pages.push(page);
    fetchedItems += list.length;
    if (page.shortPageAnomaly) shortPageAnomalyCount++;
    if (page.emptyPage && !page.declaredEnd) emptyPageAnomalyCount++;

    if (page.newestViewAt !== null) {
      newestFetchedAt = newestFetchedAt === null ? page.newestViewAt : Math.max(newestFetchedAt, page.newestViewAt);
    }
    if (page.oldestViewAt !== null) {
      oldestFetchedAt = oldestFetchedAt === null ? page.oldestViewAt : Math.min(oldestFetchedAt, page.oldestViewAt);
    }

    const stop = classifyHistoryTailProbeStop({
      listCount: list.length,
      cursor: responseCursorRaw,
      repeatedCursor,
    });
    if (stop.stopReason) {
      stopReason = stop.stopReason;
      reachedDeclaredEnd = stop.reachedDeclaredEnd;
      break;
    }

    cursor = {
      max: responseCursorRaw.max,
      viewAt: responseCursorRaw.view_at,
      business: responseCursorRaw.business,
    };
  }

  return {
    startedAt,
    finishedAt: Date.now(),
    requestedMaxPages,
    normalizedPageLimit,
    pageSize: HISTORY_PAGE_SIZE,
    fetchedPages: pages.length,
    fetchedItems,
    oldestFetchedAt,
    newestFetchedAt,
    repeatedCursorDetected,
    shortPageAnomalyCount,
    emptyPageAnomalyCount,
    stopReason,
    reachedDeclaredEnd,
    finalCursor,
    pages,
  };
}

function toRequestedCursorSnapshot(cursor: HistoryCursorParams): HistorySyncCursorSnapshot | null {
  if (
    cursor.max === undefined
    && cursor.viewAt === undefined
    && cursor.business === undefined
  ) {
    return null;
  }

  return {
    max: cursor.max ?? null,
    viewAt: cursor.viewAt ?? null,
    business: cursor.business ?? null,
    hasMore: null,
  };
}

function toResponseCursorSnapshot(cursor: { max: number; view_at: number; business?: string; has_more?: boolean }): HistorySyncCursorSnapshot {
  return {
    max: cursor.max,
    viewAt: cursor.view_at,
    business: cursor.business ?? null,
    hasMore: typeof cursor.has_more === 'boolean' ? cursor.has_more : null,
  };
}
