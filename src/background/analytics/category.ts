import type { PreferenceAnalytics } from '../../shared/types/analytics';
import {
  getNewestRecord,
  getOldestRecord,
  getRecordsByDateRange,
  getTotalCount,
} from '../storage/watch-history-repo';
import {
  buildHistoryCoverage,
  buildPreferenceWindowOptions,
  buildPreferenceWindowSummary,
  computeCategoryDistribution,
  computeDurationBuckets,
  computeTopTags,
  getDefaultInterestDriftGranularity,
  normalizePreferenceGranularity,
  resolveSelectedPreferenceWindow,
} from './preference-windows';

interface PreferenceWindowRequest {
  granularity?: unknown;
  windowStart?: unknown;
}

export {
  buildHistoryCoverage,
  buildPreferenceWindowOptions,
  buildPreferenceWindowSummary,
  computeCategoryDistribution,
  computeDurationBuckets,
  computeTopTags,
  getDefaultInterestDriftGranularity,
} from './preference-windows';

export async function getPreferenceData(
  request: PreferenceWindowRequest = {},
): Promise<PreferenceAnalytics> {
  const [oldest, newest, totalRecords] = await Promise.all([
    getOldestRecord(),
    getNewestRecord(),
    getTotalCount(),
  ]);
  const earliestDate = oldest ? dateKeyFromRecord(oldest) : null;
  const latestDate = newest ? dateKeyFromRecord(newest) : null;
  const allRecords = earliestDate && latestDate && totalRecords > 0
    ? await getRecordsByDateRange(earliestDate, latestDate)
    : [];
  const coverage = buildHistoryCoverage(oldest, newest, totalRecords, allRecords);
  const windows = {
    daily: buildPreferenceWindowOptions(allRecords, coverage, 'daily'),
    weekly: buildPreferenceWindowOptions(allRecords, coverage, 'weekly'),
    monthly: buildPreferenceWindowOptions(allRecords, coverage, 'monthly'),
  };
  const defaultGranularity = getDefaultInterestDriftGranularity(coverage);
  const selectedGranularity = normalizePreferenceGranularity(request.granularity) ?? defaultGranularity;
  const selectedWindow = resolveSelectedPreferenceWindow(windows[selectedGranularity], request.windowStart);

  return {
    windows,
    selectedWindow: selectedWindow ? buildPreferenceWindowSummary(allRecords, selectedWindow) : null,
    defaultGranularity,
    coverage,
  };
}

function dateKeyFromRecord(record: { viewAt: number }): string {
  const date = new Date(record.viewAt * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
