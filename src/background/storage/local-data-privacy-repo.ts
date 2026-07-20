import { LOCAL_DATA_CLEAR_CONFIRMATION } from '../../shared/local-data-privacy.ts';
import {
  runLocalDataCategoryLifecycle,
  runLocalDataCategoryLifecycles,
  type IndependentlyClearableLocalDataCategoryId,
  type LocalDataCategoryLifecycleResult,
  type LocalDataClearedCounts,
} from '../../shared/local-data-category-contract.ts';
import { DYNAMIC_BILL_LOCAL_DATA_CLEAR_FAILED_MESSAGE } from '../../shared/dynamic-bill-errors.ts';
import type {
  LocalDataOperationResult,
  LocalDataPrivacySummary,
} from '../../shared/types/local-data-privacy.ts';
import { ensureDynamicBill013Migration } from '../dynamic-bill/migration.ts';
import { runDynamicBillDataOperation } from '../dynamic-bill/operation-control.ts';
import { runHistoryClearDataOperation } from '../sync/sync-control.ts';
import {
  beginCurrentVideoTranscriptClearWindow,
} from '../current-video-transcript-clear-epoch.ts';
import {
  beginCurrentVideoSummaryHighlightsClearWindow,
} from '../current-video-summary-highlights-clear-epoch.ts';
import { getDynamicBillLocalDataPrivacySummary } from './dynamic-bill-repo.ts';
import {
  getRegisteredLocalDataCategories,
  getRegisteredLocalDataCategory,
} from './local-data-category-registry.ts';
import {
  getHistorySyncing,
} from './config-store.ts';
import {
  BLIND_BOX_DRAW_HISTORY_LIMIT,
  beginBlindBoxDrawHistoryClearWindow,
  collectBlindBoxDrawHistoryUsage,
  getBlindBoxDrawHistoryUpdatedAt,
  getBlindBoxRecentDrawnBvids,
} from './blind-box-draw-history-repo.ts';
import {
  collectCurrentVideoSummaryHighlightsCacheUsage,
} from './current-video-summary-highlights-repo.ts';
import {
  beginCurrentVideoPrimaryTextSelectionClearWindow,
} from './current-video-primary-text-selection-store.ts';
import {
  beginCurrentVideoQaSessionClearWindow,
  collectCurrentVideoQaSessionUsage,
} from './current-video-qa-session-repo.ts';
import { getHistoryLocalDataPrivacySummary } from './watch-history-repo.ts';
import { getFavoritesLocalDataPrivacySummary } from './favorite-repo.ts';
import { getCurrentVideoTranscriptLocalDataPrivacySummary } from './current-video-transcript-repo.ts';

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
    getHistoryLocalDataPrivacySummary(),
    getFavoritesLocalDataPrivacySummary(),
    getCurrentVideoTranscriptLocalDataPrivacySummary(),
    summarizeCurrentVideoSummaryHighlights(),
    summarizeCurrentVideoQaSessions(),
    getDynamicBillLocalDataPrivacySummary(),
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

export async function clearLocalDataCategory(
  id: IndependentlyClearableLocalDataCategoryId,
): Promise<LocalDataOperationResult> {
  const run = async (): Promise<LocalDataOperationResult> => {
    const category = getRegisteredLocalDataCategory(id);
    if (!category) throw new Error('LOCAL_DATA_CATEGORY_NOT_FOUND');
    const lifecycle = await runLocalDataCategoryLifecycle(category);
    return {
      operation: 'clear_local_data_category',
      status: lifecycle.status === 'failure' ? 'partial_failure' : 'completed',
      completedAt: Date.now(),
      cleared: mergeClearedCounts([lifecycle]),
      categoryResults: summarizeLifecycleResults([lifecycle]),
    };
  };

  if (id === 'history') {
    return runHistoryClearDataOperation(async () => {
      if (await getHistorySyncing()) throw new Error('HISTORY_SYNC_IN_PROGRESS');
      return run();
    });
  }
  if (id === 'dynamicBill') return runDynamicBillDataOperation(run);
  return run();
}

export async function clearCurrentVideoSubtitleCache(): Promise<LocalDataOperationResult> {
  return {
    ...await clearLocalDataCategory('currentVideoSubtitles'),
    operation: 'clear_current_video_subtitle_cache',
  };
}

export async function clearCurrentVideoSummaryHighlightCache(): Promise<LocalDataOperationResult> {
  return {
    ...await clearLocalDataCategory('currentVideoSummaryHighlights'),
    operation: 'clear_current_video_summary_highlight_cache',
  };
}

export async function clearDynamicBillLocalData(): Promise<LocalDataOperationResult> {
  await ensureDynamicBill013Migration();
  const result = await clearLocalDataCategory('dynamicBill');
  if (result.status === 'partial_failure') {
    throw new Error(DYNAMIC_BILL_LOCAL_DATA_CLEAR_FAILED_MESSAGE);
  }

  return {
    ...result,
    operation: 'clear_dynamic_bill_data',
  };
}

export function clearAllLocalData(confirmation: unknown): Promise<LocalDataOperationResult> {
  if (confirmation !== LOCAL_DATA_CLEAR_CONFIRMATION) {
    return Promise.reject(new Error('LOCAL_DATA_CLEAR_CONFIRMATION_REQUIRED'));
  }
  return runHistoryClearDataOperation(
    () => runDynamicBillDataOperation(clearAllLocalDataExclusive),
  );
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

async function summarizeBlindBoxDrawHistory(): Promise<LocalDataPrivacySummary['blindBoxDrawHistory']> {
  const [bvids, updatedAt, usage] = await Promise.all([
    getBlindBoxRecentDrawnBvids(),
    getBlindBoxDrawHistoryUpdatedAt(),
    collectBlindBoxDrawHistoryUsage(chrome.storage.local),
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
