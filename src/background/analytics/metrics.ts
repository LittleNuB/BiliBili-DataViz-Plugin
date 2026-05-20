import type { WatchHistoryRecord, DailyAggregate } from '../../shared/types/watch-event';
import type { DashboardOverview, QuickStats } from '../../shared/types/analytics';
import { startOfWeek, startOfMonth, daysAgo, dateKey, daysBetween } from '../../shared/utils/time';
import { percentChange } from '../../shared/utils/math';
import { getNewestRecord, getOldestRecord, getRecordsByDateRange } from '../storage/watch-history-repo';
import { loadConfig } from '../storage/config-store';
import { aggregateWindow } from './aggregator';
import { getEffectiveWatchDatesByDateRange, getEffectiveWatchRecordsByDateRange } from './effective-watch';

interface StreakDetails {
  current: number;
  currentStartDate: string | null;
  currentEndDate: string | null;
  longest: number;
  longestStartDate: string | null;
  longestEndDate: string | null;
}

export function computeCompletion(records: WatchHistoryRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, r) => {
    return sum + (r.duration > 0 ? r.progress / r.duration : 0);
  }, 0);
  return total / records.length;
}

export function computeStreak(dailyList: DailyAggregate[]): StreakDetails {
  const dates = new Set(dailyList.map(a => a.date));
  return computeStreakFromDateSet(dates);
}

export function computeStreakFromRecords(records: WatchHistoryRecord[]): StreakDetails {
  const dates = new Set(records.map(r => dateKey(new Date(r.viewAt * 1000))));
  return computeStreakFromDateSet(dates);
}

function computeStreakFromDateSet(dates: Set<string>): StreakDetails {
  if (dates.size === 0) {
    return {
      current: 0,
      currentStartDate: null,
      currentEndDate: null,
      longest: 0,
      longestStartDate: null,
      longestEndDate: null,
    };
  }

  const sorted = Array.from(dates).sort();
  const ranges: Array<{ startDate: string; endDate: string; days: number }> = [];
  let startDate = sorted[0];
  let endDate = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDateKey(sorted[i - 1]);
    const curr = parseDateKey(sorted[i]);
    if (daysBetween(prev, curr) === 1) {
      endDate = sorted[i];
      continue;
    }

    ranges.push({ startDate, endDate, days: countInclusiveDays(startDate, endDate) });
    startDate = sorted[i];
    endDate = sorted[i];
  }
  ranges.push({ startDate, endDate, days: countInclusiveDays(startDate, endDate) });

  const today = dateKey();
  const yesterday = dateKey(daysAgo(1));
  const currentAnchor = dates.has(today) ? today : dates.has(yesterday) ? yesterday : null;
  const currentRange = currentAnchor
    ? ranges.find(range => range.startDate <= currentAnchor && range.endDate >= currentAnchor)
    : null;
  const longestRange = ranges.reduce((best, range) => {
    if (!best || range.days > best.days) return range;
    if (range.days === best.days && range.endDate > best.endDate) return range;
    return best;
  }, null as { startDate: string; endDate: string; days: number } | null);

  return {
    current: currentRange?.days ?? 0,
    currentStartDate: currentRange?.startDate ?? null,
    currentEndDate: currentRange?.endDate ?? null,
    longest: longestRange?.days ?? 0,
    longestStartDate: longestRange?.startDate ?? null,
    longestEndDate: longestRange?.endDate ?? null,
  };
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
  const streak = computeStreakFromDateSet(new Set(recentDates));

  return {
    todayWatchTime: todayAgg.totalWatchTime,
    dailyGoal: config.dailyWatchGoal * 60, // convert minutes to seconds
    streakDays: streak.current,
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
  const [oldestRecord, newestRecord] = await Promise.all([
    getOldestRecord(),
    getNewestRecord(),
  ]);
  const oldestRecordDate = oldestRecord ? dateKey(new Date(oldestRecord.viewAt * 1000)) : dateKey(daysAgo(365));
  const effectiveDates = await getEffectiveWatchDatesByDateRange(oldestRecordDate, todayKey);
  const thisWeekWindow = aggregateWindow(thisWeekRecords);

  const weeklyWatch = thisWeekWindow.totalWatchTime;
  const lastWeekWatch = aggregateWindow(lastWeekRecords).totalWatchTime;
  const monthlyWatch = aggregateWindow(thisMonthRecords).totalWatchTime;

  const streak = computeStreakFromDateSet(new Set(effectiveDates));

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
    streakStartDate: streak.currentStartDate,
    streakEndDate: streak.currentEndDate,
    longestStreak: streak.longest,
    longestStreakStartDate: streak.longestStartDate,
    longestStreakEndDate: streak.longestEndDate,
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
    oldestRecordDate: oldestRecord ? oldestRecordDate : null,
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

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function countInclusiveDays(startDate: string, endDate: string): number {
  return daysBetween(parseDateKey(startDate), parseDateKey(endDate)) + 1;
}
