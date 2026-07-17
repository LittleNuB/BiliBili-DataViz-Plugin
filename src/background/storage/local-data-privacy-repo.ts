import { LOCAL_DATA_CLEAR_CONFIRMATION } from '../../shared/local-data-privacy.ts';
import { runLocalDataCategoryLifecycle } from '../../shared/local-data-category-contract.ts';
import { DYNAMIC_BILL_LOCAL_DATA_CLEAR_FAILED_MESSAGE } from '../../shared/dynamic-bill-errors.ts';
import type {
  LocalDataOperationResult,
  LocalDataPrivacySummary,
} from '../../shared/types/local-data-privacy.ts';
import { ensureDynamicBill013Migration } from '../dynamic-bill/migration.ts';
import { clearTemporaryCurrentVideoTranscriptCache } from '../current-video-temporary-transcript-cache.ts';
import { runCurrentVideoTranscriptClearCoordinator } from '../current-video-transcript-clear-epoch.ts';
import { getDynamicBillActiveCreatorPauseViews, getDynamicSyncState } from './dynamic-bill-repo.ts';
import { db } from './db.ts';
import { getRegisteredLocalDataCategories } from './local-data-category-registry.ts';
import {
  getBackfillComplete,
  getHistorySyncing,
  getLastSyncTime,
} from './config-store.ts';
import {
  coordinateBlindBoxDrawHistoryClear,
  getBlindBoxRecentDrawnBvids,
} from './blind-box-draw-history-repo.ts';
import { coordinateCurrentVideoPrimaryTextSelectionClear } from './current-video-primary-text-selection-store.ts';

export async function getLocalDataPrivacySummary(): Promise<LocalDataPrivacySummary> {
  await ensureDynamicBill013Migration();
  const [
    history,
    favorites,
    currentVideoSubtitles,
    dynamicBill,
  ] = await Promise.all([
    summarizeHistory(),
    summarizeFavorites(),
    summarizeCurrentVideoSubtitles(),
    summarizeDynamicBill(),
  ]);

  return {
    checkedAt: Date.now(),
    history,
    favorites,
    currentVideoSubtitles,
    dynamicBill,
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

export async function clearAllLocalData(confirmation: unknown): Promise<LocalDataOperationResult> {
  if (confirmation !== LOCAL_DATA_CLEAR_CONFIRMATION) {
    throw new Error('LOCAL_DATA_CLEAR_CONFIRMATION_REQUIRED');
  }
  await ensureDynamicBill013Migration();
  if (await getHistorySyncing()) {
    throw new Error('HISTORY_SYNC_IN_PROGRESS');
  }
  return await coordinateCurrentVideoPrimaryTextSelectionClear(async () =>
    runCurrentVideoTranscriptClearCoordinator(async () =>
      coordinateBlindBoxDrawHistoryClear(async recentDrawnBvids => {
        const counts = await collectClearCounts(recentDrawnBvids.length);
        await db.transaction('rw', db.tables, async () => {
          for (const table of db.tables) {
            await table.clear();
          }
        });
        await chrome.storage.local.clear();
        clearTemporaryCurrentVideoTranscriptCache();

        return {
          operation: 'clear_all_local_data',
          completedAt: Date.now(),
          cleared: {
            ...counts,
            localSettings: true,
          },
        };
      })));
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

async function collectClearCounts(
  coordinatedBlindBoxDrawHistoryCount?: number,
): Promise<Required<Omit<LocalDataOperationResult['cleared'], 'localSettings'>>> {
  const [
    historyRecords,
    playerEvents,
    dailyAggregates,
    favoriteFolders,
    favoriteItems,
    smartFavoriteIndexes,
    followedCreators,
    followedVideoUpdates,
    dynamicBillItems,
    dynamicBillExplanations,
    dynamicBillCreatorPauses,
    dynamicBillFeedbackActions,
    dynamicBillCreatorFeedbackCounts,
    dynamicBillCreatorReviewPrompts,
    dynamicBillRotationRecords,
    currentVideoSubtitleSources,
    currentVideoSubtitleSegments,
    blindBoxDrawHistory,
  ] = await Promise.all([
    db.watchHistory.count(),
    db.playerEvents.count(),
    db.dailyAggregates.count(),
    db.favoriteFolders.count(),
    db.favoriteItems.count(),
    db.smartFavoriteIndex.count(),
    db.followedCreators.count(),
    db.followedVideoUpdates.count(),
    db.dynamicBillItems.count(),
    db.dynamicBillExplanations.count(),
    db.dynamicBillCreatorPauses.count(),
    db.dynamicBillFeedbackActions.count(),
    db.dynamicBillCreatorFeedbackCounts.count(),
    db.dynamicBillCreatorReviewPrompts.count(),
    db.dynamicBillRotationRecords.count(),
    db.currentVideoTranscriptSources.count(),
    db.currentVideoTranscriptSegments.count(),
    coordinatedBlindBoxDrawHistoryCount ?? getBlindBoxRecentDrawnBvids().then(bvids => bvids.length),
  ]);

  return {
    historyRecords,
    playerEvents,
    dailyAggregates,
    favoriteFolders,
    favoriteItems,
    smartFavoriteIndexes,
    followedCreators,
    followedVideoUpdates,
    dynamicBillItems,
    dynamicBillExplanations,
    dynamicBillCreatorPauses,
    dynamicBillFeedbackActions,
    dynamicBillCreatorFeedbackCounts,
    dynamicBillCreatorReviewPrompts,
    dynamicBillRotationRecords,
    currentVideoSubtitleSources,
    currentVideoSubtitleSegments,
    blindBoxDrawHistory,
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
