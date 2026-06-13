import type { HistorySyncCursorSnapshot } from './history-sync';

export type HistoryTailProbeStopReason =
  | 'page_limit'
  | 'api_end'
  | 'api_end_empty_page'
  | 'empty_page_cursor_anomaly'
  | 'repeated_cursor'
  | 'cancelled';

export interface HistoryTailProbePageDiagnostic {
  pageIndex: number;
  itemCount: number;
  newestViewAt: number | null;
  oldestViewAt: number | null;
  requestedCursor: HistorySyncCursorSnapshot | null;
  responseCursor: HistorySyncCursorSnapshot;
  repeatedCursor: boolean;
  shortPageAnomaly: boolean;
  emptyPage: boolean;
  declaredEnd: boolean;
}

export interface HistoryTailProbeReport {
  startedAt: number;
  finishedAt: number;
  requestedMaxPages: number | null;
  normalizedPageLimit: number;
  pageSize: number;
  fetchedPages: number;
  fetchedItems: number;
  oldestFetchedAt: number | null;
  newestFetchedAt: number | null;
  repeatedCursorDetected: boolean;
  shortPageAnomalyCount: number;
  emptyPageAnomalyCount: number;
  stopReason: HistoryTailProbeStopReason;
  reachedDeclaredEnd: boolean;
  finalCursor: HistorySyncCursorSnapshot | null;
  pages: HistoryTailProbePageDiagnostic[];
}
