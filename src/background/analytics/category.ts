import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type {
  CategoryDistribution,
  HistoryCoverage,
  InterestDrift,
  InterestDriftGranularity,
  DurationBucket,
  PreferenceAnalytics,
} from '../../shared/types/analytics';
import { DURATION_BUCKETS } from '../../shared/constants';
import {
  getNewestRecord,
  getOldestRecord,
  getRecordsByDateRange,
  getTotalCount,
} from '../storage/watch-history-repo';
import { dateKey, daysBetween, startOfMonth, startOfWeek } from '../../shared/utils/time';

export function computeCategoryDistribution(records: WatchHistoryRecord[]): CategoryDistribution[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const r of records) {
    const tag = r.tagName || '其他';
    const watchTime = r.progress > 0 ? r.progress : 0;
    map.set(tag, (map.get(tag) ?? 0) + watchTime);
    total += watchTime;
  }

  const result: CategoryDistribution[] = [];
  for (const [name, watchTime] of map) {
    result.push({ name, watchTime, percentage: total > 0 ? watchTime / total : 0 });
  }
  result.sort((a, b) => b.watchTime - a.watchTime);
  return result;
}

export function computeDurationBuckets(records: WatchHistoryRecord[]): DurationBucket[] {
  const map = new Map<string, number>();
  for (const b of DURATION_BUCKETS) map.set(b.label, 0);

  for (const r of records) {
    const d = r.duration || 0;
    for (const b of DURATION_BUCKETS) {
      if (d >= b.min && d < b.max) {
        map.set(b.label, (map.get(b.label) ?? 0) + 1);
        break;
      }
    }
  }

  return DURATION_BUCKETS.map(b => ({
    label: b.label,
    min: b.min,
    max: b.max,
    count: map.get(b.label) ?? 0,
  }));
}

