import type { DynamicBillColumn, DynamicBillGenerateResult, DynamicBillItem } from '../../shared/types/dynamic-bill.ts';
import {
  getKnownWatchHistoryBvids,
  getRecordsSince,
} from '../storage/watch-history-repo.ts';
import { db } from '../storage/db.ts';
import {
  getActiveDynamicBillCreatorPauses,
  getActiveFollowedCreators,
  getDynamicBillOverview,
  getDynamicBillRotationRecords,
  getRecentFollowedVideoUpdates,
  replaceAllDynamicBillItems,
} from '../storage/dynamic-bill-repo.ts';
import { ensureDynamicBill013Migration } from './migration.ts';
import { planFixedDynamicBillItems } from './planner.ts';
import {
  DYNAMIC_BILL_COLUMNS,
  DYNAMIC_BILL_STRATEGY,
  getDynamicBillThresholdEvidence,
} from './strategy.ts';

const SECONDS_PER_DAY = 86_400;

export async function generateFixedDynamicBillItems(): Promise<DynamicBillGenerateResult> {
  await ensureDynamicBill013Migration();
  const generatedAt = Date.now();
  const nowSeconds = Math.floor(generatedAt / 1000);
  const longCutoff = nowSeconds - DYNAMIC_BILL_STRATEGY.longWindowDays * SECONDS_PER_DAY;

  const [
    creators,
    updates,
    historyRecords,
    knownWatchedBvids,
    favoriteItems,
    rotationRecords,
    pauses,
  ] = await Promise.all([
    getActiveFollowedCreators(),
    getRecentFollowedVideoUpdates(DYNAMIC_BILL_STRATEGY.updateWindowDays),
    getRecordsSince(longCutoff),
    getKnownWatchHistoryBvids(),
    db.favoriteItems.toArray(),
    getDynamicBillRotationRecords(),
    getActiveDynamicBillCreatorPauses(generatedAt),
  ]);

  const plan = planFixedDynamicBillItems({
    creators,
    updates,
    historyRecords,
    knownWatchedBvids,
    favoriteItems,
    rotationRecords,
    pausedCreatorMids: new Set(pauses.map(pause => pause.creatorMid)),
    now: generatedAt,
  });
  const storedItems = await replaceAllDynamicBillItems(plan.items, generatedAt);
  const overview = await getDynamicBillOverview(DYNAMIC_BILL_STRATEGY.updateWindowDays);

  return {
    generatedAt,
    itemCount: storedItems.length,
    candidatesScanned: plan.candidatesScanned,
    eligibleCreatorCount: plan.eligibleCreatorCount,
    excludedNoLongSignalCount: plan.excludedNoLongSignalCount,
    excludedRecentActiveCount: plan.excludedRecentActiveCount,
    excludedRecentSameVideoCount: plan.excludedRecentSameVideoCount,
    excludedByFeedbackCount: plan.excludedByFeedbackCount,
    columnItemCounts: countItemsByColumn(storedItems),
    columnEligibleCounts: plan.columnEligibleCounts,
    items: storedItems,
    thresholds: getDynamicBillThresholdEvidence(),
    overview,
  };
}

function countItemsByColumn(items: DynamicBillItem[]): Record<DynamicBillColumn, number> {
  return DYNAMIC_BILL_COLUMNS.reduce((counts, column) => {
    counts[column] = items.filter(item => item.column === column).length;
    return counts;
  }, emptyColumnCounts());
}

function emptyColumnCounts(): Record<DynamicBillColumn, number> {
  return {
    buried_follow: 0,
    favorite_related: 0,
    follow_rotation: 0,
  };
}
