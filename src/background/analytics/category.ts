import type { WatchHistoryRecord, DailyAggregate } from '../../shared/types/watch-event';
import type { CategoryDistribution, InterestDrift, DurationBucket } from '../../shared/types/analytics';
import { DURATION_BUCKETS } from '../../shared/constants';
import { getAggregatesSince } from '../storage/aggregate-repo';
import { getRecordsByDateRange } from '../storage/watch-history-repo';
import { dateKey } from '../../shared/utils/time';

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

export async function computeInterestDrift(months = 3): Promise<InterestDrift[]> {
  const now = new Date();
  const results: InterestDrift[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const year = now.getFullYear();
    const month = now.getMonth() - i;
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    const startKey = dateKey(startDate);
    const endKey = dateKey(endDate);
    const aggs = await getAggregatesSince(startKey);
    const monthly = aggs.filter(a => a.date >= startKey && a.date <= endKey);

    const merged: Record<string, number> = {};
    for (const a of monthly) {
      for (const [cat, sec] of Object.entries(a.categoryBreakdown)) {
        merged[cat] = (merged[cat] ?? 0) + sec;
      }
    }

    const totalSec = Object.values(merged).reduce((s, v) => s + v, 0);
    const categories: Record<string, number> = {};
    for (const [cat, sec] of Object.entries(merged)) {
      categories[cat] = totalSec > 0 ? Math.round((sec / totalSec) * 1000) / 10 : 0;
    }

    results.push({
      month: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`,
      categories,
    });
  }

  return results;
}

export async function getPreferenceData(): Promise<{
  categories: CategoryDistribution[];
  drift: InterestDrift[];
  durationBuckets: DurationBucket[];
  topTags: { name: string; count: number }[];
}> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startKey = dateKey(thirtyDaysAgo);
  const endKey = dateKey(now);

  const records = await getRecordsByDateRange(startKey, endKey);

  return {
    categories: computeCategoryDistribution(records),
    drift: await computeInterestDrift(3),
    durationBuckets: computeDurationBuckets(records),
    topTags: computeTopTags(records),
  };
}
