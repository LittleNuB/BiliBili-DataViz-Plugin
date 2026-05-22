import type { DailyAggregate } from '../../shared/types/watch-event';
import { dateKey } from '../../shared/utils/time';
import { aggregateDay } from './aggregator';
import { getQuickStats, getDashboardOverview } from './metrics';
import { getPreferenceData } from './category';
import { getCreatorData } from './creator';
import { getBehaviorData } from './behavior';
import { computeAndStoreScore } from './scores';
import { getExperimentData } from './suggestions';
import { db } from '../storage/db';
import { upsertAggregate } from '../storage/aggregate-repo';
import { getRecordsByDateRange } from '../storage/watch-history-repo';

interface AggregateComputeRange {
  oldestFetchedAt?: number | null;
  newestFetchedAt?: number | null;
}

export { getQuickStats, getDashboardOverview } from './metrics';
export { getPreferenceData } from './category';
export { getCreatorData } from './creator';
export { getBehaviorData } from './behavior';
export { getExperimentData } from './suggestions';

export async function computeDailyAggregate(forDate?: string): Promise<DailyAggregate> {
  const date = forDate ?? dateKey();
  const aggregate = await aggregateDay(date);

  // Compute efficiency score
  const records = await getRecordsByDateRange(date, date);
  const score = await computeAndStoreScore(date, records, [aggregate]);
  aggregate.efficiencyScore = score;

  await upsertAggregate(aggregate);
  console.log(`[BiliViz] Computed daily aggregate for ${date}: ${aggregate.videoCount} videos, score=${score}`);

  return aggregate;
}

export async function computeStoredHistoryAggregates(range?: AggregateComputeRange): Promise<void> {
  const records = range?.oldestFetchedAt && range.newestFetchedAt
    ? await getRecordsByDateRange(
      dateKey(new Date(range.oldestFetchedAt * 1000)),
      dateKey(new Date(range.newestFetchedAt * 1000)),
    )
    : await db.watchHistory.toArray();
  const dates = new Set(records.map(r => dateKey(new Date(r.viewAt * 1000))));

  if (dates.size === 0) {
    await computeDailyAggregate();
    return;
  }

  for (const date of dates) {
    await computeDailyAggregate(date);
  }
}
