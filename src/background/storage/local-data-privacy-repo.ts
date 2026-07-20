import { LOCAL_DATA_CLEAR_CONFIRMATION } from '../../shared/local-data-privacy.ts';
import {
  runLocalDataCategoryLifecycle,
  runLocalDataCategoryLifecycles,
  type LocalDataCategoryLifecycleResult,
  type LocalDataClearedCounts,
} from '../../shared/local-data-category-contract.ts';
import { DYNAMIC_BILL_LOCAL_DATA_CLEAR_FAILED_MESSAGE } from '../../shared/dynamic-bill-errors.ts';
import type {
  LocalDataOperationResult,
  LocalDataPrivacySummary,
} from '../../shared/types/local-data-privacy.ts';
import { ensureDynamicBill013Migration } from '../dynamic-bill/migration.ts';
import { runHistoryClearDataOperation } from '../sync/sync-control.ts';
import { clearTemporaryCurrentVideoTranscriptCache } from '../current-video-temporary-transcript-cache.ts';
import {
  beginCurrentVideoTranscriptClearWindow,
  runCurrentVideoTranscriptClearCoordinator,
} from '../current-video-transcript-clear-epoch.ts';
import {
  beginCurrentVideoSummaryHighlightsClearWindow,
} from '../current-video-summary-highlights-clear-epoch.ts';
import { getDynamicBillActiveCreatorPauseViews, getDynamicSyncState } from './dynamic-bill-repo.ts';
import { db } from './db.ts';
import { getRegisteredLocalDataCategories } from './local-data-category-registry.ts';
import {
  getBackfillComplete,
  getHistorySyncing,
  getLastSyncTime,
} from './config-store.ts';
import {
  BLIND_BOX_DRAW_HISTORY_LIMIT,
  beginBlindBoxDrawHistoryClearWindow,
  getBlindBoxDrawHistoryUpdatedAt,
  getBlindBoxRecentDrawnBvids,
} from './blind-box-draw-history-repo.ts';
import {
  clearCurrentVideoSummaryHighlightsCache,
  collectCurrentVideoSummaryHighlightsCacheUsage,
} from './current-video-summary-highlights-repo.ts';
import {
  beginCurrentVideoPrimaryTextSelectionClearWindow,
} from './current-video-primary-text-selection-store.ts';
import {
  beginCurrentVideoQaSessionClearWindow,
  collectCurrentVideoQaSessionUsage,
} from './current-video-qa-session-repo.ts';

export async function getLocalDataPrivacySummary(): Promise<LocalDataPrivacySummary> {
  await ensureDynamicBill013Migration();
  const [
    categories,
    history,
    favorites,
    currentVideoSubtitles,
    currentVideoSummaryHighlights,
    currentVideoQaSessions,
    dynamicBill,
    blindBoxDrawHistory,
  ] = await Promise.all([
    summarizeRegisteredCategories(),
    summarizeHistory(),
    summarizeFavorites(),
    summarizeCurrentVideoSubtitles(),
    summarizeCurrentVideoSummaryHighlights(),
    summarizeCurrentVideoQaSessions(),
    summarizeDynamicBill(),
    summarizeBlindBoxDrawHistory(),
  ]);

  return {
    checkedAt: Date.now(),
    categories,
    history,
    favorites,
    currentVideoSubtitles,
    currentVideoSummaryHighlights,
    currentVideoQaSessions,
    dynamicBill,
    blindBoxDrawHistory,
  };
}

export async function clearCurrentVideoSubtitleCache(): Promise<LocalDataOperationResult> {
  return await runCurrentVideoTranscriptClearCoordinator(async () => {
    const [sourceCount, segmentCount] = await Promise.all([
      db.currentVideoTranscriptSources.count(),
      db.currentVideoTranscriptSegments.count(),
    ]);

    await db.transaction(
      'rw',
      db.currentVideoTranscriptSources,
      db.currentVideoTranscriptSegments,
      async () => {
        await db.currentVideoTranscriptSources.clear();
        await db.currentVideoTranscriptSegments.clear();
      },
    );
    clearTemporaryCurrentVideoTranscriptCache();

    return {
      operation: 'clear_current_video_subtitle_cache',
      completedAt: Date.now(),
      cleared: {
        currentVideoSubtitleSources: sourceCount,
        currentVideoSubtitleSegments: segmentCount,
      },
    };
  });
}

