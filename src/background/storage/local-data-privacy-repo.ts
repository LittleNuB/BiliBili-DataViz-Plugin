import { LOCAL_DATA_CLEAR_CONFIRMATION } from '../../shared/local-data-privacy.ts';
import type {
  LocalDataOperationResult,
  LocalDataPrivacySummary,
} from '../../shared/types/local-data-privacy.ts';
import { getDynamicSyncState } from './dynamic-bill-repo.ts';
import { db } from './db.ts';
import {
  getBackfillComplete,
  getHistorySyncing,
  getLastSyncTime,
} from './config-store.ts';
import {
  clearRegisteredLocalDataCategories,
  clearRegisteredLocalDataCategory,
} from './local-data-category-registry.ts';

export async function getLocalDataPrivacySummary(): Promise<LocalDataPrivacySummary> {
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
  const result = await clearRegisteredLocalDataCategory('currentVideoSubtitles');
  return {
    operation: 'clear_current_video_subtitle_cache',
    completedAt: Date.now(),
    cleared: result.cleared,
    categories: [result.category],
  };
}

export async function clearAllLocalData(confirmation: unknown): Promise<LocalDataOperationResult> {
  if (confirmation !== LOCAL_DATA_CLEAR_CONFIRMATION) {
    throw new Error('LOCAL_DATA_CLEAR_CONFIRMATION_REQUIRED');
  }
  if (await getHistorySyncing()) {
    throw new Error('HISTORY_SYNC_IN_PROGRESS');
  }

  const result = await clearRegisteredLocalDataCategories();

  return {
    operation: 'clear_all_local_data',
    completedAt: Date.now(),
    cleared: {
      ...result.cleared,
      localSettings: true,
    },
    categories: result.categories,
  };
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
  const [sources, segmentCount, staleSegmentCount, lastUpdated] = await Promise.all([
    db.currentVideoTranscriptSources.toArray(),
    db.currentVideoTranscriptSegments.count(),
    db.currentVideoTranscriptSegments.where({ stale: true }).count(),
    db.currentVideoTranscriptSources.orderBy('updatedAt').last(),
  ]);
  const cachedVideoCount = new Set(sources.map(source => source.bvid).filter(Boolean)).size;

  return {
    sourceCount: sources.length,
    segmentCount,
    staleSegmentCount,
    cachedVideoCount,
    lastUpdatedAt: normalizeNullableTimestamp(lastUpdated?.updatedAt),
  };
}

async function summarizeDynamicBill(): Promise<LocalDataPrivacySummary['dynamicBill']> {
  const [creators, updatesCount, items, feedbackCount, explanationCount, syncState] = await Promise.all([
    db.followedCreators.toArray(),
    db.followedVideoUpdates.count(),
    db.dynamicBillItems.toArray(),
    db.dynamicBillFeedback.count(),
    db.dynamicBillExplanations.count(),
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
    unopenedItems: statusCounts.unopened ?? 0,
    openedItems: statusCounts.opened ?? 0,
    consumedItems: statusCounts.consumed ?? 0,
    processedItems: statusCounts.processed ?? 0,
    feedbackCount,
    explanationCount,
    lastGeneratedAt: normalizeNullableTimestamp(lastGeneratedAt),
    lastSyncedAt: normalizeNullableTimestamp(syncState.lastSuccessAt),
    syncStatus: syncState.status,
  };
}

function latestTimestamp(...values: Array<number | null | undefined>): number | null {
  return normalizeNullableTimestamp(Math.max(0, ...values.map(value => Number(value) || 0)));
}

function normalizeNullableTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
