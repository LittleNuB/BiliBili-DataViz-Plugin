export type HistorySyncMode = 'full' | 'incremental';

export interface HistorySyncCursorSnapshot {
  max: number | null;
  viewAt: number | null;
  business: string | null;
  hasMore: boolean | null;
}

export interface HistorySyncProgress {
  syncing: boolean;
  mode: HistorySyncMode | null;
  requestedPageLimit: number | null;
  pageLimit: number;
  currentTask: string;
  startedAt: number;
  updatedAt: number;
  fetchedPages: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  stoppedReason: string;
  reachedEnd: boolean;
  oldestFetchedAt: number | null;
  newestFetchedAt: number | null;
  finalCursor: HistorySyncCursorSnapshot | null;
}

export interface HistorySyncStatus {
  lastSyncTime: number;
  totalRecords: number;
  backfillComplete: boolean;
  syncProgress: HistorySyncProgress | null;
}