export async function clearCurrentVideoSummaryHighlightCache(): Promise<LocalDataOperationResult> {
  return {
    operation: 'clear_current_video_summary_highlight_cache',
    completedAt: Date.now(),
    cleared: await clearCurrentVideoSummaryHighlightsCache(),
  };
}

export async function clearDynamicBillLocalData(): Promise<LocalDataOperationResult> {
  await ensureDynamicBill013Migration();
  const category = getRegisteredLocalDataCategories()
    .find(registration => registration.id === 'dynamicBill');
  if (!category) throw new Error(DYNAMIC_BILL_LOCAL_DATA_CLEAR_FAILED_MESSAGE);
  const lifecycle = await runLocalDataCategoryLifecycle(category);
  if (lifecycle.status === 'failure') {
    throw new Error(DYNAMIC_BILL_LOCAL_DATA_CLEAR_FAILED_MESSAGE);
  }

  return {
    operation: 'clear_dynamic_bill_data',
    completedAt: Date.now(),
    cleared: lifecycle.clearResult.cleared,
  };
}

export function clearAllLocalData(confirmation: unknown): Promise<LocalDataOperationResult> {
  if (confirmation !== LOCAL_DATA_CLEAR_CONFIRMATION) {
    return Promise.reject(new Error('LOCAL_DATA_CLEAR_CONFIRMATION_REQUIRED'));
  }
  return runHistoryClearDataOperation(clearAllLocalDataExclusive);
}

async function clearAllLocalDataExclusive(): Promise<LocalDataOperationResult> {
  await ensureDynamicBill013Migration();
  if (await getHistorySyncing()) {
    throw new Error('HISTORY_SYNC_IN_PROGRESS');
  }
  const endPrimaryTextClearWindow = beginCurrentVideoPrimaryTextSelectionClearWindow();
  const endTranscriptClearWindow = beginCurrentVideoTranscriptClearWindow();
  const endSummaryHighlightsClearWindow = beginCurrentVideoSummaryHighlightsClearWindow();
  const endQaSessionClearWindow = beginCurrentVideoQaSessionClearWindow();
  const endBlindBoxClearWindow = beginBlindBoxDrawHistoryClearWindow();
  try {
    const categories = getRegisteredLocalDataCategories()
      .filter(category => category.includeInClearAll);
    const results = await runLocalDataCategoryLifecycles(categories);
    const failed = results.filter(result => result.status === 'failure');
    clearTemporaryCurrentVideoTranscriptCache();

    return {
      operation: 'clear_all_local_data',
      status: failed.length > 0 ? 'partial_failure' : 'completed',
      completedAt: Date.now(),
      cleared: mergeClearedCounts(results),
      categoryResults: summarizeLifecycleResults(results),
    };
  } finally {
    endBlindBoxClearWindow();
    endQaSessionClearWindow();
    endSummaryHighlightsClearWindow();
    endTranscriptClearWindow();
    endPrimaryTextClearWindow();
  }
}

async function summarizeRegisteredCategories(): Promise<LocalDataPrivacySummary['categories']> {
  const categories = getRegisteredLocalDataCategories();
  const usages = await Promise.all(categories.map(category => category.collectUsage()));
  return categories.map((category, index) => ({
    id: category.id,
    label: category.label,
    count: usages[index]?.count ?? 0,
    usageBytes: usages[index]?.usageBytes ?? 0,
  }));
}

async function summarizeHistory(): Promise<LocalDataPrivacySummary['history']> {
  const [totalRecords, oldest, newest, lastSyncedAt, syncing, backfillComplete] = await Promise.all([
    db.watchHistory.count(),
    db.watchHistory.orderBy('viewAt').first(),
    db.watchHistory.orderBy('viewAt').last(),
    getLastSyncTime(),
    getHistorySyncing(),
    getBackfillComplete(),
  ]);

  return {
    totalRecords,
    oldestViewAt: oldest?.viewAt ?? null,
    newestViewAt: newest?.viewAt ?? null,
    lastSyncedAt: normalizeNullableTimestamp(lastSyncedAt),
    syncing,
    backfillComplete,
  };
}