export function computeTopTags(records: WatchHistoryRecord[], limit = 30): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of records) {
    for (const tag of r.tags ?? []) {
      if (!tag) continue;
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
    // Also count the primary tag
    if (r.tagName) {
      map.set(r.tagName, (map.get(r.tagName) ?? 0) + 1);
    }
  }

  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function getDefaultInterestDriftGranularity(coverage: HistoryCoverage): InterestDriftGranularity {
  if (coverage.coveredDays < 14) return 'daily';
  if (coverage.coveredDays < 90) return 'weekly';
  return 'monthly';
}

export function computeInterestDrift(
  records: WatchHistoryRecord[],
  coverage: HistoryCoverage,
  granularity: InterestDriftGranularity,
): InterestDrift[] {
  if (!coverage.earliestDate || !coverage.latestDate) return [];

  const periods = buildPeriods(coverage.earliestDate, coverage.latestDate, granularity);
  const byPeriod = new Map(periods.map(period => [period.period, period]));

  for (const record of records) {
    const recordDate = dateKeyFromRecord(record);
    const period = byPeriod.get(periodKey(recordDate, granularity));
    if (!period) continue;

    const category = record.tagName || '其他';
    const watchTime = Math.max(0, record.progress || 0);
    period.recordCount++;
    period.totalWatchTime += watchTime;
    period.activeDates.add(recordDate);
    period.merged[category] = (period.merged[category] ?? 0) + watchTime;
  }

  return periods.map((period) => {
    const totalSec = Object.values(period.merged).reduce((sum, value) => sum + value, 0);
    const categories: Record<string, number> = {};
    for (const [category, seconds] of Object.entries(period.merged)) {
      categories[category] = totalSec > 0 ? Math.round((seconds / totalSec) * 1000) / 10 : 0;
    }

    return {
      month: period.period,
      period: period.period,
      label: period.label,
      granularity,
      startDate: period.startDate,
      endDate: period.endDate,
      categories,
      recordCount: period.recordCount,
      activeDays: period.activeDates.size,
      totalWatchTime: Math.round(period.totalWatchTime),
    };
  });
}

export async function getPreferenceData(): Promise<PreferenceAnalytics> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startKey = dateKey(thirtyDaysAgo);
  const endKey = dateKey(now);

  const [records, oldest, newest, totalRecords] = await Promise.all([
    getRecordsByDateRange(startKey, endKey),
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
  const defaultDriftGranularity = getDefaultInterestDriftGranularity(coverage);
  const driftByGranularity: Record<InterestDriftGranularity, InterestDrift[]> = {
    daily: computeInterestDrift(allRecords, coverage, 'daily'),
    weekly: computeInterestDrift(allRecords, coverage, 'weekly'),
    monthly: computeInterestDrift(allRecords, coverage, 'monthly'),
  };

  return {
    categories: computeCategoryDistribution(records),
    drift: driftByGranularity[defaultDriftGranularity],
    driftByGranularity,
    defaultDriftGranularity,
    coverage,
    durationBuckets: computeDurationBuckets(records),
    topTags: computeTopTags(records),
  };
}

function buildHistoryCoverage(
  oldest: WatchHistoryRecord | undefined,
  newest: WatchHistoryRecord | undefined,
  totalRecords: number,
  records: WatchHistoryRecord[],
): HistoryCoverage {
  if (!oldest || !newest || totalRecords === 0) {
    return {
      earliestDate: null,
      latestDate: null,
      activeDays: 0,
      totalRecords,
      coveredDays: 0,
    };
  }

  const earliestDate = dateKeyFromRecord(oldest);
  const latestDate = dateKeyFromRecord(newest);
  const activeDates = new Set(records.map(dateKeyFromRecord));

  return {
    earliestDate,
    latestDate,
    activeDays: activeDates.size,
    totalRecords,
    coveredDays: daysBetween(parseDateKey(earliestDate), parseDateKey(latestDate)) + 1,
  };
}

interface InterestPeriod {
  period: string;
  label: string;
  startDate: string;
  endDate: string;
  merged: Record<string, number>;
  recordCount: number;
  activeDates: Set<string>;
  totalWatchTime: number;
}

function buildPeriods(
  earliestDate: string,
  latestDate: string,
  granularity: InterestDriftGranularity,
): InterestPeriod[] {
  const periods: InterestPeriod[] = [];
  const end = parseDateKey(latestDate);
  let cursor = periodStart(parseDateKey(earliestDate), granularity);

  while (cursor.getTime() <= end.getTime()) {
    const start = new Date(cursor);
    const next = addPeriod(start, granularity);
    const periodEnd = new Date(Math.min(next.getTime() - 1, end.getTime()));
    const period = dateKey(start);
    periods.push({
      period,
      label: periodLabel(start, periodEnd, granularity),
      startDate: period,
      endDate: dateKey(periodEnd),
      merged: {},
      recordCount: 0,
      activeDates: new Set<string>(),
      totalWatchTime: 0,
    });
    cursor = next;
  }

  return periods;
}

function periodKey(recordDate: string, granularity: InterestDriftGranularity): string {
  return dateKey(periodStart(parseDateKey(recordDate), granularity));
}

function periodStart(date: Date, granularity: InterestDriftGranularity): Date {
  if (granularity === 'weekly') return startOfWeek(date);
  if (granularity === 'monthly') return startOfMonth(date);
  return parseDateKey(dateKey(date));
}

function addPeriod(date: Date, granularity: InterestDriftGranularity): Date {
  const next = new Date(date);
  if (granularity === 'monthly') {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setDate(next.getDate() + (granularity === 'weekly' ? 7 : 1));
  }
  return next;
}

function periodLabel(start: Date, end: Date, granularity: InterestDriftGranularity): string {
  if (granularity === 'monthly') {
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  }

  const startLabel = shortDateLabel(start);
  if (granularity === 'daily') return startLabel;
  return `${startLabel}~${shortDateLabel(end)}`;
}

function shortDateLabel(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateKeyFromRecord(record: WatchHistoryRecord): string {
  return dateKey(new Date(record.viewAt * 1000));
}
