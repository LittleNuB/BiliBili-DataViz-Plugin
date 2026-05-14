import type { WatchHistoryRecord, DailyAggregate } from '../../shared/types/watch-event';
import { DURATION_BUCKETS } from '../../shared/constants';
import { dateKey, startOfWeek, startOfMonth } from '../../shared/utils/time';
import { getRecordsByDateRange } from '../storage/watch-history-repo';

/** Group records by date key (YYYY-MM-DD) */
export function groupByDay(records: WatchHistoryRecord[]): Map<string, WatchHistoryRecord[]> {
  const map = new Map<string, WatchHistoryRecord[]>();
  for (const r of records) {
    const key = dateKey(new Date(r.viewAt * 1000));
    const bucket = map.get(key);
    if (bucket) bucket.push(r);
    else map.set(key, [r]);
  }
  return map;
}

/** Group records by their hour-of-day for heatmap */
export function groupByHour(records: WatchHistoryRecord[]): Map<number, WatchHistoryRecord[]> {
  const map = new Map<number, WatchHistoryRecord[]>();
  for (const r of records) {
    const hour = new Date(r.viewAt * 1000).getHours();
    const bucket = map.get(hour);
    if (bucket) bucket.push(r);
    else map.set(hour, [r]);
  }
  return map;
}

/** Partition records by weekday (0=Sun → 6=Sat) and hour */
export function buildHeatmap(records: WatchHistoryRecord[]): number[][] {
  // Init 24×7 matrix
  const heatmap: number[][] = [];
  for (let hour = 0; hour < 24; hour++) {
    heatmap.push(new Array(7).fill(0));
  }
  for (const r of records) {
    const d = new Date(r.viewAt * 1000);
    const hour = d.getHours();
    const day = d.getDay(); // 0=Sun
    heatmap[hour][day] += r.progress > 0 ? r.progress : 0;
  }
  return heatmap;
}

/** Aggregate a set of records into a windowed summary (used for week/month rollups) */
export function aggregateWindow(records: WatchHistoryRecord[]): {
  totalWatchTime: number;
  videoCount: number;
  avgCompletion: number;
  uniqueCreators: number;
  uniqueCategories: number;
  categoryBreakdown: Record<string, number>;
  creatorBreakdown: Record<string, number>;
  durationBreakdown: Record<string, number>;
  hourlyHeatmap: number[][];
} {
  const creators = new Set<number>();
  const categories = new Set<string>();
  const catMap: Record<string, number> = {};
  const creatorMap: Record<string, number> = {};
  const durMap: Record<string, number> = {};
  for (const b of DURATION_BUCKETS) durMap[b.label] = 0;

  let totalWatch = 0;
  let totalCompletion = 0;

  for (const r of records) {
    const watchTime = r.progress > 0 ? r.progress : 0;
    totalWatch += watchTime;

    if (r.authorMid) {
      creators.add(r.authorMid);
      creatorMap[r.authorMid] = (creatorMap[r.authorMid] ?? 0) + watchTime;
    }

    if (r.tagName) {
      categories.add(r.tagName);
      catMap[r.tagName] = (catMap[r.tagName] ?? 0) + watchTime;
    }

    const completion = r.duration > 0 ? r.progress / r.duration : 0;
    totalCompletion += completion;

    // Duration bucket
    const dur = r.duration;
    for (const b of DURATION_BUCKETS) {
      if (dur >= b.min && dur < b.max) {
        durMap[b.label] = (durMap[b.label] ?? 0) + 1;
        break;
      }
    }
  }

  const n = records.length || 1;
  return {
    totalWatchTime: totalWatch,
    videoCount: records.length,
    avgCompletion: n > 0 ? totalCompletion / n : 0,
    uniqueCreators: creators.size,
    uniqueCategories: categories.size,
    categoryBreakdown: catMap,
    creatorBreakdown: creatorMap,
    durationBreakdown: durMap,
    hourlyHeatmap: buildHeatmap(records),
  };
}

/** Compute a full DailyAggregate for a given date */
export async function aggregateDay(date: string): Promise<DailyAggregate> {
  const records = await getRecordsByDateRange(date, date);
  const windowed = aggregateWindow(records);

  return {
    date,
    ...windowed,
    sessions: 0,
    totalSeeks: 0,
    totalPauses: 0,
    avgDecisionTime: 0,
    efficiencyScore: 0,
  };
}

/** Sum multiple DailyAggregates into one windowed aggregate */
export function sumAggregates(aggregates: DailyAggregate[]): Omit<DailyAggregate, 'id' | 'date'> {
  if (aggregates.length === 0) {
    return {
      totalWatchTime: 0,
      videoCount: 0,
      avgCompletion: 0,
      uniqueCreators: 0,
      uniqueCategories: 0,
      categoryBreakdown: {},
      creatorBreakdown: {},
      durationBreakdown: {},
      hourlyHeatmap: Array.from({ length: 24 }, () => new Array(7).fill(0)),
      sessions: 0,
      totalSeeks: 0,
      totalPauses: 0,
      avgDecisionTime: 0,
      efficiencyScore: 0,
    };
  }

  const result: ReturnType<typeof sumAggregates> = {
    totalWatchTime: 0,
    videoCount: 0,
    avgCompletion: 0,
    uniqueCreators: 0,
    uniqueCategories: 0,
    categoryBreakdown: {},
    creatorBreakdown: {},
    durationBreakdown: {},
    hourlyHeatmap: Array.from({ length: 24 }, () => new Array(7).fill(0)),
    sessions: 0,
    totalSeeks: 0,
    totalPauses: 0,
    avgDecisionTime: 0,
    efficiencyScore: 0,
  };

  const allCreators = new Set<number>();
  const allCategories = new Set<string>();

  for (const a of aggregates) {
    result.totalWatchTime += a.totalWatchTime;
    result.videoCount += a.videoCount;
    result.sessions += a.sessions;
    result.totalSeeks += a.totalSeeks;
    result.totalPauses += a.totalPauses;

    for (const [cat, sec] of Object.entries(a.categoryBreakdown)) {
      result.categoryBreakdown[cat] = (result.categoryBreakdown[cat] ?? 0) + sec;
      allCategories.add(cat);
    }
    for (const [mid, sec] of Object.entries(a.creatorBreakdown)) {
      result.creatorBreakdown[mid] = (result.creatorBreakdown[mid] ?? 0) + sec;
      allCreators.add(Number(mid));
    }
    for (const [label, count] of Object.entries(a.durationBreakdown)) {
      result.durationBreakdown[label] = (result.durationBreakdown[label] ?? 0) + count;
    }
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        result.hourlyHeatmap[h][d] += a.hourlyHeatmap[h]?.[d] ?? 0;
      }
    }
  }

  result.avgCompletion = aggregates.reduce((s, a) => s + a.avgCompletion, 0) / aggregates.length;
  result.uniqueCreators = allCreators.size;
  result.uniqueCategories = allCategories.size;
  result.efficiencyScore = aggregates.length > 0
    ? aggregates.reduce((s, a) => s + a.efficiencyScore, 0) / aggregates.length
    : 0;

  return result;
}