async function summarizeFavorites(): Promise<LocalDataPrivacySummary['favorites']> {
  const [
    folders,
    storedItems,
    indexedItems,
    failedIndexItems,
    lastSyncedFolder,
    lastSyncedItem,
    lastIndexedItem,
  ] = await Promise.all([
    db.favoriteFolders.toArray(),
    db.favoriteItems.count(),
    db.smartFavoriteIndex.where({ status: 'indexed' }).count(),
    db.smartFavoriteIndex.where({ status: 'failed' }).count(),
    db.favoriteFolders.orderBy('syncedAt').last(),
    db.favoriteItems.orderBy('syncedAt').last(),
    db.smartFavoriteIndex.orderBy('indexedAt').last(),
  ]);
  const reportedItems = folders.reduce((sum, folder) => sum + Math.max(0, Number(folder.mediaCount) || 0), 0);
  const diagnostics = folders
    .map(folder => folder.lastSyncDiagnostic)
    .filter(diagnostic => diagnostic !== undefined);
  const incompleteFolders = diagnostics.filter(diagnostic => diagnostic.completenessState === 'incomplete').length;

  return {
    folderCount: folders.length,
    reportedItems,
    storedItems,
    indexedItems,
    failedIndexItems,
    pendingIndexItems: Math.max(0, storedItems - indexedItems - failedIndexItems),
    incompleteFolders,
    syncComplete: diagnostics.length > 0 && incompleteFolders === 0,
    lastSyncedAt: latestTimestamp(lastSyncedFolder?.syncedAt, lastSyncedItem?.syncedAt),
    lastIndexedAt: normalizeNullableTimestamp(lastIndexedItem?.indexedAt),
  };
}

async function summarizeCurrentVideoSubtitles(): Promise<LocalDataPrivacySummary['currentVideoSubtitles']> {
  const [sources, segments, lastUpdated] = await Promise.all([
    db.currentVideoTranscriptSources.toArray(),
    db.currentVideoTranscriptSegments.toArray(),
    db.currentVideoTranscriptSources.orderBy('updatedAt').last(),
  ]);
  const staleSegmentCount = segments.filter(segment => segment.stale === true).length;
  const sourceIdentityCount = new Set(
    sources
      .map(source => source.sourceIdentityKey ?? source.identityKey)
      .filter(Boolean),
  ).size;
  const cachedVideoCount = new Set(
    sources
      .filter(source => source.status === 'cached')
      .map(source => `${source.bvid}:${source.cid}:${source.page}`)
      .filter(Boolean),
  ).size;

  return {
    sourceCount: sources.length,
    sourceIdentityCount,
    segmentCount: segments.length,
    staleSegmentCount,
    cachedVideoCount,
    usageBytes: sources.length > 0 || segments.length > 0
      ? serializedRowsSize([...sources, ...segments])
      : 0,
    lastUpdatedAt: normalizeNullableTimestamp(lastUpdated?.updatedAt),
  };
}

async function summarizeCurrentVideoSummaryHighlights(): Promise<LocalDataPrivacySummary['currentVideoSummaryHighlights']> {
  const usage = await collectCurrentVideoSummaryHighlightsCacheUsage();
  return {
    cachedPartCount: usage.count,
    usageBytes: usage.usageBytes,
    latestGeneratedAt: usage.latestGeneratedAt,
  };
}

async function summarizeCurrentVideoQaSessions(): Promise<LocalDataPrivacySummary['currentVideoQaSessions']> {
  const usage = await collectCurrentVideoQaSessionUsage();
  return {
    sessionCount: usage.count,
    usageBytes: usage.usageBytes,
    latestUsedAt: usage.latestUsedAt,
  };
}

