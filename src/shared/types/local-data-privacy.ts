import type { DynamicSyncStatus } from './dynamic-bill';
import type { LocalDataCategoryId } from '../local-data-category-contract';

export interface LocalDataPrivacySummary {
  checkedAt: number;
  history: {
    totalRecords: number;
    oldestViewAt: number | null;
    newestViewAt: number | null;
    lastSyncedAt: number | null;
    syncing: boolean;
    backfillComplete: boolean;
  };
  favorites: {
    folderCount: number;
    reportedItems: number;
    storedItems: number;
    indexedItems: number;
    failedIndexItems: number;
    pendingIndexItems: number;
    incompleteFolders: number;
    syncComplete: boolean;
    lastSyncedAt: number | null;
    lastIndexedAt: number | null;
  };
  currentVideoSubtitles: {
    sourceCount: number;
    segmentCount: number;
    staleSegmentCount: number;
    cachedVideoCount: number;
    lastUpdatedAt: number | null;
  };
  dynamicBill: {
    activeFollowedCreatorCount: number;
    followedVideoUpdateCount: number;
    billItemCount: number;
    unopenedItems: number;
    openedItems: number;
    consumedItems: number;
    processedItems: number;
    feedbackCount: number;
    explanationCount: number;
    lastGeneratedAt: number | null;
    lastSyncedAt: number | null;
    syncStatus: DynamicSyncStatus;
  };
}

export type LocalDataOperationKind =
  | 'clear_current_video_subtitle_cache'
  | 'clear_all_local_data';

export interface LocalDataOperationResult {
  operation: LocalDataOperationKind;
  completedAt: number;
  cleared: {
    historyRecords?: number;
    playerEvents?: number;
    dailyAggregates?: number;
    favoriteFolders?: number;
    favoriteItems?: number;
    smartFavoriteIndexes?: number;
    followedCreators?: number;
    followedVideoUpdates?: number;
    dynamicBillItems?: number;
    dynamicBillExplanations?: number;
    dynamicBillFeedback?: number;
    currentVideoSubtitleSources?: number;
    currentVideoSubtitleSegments?: number;
    localSettings?: boolean;
  };
  categories?: LocalDataCategoryOperationResult[];
}

export interface LocalDataCategoryOperationResult {
  id: LocalDataCategoryId;
  label: string;
  before: {
    count: number;
    usageBytes: number;
  };
  after: {
    count: number;
    usageBytes: number;
    empty: boolean;
  };
}

export interface SmartFavoriteIndexRebuildResult {
  totalItems: number;
  clearedIndexes: number;
  processed: number;
  indexed: number;
  failed: number;
  skipped: number;
  notes: string[];
  completedAt: number;
}
