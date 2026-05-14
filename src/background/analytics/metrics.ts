import type { WatchHistoryRecord, DailyAggregate } from '../../shared/types/watch-event';
import type { DashboardOverview, QuickStats } from '../../shared/types/analytics';
import { startOfWeek, startOfMonth, daysAgo, dateKey, daysBetween } from '../../shared/utils/time';
import { percentChange } from '../../shared/utils/math';
import { getNewestRecord, getOldestRecord, getRecordsByDateRange } from '../storage/watch-history-repo';
import { loadConfig } from '../storage/config-store';
import { aggregateWindow } from './aggregator';
import { getEffectiveWatchDatesByDateRange, getEffectiveWatchRecordsByDateRange } from './effective-watch';

export function computeCompletion(records: WatchHistoryRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, r) => {
    return sum + (r.duration > 0 ? r.progress / r.duration : 0);
  }, 0);
  return total / records.length;
}

export function computeStreak(dailyList: DailyAggregate[]): { current: number; longest: number } {
  const dates = new Set(dailyList.map(a => a.date));
  return computeStreakFromDateSet(dates);
}

export function computeStreakFromRecords(records: WatchHistoryRecord[]): { current: number; longest: number } {
  const dates = new Set(records.map(r => dateKey(new Date(r.viewAt * 1000))));
  return computeStreakFromDateSet(dates);
}

function computeStreakFromDateSet(dates: Set<string>): { current: number; longest: number } {
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
  const sorted = Array.from(dates).sort();
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
  const todayEffective = await getEffectiveWatchRecordsByDateRange(todayKey, todayKey);
  const todayAgg = aggregateWindow(todayEffective.records);

  const weekStart = dateKey(startOfWeek());
  const thisWeekEffective = await getEffectiveWatchRecordsByDateRange(weekStart, todayKey);

  const weeklyWatch = thisWeekEffective.records.reduce((s, r) => s + Math.max(r.progress, 0), 0);
  const recentDates = await getEffectiveWatchDatesByDateRange(dateKey(daysAgo(365)), todayKey);

  return {
    todayWatchTime: todayAgg.totalWatchTime,
    dailyGoal: config.dailyWatchGoal * 60, // convert minutes to seconds
    streakDays: computeStreakFromDateSet(new Set(recentDates)).current,
    avgCompletion: todayAgg.avgCompletion,
    efficiencyScore: computeRawEfficiency(todayEffective.records, config.dailyWatchGoal * 60),
    weeklyWatchTime: weeklyWatch,
    weeklyLocalPcWatchTime: thisWeekEffective.localPcWatchTime,
    weeklyLocalPcDays: thisWeekEffective.localPcDates.length,
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

  const thisWeekEffective = await getEffectiveWatchRecordsByDateRange(weekStart, todayKey);
  const thisWeekRecords = thisWeekEffective.records;
  const lastWeekRecords = (await getEffectiveWatchRecordsByDateRange(lastWeekStart, lastWeekEnd)).records;
  const thisMonthEffective = await getEffectiveWatchRecordsByDateRange(monthStart, todayKey);
  const thisMonthRecords = thisMonthEffective.records;
  const recentDates = await getEffectiveWatchDatesByDateRange(dateKey(daysAgo(365)), todayKey);
  const [oldestRecord, newestRecord] = await Promise.all([
    getOldestRecord(),
    getNewestRecord(),
  ]);
  const thisWeekWindow = aggregateWindow(thisWeekRecords);

  const weeklyWatch = thisWeekWindow.totalWatchTime;
  const lastWeekWatch = aggregateWindow(lastWeekRecords).totalWatchTime;
  const monthlyWatch = aggregateWindow(thisMonthRecords).totalWatchTime;

  const streak = computeStreakFromDateSet(new Set(recentDates));

  const heatmap = thisWeekWindow.hourlyHeatmap;
  const avgCompletion = thisWeekWindow.avgCompletion;
  const config = await loadConfig();
  const avgEfficiency = computeRawEfficiency(thisWeekRecords, config.dailyWatchGoal * 60);

  const lastMonthStart = dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = dateKey(new Date(now.getFullYear(), now.getMonth(), 0));
  const lastMonthRecords = (await getEffectiveWatchRecordsByDateRange(lastMonthStart, lastMonthEnd)).records;
  const lastMonthWatch = aggregateWindow(lastMonthRecords).totalWatchTime;

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
    weekStart,
    weekEnd: todayKey,
    monthStart,
    monthEnd: todayKey,
    weeklyRecordCount: thisWeekRecords.length,
    monthlyRecordCount: thisMonthRecords.length,
    weeklyLocalPcWatchTime: thisWeekEffective.localPcWatchTime,
    weeklyLocalPcDays: thisWeekEffective.localPcDates.length,
    oldestRecordDate: oldestRecord ? dateKey(new Date(oldestRecord.viewAt * 1000)) : null,
    newestRecordDate: newestRecord ? dateKey(new Date(newestRecord.viewAt * 1000)) : null,
  };
}

function computeRawEfficiency(records: WatchHistoryRecord[], dailyGoalSeconds: number): number {
  if (records.length === 0) return 0;

  const windowed = aggregateWindow(records);
  const goalScore = dailyGoalSeconds > 0
    ? Math.min(windowed.totalWatchTime / dailyGoalSeconds, 1)
    : 0.5;
  const diversityScore = Math.min(windowed.uniqueCategories / 20, 1);

  return Math.round((
    0.5 * windowed.avgCompletion +
    0.3 * goalScore +
    0.2 * diversityScore
  ) * 100);
}
