import type { WatchHistoryRecord, DailyAggregate } from '../../shared/types/watch-event';
import { clamp, normalize } from '../../shared/utils/math';
import { getAggregatesSince } from '../storage/aggregate-repo';
import { getRecordsByDateRange } from '../storage/watch-history-repo';
import { loadConfig } from '../storage/config-store';
import { dateKey, daysAgo } from '../../shared/utils/time';
import { computeStreak } from './metrics';
import { computeCreatorRanking } from './creator';

const MAX_DAILY_SECONDS = 28_800; // 8 hours = reasonable max per day
const MAX_STREAK = 30; // 30 days considered maximum streak for normalization

export function computeEfficiencyScore(
  records: WatchHistoryRecord[],
  dailyAggs: DailyAggregate[],
  dailyGoalSeconds: number,
): number {
  if (records.length === 0) return 0;

  // 1. Completion rate (0.30 weight)
  const totalCompletion = records.reduce((s, r) => {
    return s + (r.duration > 0 ? clamp(r.progress / r.duration, 0, 1) : 0);
  }, 0);
  const avgCompletion = totalCompletion / records.length;

  // 2. Category diversity (0.25 weight)
  const categories = new Set(records.map(r => r.tagName).filter(Boolean));
  const diversityIndex = normalize(categories.size, 1, 20);

  // 3. Streak continuity (0.20 weight)
  const streak = computeStreak(dailyAggs);
  const streakNorm = normalize(streak.current, 0, MAX_STREAK);

  // 4. Goal achievement (0.15 weight)
  const today = dateKey();
  const todayAgg = dailyAggs.find(a => a.date === today);
  const todayWatch = todayAgg?.totalWatchTime ?? 0;
  const goalNorm = dailyGoalSeconds > 0 ? clamp(todayWatch / dailyGoalSeconds, 0, 1) : 0.5;

  // 5. Anti-over-dependency (0.10 weight)
  const ranking = computeCreatorRanking(records);
  const totalTime = ranking.reduce((s, c) => s + c.totalWatchTime, 0);
  const topShare = totalTime > 0 ? (ranking[0]?.totalWatchTime ?? 0) / totalTime : 0;
  const antiDepNorm = 1 - topShare; // 0% concentration = 1.0, 100% concentration = 0.0

  const score = (
    0.30 * avgCompletion +
    0.25 * diversityIndex +
    0.20 * streakNorm +
    0.15 * goalNorm +
    0.10 * antiDepNorm
  ) * 100;

  return Math.round(clamp(score, 0, 100));
}

export async function computeAndStoreScore(forDate: string, records: WatchHistoryRecord[], dailyAggs: DailyAggregate[]): Promise<number> {
  const config = await loadConfig();
  return computeEfficiencyScore(records, dailyAggs, config.dailyWatchGoal * 60);
}
