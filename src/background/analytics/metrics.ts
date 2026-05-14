import type { WatchHistoryRecord, DailyAggregate } from '../../shared/types/watch-event';
import type { DashboardOverview, QuickStats } from '../../shared/types/analytics';
import { startOfWeek, startOfMonth, daysAgo, dateKey, daysBetween } from '../../shared/utils/time';
import { percentChange } from '../../shared/utils/math';
import { getAggregate, getAggregatesByDateRange } from '../storage/aggregate-repo';
import { loadConfig } from '../storage/config-store';

export function computeCompletion(records: WatchHistoryRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, r) => {
    return sum + (r.duration > 0 ? r.progress / r.duration : 0);
  }, 0);
  return total / records.length;
}

export function computeStreak(dailyList: DailyAggregate[]): { current: number; longest: number } {
  const dates = new Set(dailyList.map(a => a.date));
  if (dates.size === 0) return { current: 0, longest: 0 };

  let current = 0;
  let longest = 0;
  let streak = 0;

  // Walk backwards from today to find current streak
  for (let i = 0; i < 365; i++) {
    const d = dateKey(daysAgo(i));
    if (dates.has(d)) {
      streak++;
      longest = Math.max(longest, streak);
    } else {
      if (i === 0) {
        // Today has no data yet, try yesterday
        continue;
      }
      break;
    }
  }
  current = streak;

  // Also check historical longest
  let historicalStreak = 0;
  const sorted = dailyList.map(a => a.date).sort();
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) { historicalStreak = 1; continue; }
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    if (daysBetween(prev, curr) === 1) {
      historicalStreak++;
    } else {
      longest = Math.max(longest, historicalStreak);
      historicalStreak = 1;
    }
  }
  longest = Math.max(longest, historicalStreak);

  return { current, longest };
}

export async function getQuickStats(): Promise<QuickStats> {
  const config = await loadConfig();
  const todayKey = dateKey();
  const todayAgg = await getAggregate(todayKey);

  const weekStart = dateKey(startOfWeek());
  const thisWeekAggs = await getAggregatesByDateRange(weekStart, todayKey);

  const weeklyWatch = thisWeekAggs.reduce((s, a) => s + a.totalWatchTime, 0);

  return {
    todayWatchTime: todayAgg?.totalWatchTime ?? 0,
    dailyGoal: config.dailyWatchGoal * 60, // convert minutes to seconds
    streakDays: computeStreak(thisWeekAggs).current,
    avgCompletion: todayAgg?.avgCompletion ?? 0,
    efficiencyScore: todayAgg?.efficiencyScore ?? 0,
    weeklyWatchTime: weeklyWatch,
  };
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const now = new Date();
  const todayKey = dateKey(now);
  const weekStartDate = startOfWeek(now);
  const weekStart = dateKey(weekStartDate);
  const lastWeekStart = dateKey(startOfWeek(daysAgo(7)));
  const lastWeekEndDate = new Date(weekStartDate);
  lastWeekEndDate.setDate(lastWeekEndDate.getDate() - 1);
  const lastWeekEnd = dateKey(lastWeekEndDate);
  const monthStart = dateKey(startOfMonth(now));

  const thisWeekAggs = await getAggregatesByDateRange(weekStart, todayKey);
  const lastWeekAggs = await getAggregatesByDateRange(lastWeekStart, lastWeekEnd);
  const thisMonthAggs = await getAggregatesByDateRange(monthStart, todayKey);

  const weeklyWatch = thisWeekAggs.reduce((s, a) => s + a.totalWatchTime, 0);
  const lastWeekWatch = lastWeekAggs.reduce((s, a) => s + a.totalWatchTime, 0);
  const monthlyWatch = thisMonthAggs.reduce((s, a) => s + a.totalWatchTime, 0);

  const streak = computeStreak(thisWeekAggs);

  // Merged heatmap: prefer the last 7 days of aggregates
  const heatmap: number[][] = Array.from({ length: 24 }, () => new Array(7).fill(0));
  for (const a of thisWeekAggs) {
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        heatmap[h][d] += a.hourlyHeatmap[h]?.[d] ?? 0;
      }
    }
  }

  const avgCompletion = thisWeekAggs.length > 0
    ? thisWeekAggs.reduce((s, a) => s + a.avgCompletion, 0) / thisWeekAggs.length
    : 0;

  // Efficiency over this week
  const avgEfficiency = thisWeekAggs.length > 0
    ? thisWeekAggs.reduce((s, a) => s + a.efficiencyScore, 0) / thisWeekAggs.length
    : 0;

  const lastMonthStart = dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = dateKey(new Date(now.getFullYear(), now.getMonth(), 0));
  const lastMonthAggs = await getAggregatesByDateRange(lastMonthStart, lastMonthEnd);
  const lastMonthWatch = lastMonthAggs.reduce((s, a) => s + a.totalWatchTime, 0);

  return {
    weeklyWatchTime: weeklyWatch,
    monthlyWatchTime: monthlyWatch,
    weeklyChange: percentChange(weeklyWatch, lastWeekWatch),
    monthlyChange: percentChange(monthlyWatch, lastMonthWatch),
    avgCompletion,
    streakDays: streak.current,
    longestStreak: streak.longest,
    hourlyHeatmap: heatmap,
    efficiencyScore: Math.round(avgEfficiency),
  };
}
