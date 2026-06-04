import type { DynamicBillGenerateResult } from '../../shared/types/dynamic-bill';
import { getDynamicBillOverview, getDynamicBillItems } from '../storage/dynamic-bill-repo';
import { generateBuriedFollowBillItems } from './buried-follow';
import { generateAfkUpdateBillItems } from './rules';
import { DYNAMIC_BILL_STRATEGY, getDynamicBillThresholdEvidence } from './strategy';
import { generateVarietyBillItems } from './variety';

export async function generateDynamicBillItems(): Promise<DynamicBillGenerateResult> {
  const afkResult = await generateAfkUpdateBillItems();
  const varietyResult = await generateVarietyBillItems();
  const buriedFollowResult = await generateBuriedFollowBillItems();
  const items = await getDynamicBillItems();
  const overview = await getDynamicBillOverview(DYNAMIC_BILL_STRATEGY.updateWindowDays);
  const generatedAt = Math.max(
    afkResult.generatedAt,
    varietyResult.generatedAt,
    buriedFollowResult.generatedAt,
  );

  return {
    generatedAt,
    itemCount: items.length,
    candidatesScanned:
      afkResult.candidatesScanned
      + varietyResult.candidatesScanned
      + buriedFollowResult.candidatesScanned,
    eligibleCreatorCount:
      afkResult.eligibleCreatorCount
      + varietyResult.eligibleCreatorCount
      + buriedFollowResult.eligibleCreatorCount,
    excludedNoLongSignalCount:
      afkResult.excludedNoLongSignalCount
      + varietyResult.excludedNoLongSignalCount
      + buriedFollowResult.excludedNoLongSignalCount,
    excludedRecentActiveCount:
      afkResult.excludedRecentActiveCount
      + varietyResult.excludedRecentActiveCount
      + buriedFollowResult.excludedRecentActiveCount,
    excludedRecentSameVideoCount:
      afkResult.excludedRecentSameVideoCount
      + varietyResult.excludedRecentSameVideoCount
      + buriedFollowResult.excludedRecentSameVideoCount,
    columnItemCounts: {
      afk_update: afkResult.columnItemCounts.afk_update,
      variety: varietyResult.columnItemCounts.variety,
      buried_follow: buriedFollowResult.columnItemCounts.buried_follow,
    },
    columnEligibleCounts: {
      afk_update: afkResult.columnEligibleCounts.afk_update,
      variety: varietyResult.columnEligibleCounts.variety,
      buried_follow: buriedFollowResult.columnEligibleCounts.buried_follow,
    },
    items,
    thresholds: getDynamicBillThresholdEvidence(),
    overview,
  };
}
