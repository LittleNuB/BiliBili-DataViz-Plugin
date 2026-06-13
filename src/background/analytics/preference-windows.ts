import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type {
  CategoryDistribution,
  DurationBucket,
  HistoryCoverage,
  InterestDriftGranularity,
  PreferenceWindowOption,
  PreferenceWindowStateReason,
  PreferenceWindowSummary,
} from '../../shared/types/analytics';
import { DURATION_BUCKETS } from '../../shared/constants.ts';
import { dateKey, daysBetween, startOfMonth, startOfWeek } from '../../shared/utils/time.ts';

const MIN_WINDOW_RECORDS_FOR_VISUALS = 3;
const MIN_WINDOW_WATCH_SECONDS_FOR_VISUALS = 600;

interface PreferencePeriodBucket {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  recordCount: number;
  activeDates: Set<string>;
  totalWatchTime: number;
}

export function computeCategoryDistribution(records: WatchHistoryRecord[]): CategoryDistribution[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const record of records) {
    const category = record.tagName || '其他';
    const watchTime = Math.max(0, record.progress || 0);
    map.set(category, (map.get(category) ?? 0) + watchTime);
    total += watchTime;
  }

  return Array.from(map.entries())
    .map(([name, watchTime]) => ({
      name,
      watchTime,
      percentage: total > 0 ? watchTime / total : 0,
    }))
    .sort((a, b) => b.watchTime - a.watchTime);
}

export function computeDurationBuckets(records: WatchHistoryRecord[]): DurationBucket[] {
  const map = new Map<string, number>();
  for (const bucket of DURATION_BUCKETS) map.set(bucket.label, 0);

  for (const record of records) {
    const duration = record.duration || 0;
    for (const bucket of DURATION_BUCKETS) {
      if (duration >= bucket.min && duration < bucket.max) {
        map.set(bucket.label, (map.get(bucket.label) ?? 0) + 1);
        break;
      }
    }
  }

  return DURATION_BUCKETS.map(bucket => ({
    label: bucket.label,
    min: bucket.min,
    max: bucket.max,
    count: map.get(bucket.label) ?? 0,
  }));
}

export function computeTopTags(records: WatchHistoryRecord[], limit = 30): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const record of records) {
    for (const tag of record.tags ?? []) {
      if (!tag) continue;
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
    if (record.tagName) {
      map.set(record.tagName, (map.get(record.tagName) ?? 0) + 1);
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

export function buildHistoryCoverage(
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

export function buildPreferenceWindowOptions(
  records: WatchHistoryRecord[],
  coverage: HistoryCoverage,
  granularity: InterestDriftGranularity,
): PreferenceWindowOption[] {
  if (!coverage.earliestDate || !coverage.latestDate) return [];
  const earliestDate = coverage.earliestDate;
  const latestDate = coverage.latestDate;

  const periods = buildPeriods(earliestDate, latestDate, granularity);
  const byPeriod = new Map(periods.map(period => [period.key, period]));

  for (const record of records) {
    const recordDate = dateKeyFromRecord(record);
    const period = byPeriod.get(periodKey(recordDate, granularity));
    if (!period) continue;

    period.recordCount++;
    period.activeDates.add(recordDate);
    period.totalWatchTime += Math.max(0, record.progress || 0);
  }

  return periods
    .map((period) => ({
      key: period.key,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      granularity,
      recordCount: period.recordCount,
      activeDays: period.activeDates.size,
      totalWatchTime: Math.round(period.totalWatchTime),
      partialCoverage: period.startDate < earliestDate || period.endDate > latestDate,
    }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function buildPreferenceWindowSummary(
  records: WatchHistoryRecord[],
  window: PreferenceWindowOption,
): PreferenceWindowSummary {
  const windowRecords = records.filter((record) => {
    const recordDate = dateKeyFromRecord(record);
    return recordDate >= window.startDate && recordDate <= window.endDate;
  });
  const categories = computeCategoryDistribution(windowRecords);
  const durationBuckets = computeDurationBuckets(windowRecords);
  const topTags = computeTopTags(windowRecords, 50);
  const stateReason = getPreferenceWindowStateReason(window.recordCount, window.totalWatchTime);

  return {
    window,
    state: stateReason === null ? 'ready' : stateReason === 'too_few_records' || stateReason === 'too_little_watch_time'
      ? 'insufficient_sample'
      : 'empty',
    stateReason,
    categories,
    durationBuckets,
    topTags,
  };
}

export function resolveSelectedPreferenceWindow(
  windows: PreferenceWindowOption[],
  requestedStart: unknown,
): PreferenceWindowOption | null {
  const requested = typeof requestedStart === 'string' ? requestedStart : null;
  if (requested) {
    const matched = windows.find(window => window.startDate === requested);
    if (matched) return matched;
  }

  return windows[0] ?? null;
}

export function normalizePreferenceGranularity(value: unknown): InterestDriftGranularity | null {
  if (value === 'daily' || value === 'weekly' || value === 'monthly') return value;
  return null;
}

function getPreferenceWindowStateReason(
  recordCount: number,
  totalWatchTime: number,
): PreferenceWindowStateReason | null {
  if (recordCount === 0) return 'no_records';
  if (totalWatchTime <= 0) return 'no_watch_time';
  if (recordCount < MIN_WINDOW_RECORDS_FOR_VISUALS) return 'too_few_records';
  if (totalWatchTime < MIN_WINDOW_WATCH_SECONDS_FOR_VISUALS) return 'too_little_watch_time';
  return null;
}

function buildPeriods(
  earliestDate: string,
  latestDate: string,
  granularity: InterestDriftGranularity,
): PreferencePeriodBucket[] {
  const periods: PreferencePeriodBucket[] = [];
  let cursor = periodStart(parseDateKey(earliestDate), granularity);
  const lastStart = periodStart(parseDateKey(latestDate), granularity);

  while (cursor.getTime() <= lastStart.getTime()) {
    const start = new Date(cursor);
    const next = addPeriod(start, granularity);
    const end = addDays(next, -1);
    const startDate = dateKey(start);
    periods.push({
      key: startDate,
      label: periodLabel(start, end, granularity),
      startDate,
      endDate: dateKey(end),
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

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function periodLabel(start: Date, end: Date, granularity: InterestDriftGranularity): string {
  if (granularity === 'monthly') {
    return `${start.getFullYear()}年${String(start.getMonth() + 1).padStart(2, '0')}月`;
  }
  if (granularity === 'daily') {
    return `${dateKey(start)} ${weekdayLabel(start)}`;
  }
  return `${dateKey(start)} 至 ${dateKey(end)}`;
}

function weekdayLabel(date: Date): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()] ?? '';
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateKeyFromRecord(record: WatchHistoryRecord): string {
  return dateKey(new Date(record.viewAt * 1000));
}
