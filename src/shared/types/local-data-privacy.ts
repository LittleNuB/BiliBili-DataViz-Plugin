import type { DynamicBillCreatorPauseView, DynamicSyncStatus } from './dynamic-bill';
import type { LocalDataCategoryId, LocalDataClearedCounts } from '../local-data-category-contract';

export interface LocalDataCategorySummary {
  id: LocalDataCategoryId;
  label: string;
  count: number;
  usageBytes: number;
}

export interface LocalDataPrivacySummary {
  checkedAt: number;
  categories: LocalDataCategorySummary[];
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
    sourceIdentityCount: number;
    segmentCount: number;
    staleSegmentCount: number;
    cachedVideoCount: number;
    usageBytes: number;
    lastUpdatedAt: number | null;
  };
  currentVideoSummaryHighlights: {
    cachedPartCount: number;
    usageBytes: number;
    latestGeneratedAt: number | null;
  };
  currentVideoQaSessions: {
    sessionCount: number;
    usageBytes: number;
    latestUsedAt: number | null;
  };
  dynamicBill: {
    activeFollowedCreatorCount: number;
    followedVideoUpdateCount: number;
    billItemCount: number;
    rotationRecordCount: number;
    creatorPauseCount: number;
    feedbackActionCount: number;
    creatorFeedbackCount: number;
    creatorReviewPromptCount: number;
    activeCreatorPauses: DynamicBillCreatorPauseView[];
    unopenedItems: number;
    openedItems: number;
    consumedItems: number;
    processedItems: number;
    explanationCount: number;
    lastGeneratedAt: number | null;
    lastSyncedAt: number | null;
    syncStatus: DynamicSyncStatus;
  };
  blindBoxDrawHistory: {
    recentDrawCount: number;
    maxRecentDraws: number;
    usageBytes: number;
    lastUpdatedAt: number | null;
  };
}

export type LocalDataOperationKind =
  | 'clear_current_video_subtitle_cache'
  | 'clear_current_video_summary_highlight_cache'
  | 'clear_dynamic_bill_data'
  | 'clear_all_local_data';

export interface LocalDataOperationResult {
  operation: LocalDataOperationKind;
  status?: 'completed' | 'partial_failure';
  completedAt: number;
  cleared: LocalDataClearedCounts;
  categoryResults?: {
    completed: Array<{
      id: LocalDataCategoryId;
      label: string;
      beforeCount: number;
      beforeUsageBytes: number;
      afterCount: number;
      afterUsageBytes: number;
    }>;
    failed: Array<{
      id: LocalDataCategoryId;
      label: string;
      message: string;
    }>;
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