async function summarizeDynamicBill(): Promise<LocalDataPrivacySummary['dynamicBill']> {
  await ensureDynamicBill013Migration();
  const activeCreatorPauses = await getDynamicBillActiveCreatorPauseViews();
  const [
    creators,
    updatesCount,
    items,
    explanationCount,
    actionCount,
    creatorFeedbackCount,
    promptCount,
    rotationRecordCount,
    syncState,
  ] = await Promise.all([
    db.followedCreators.toArray(),
    db.followedVideoUpdates.count(),
    db.dynamicBillItems.toArray(),
    db.dynamicBillExplanations.count(),
    db.dynamicBillFeedbackActions.count(),
    db.dynamicBillCreatorFeedbackCounts.count(),
    db.dynamicBillCreatorReviewPrompts.count(),
    db.dynamicBillRotationRecords.count(),
    getDynamicSyncState(),
  ]);
  const statusCounts = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const lastGeneratedAt = items.reduce((latest, item) => Math.max(latest, item.generatedAt ?? 0), 0);

  return {
    activeFollowedCreatorCount: creators.filter(creator => creator.isActive !== false).length,
    followedVideoUpdateCount: updatesCount,
    billItemCount: items.length,
    rotationRecordCount,
    creatorPauseCount: activeCreatorPauses.length,
    feedbackActionCount: actionCount,
    creatorFeedbackCount,
    creatorReviewPromptCount: promptCount,
    activeCreatorPauses,
    unopenedItems: statusCounts.unopened ?? 0,
    openedItems: statusCounts.opened ?? 0,
    consumedItems: statusCounts.consumed ?? 0,
    processedItems: statusCounts.processed ?? 0,
    explanationCount,
    lastGeneratedAt: normalizeNullableTimestamp(lastGeneratedAt),
    lastSyncedAt: normalizeNullableTimestamp(syncState.lastSuccessAt),
    syncStatus: syncState.status,
  };
}

async function summarizeBlindBoxDrawHistory(): Promise<LocalDataPrivacySummary['blindBoxDrawHistory']> {
  const [bvids, updatedAt, usage] = await Promise.all([
    getBlindBoxRecentDrawnBvids(),
    getBlindBoxDrawHistoryUpdatedAt(),
    getRegisteredLocalDataCategories()
      .find(category => category.id === 'blindBoxDrawHistory')
      ?.collectUsage(),
  ]);
  return {
    recentDrawCount: bvids.length,
    maxRecentDraws: BLIND_BOX_DRAW_HISTORY_LIMIT,
    usageBytes: usage?.usageBytes ?? 0,
    lastUpdatedAt: updatedAt,
  };
}

function mergeClearedCounts(results: LocalDataCategoryLifecycleResult[]): LocalDataClearedCounts {
  const cleared: LocalDataClearedCounts = {};
  const mutable = cleared as Record<string, number | boolean | undefined>;
  for (const result of results) {
    if (result.status !== 'success') continue;
    for (const [key, value] of Object.entries(result.clearResult.cleared)) {
      if (typeof value === 'number') {
        const previous = mutable[key];
        mutable[key] = (typeof previous === 'number' ? previous : 0) + value;
      } else if (typeof value === 'boolean' && value) {
        mutable[key] = true;
      }
    }
  }
  return cleared;
}

function summarizeLifecycleResults(
  results: LocalDataCategoryLifecycleResult[],
): NonNullable<LocalDataOperationResult['categoryResults']> {
  return {
    completed: results
      .filter((result): result is Extract<LocalDataCategoryLifecycleResult, { status: 'success' }> =>
        result.status === 'success')
      .map(result => ({
        id: result.id,
        label: result.label,
        beforeCount: result.before.count,
        beforeUsageBytes: result.before.usageBytes,
        afterCount: result.after.count,
        afterUsageBytes: result.after.usageBytes,
      })),
    failed: results
      .filter((result): result is Extract<LocalDataCategoryLifecycleResult, { status: 'failure' }> =>
        result.status === 'failure')
      .map(result => ({
        id: result.id,
        label: result.label,
        message: result.message,
      })),
  };
}

function latestTimestamp(...values: Array<number | null | undefined>): number | null {
  return normalizeNullableTimestamp(Math.max(0, ...values.map(value => Number(value) || 0)));
}

function normalizeNullableTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function serializedSize(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
}

function serializedRowsSize(rows: unknown[]): number {
  return rows.reduce<number>((sum, row) => sum + serializedSize(row), 0);
}
