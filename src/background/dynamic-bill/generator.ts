import type { DynamicBillGenerateResult } from '../../shared/types/dynamic-bill';
import { getDynamicBillOverview, getDynamicBillItems } from '../storage/dynamic-bill-repo';
import { generateAfkUpdateBillItems } from './rules';
import { DYNAMIC_BILL_STRATEGY, getDynamicBillThresholdEvidence } from './strategy';
import { generateVarietyBillItems } from './variety';

export async function generateDynamicBillItems(): Promise<DynamicBillGenerateResult> {
  const afkResult = await generateAfkUpdateBillItems();
  const varietyResult = await generateVarietyBillItems();
  const items = await getDynamicBillItems();
  const overview = await getDynamicBillOverview(DYNAMIC_BILL_STRATEGY.updateWindowDays);
  const generatedAt = Math.max(afkResult.generatedAt, varietyResult.generatedAt);

  return {
    generatedAt,
    itemCount: items.length,
    candidatesScanned: afkResult.candidatesScanned + varietyResult.candidatesScanned,
    eligibleCreatorCount: afkResult.eligibleCreatorCount + varietyResult.eligibleCreatorCount,
    excludedNoLongSignalCount:
      afkResult.excludedNoLongSignalCount + varietyResult.excludedNoLongSignalCount,
    excludedRecentActiveCount:
      afkResult.excludedRecentActiveCount + varietyResult.excludedRecentActiveCount,
    excludedRecentSameVideoCount:
      afkResult.excludedRecentSameVideoCount + varietyResult.excludedRecentSameVideoCount,
    columnItemCounts: {
      afk_update: afkResult.columnItemCounts.afk_update,
      variety: varietyResult.columnItemCounts.variety,
    },
    columnEligibleCounts: {
      afk_update: afkResult.columnEligibleCounts.afk_update,
      variety: varietyResult.columnEligibleCounts.variety,
    },
    items,
    thresholds: getDynamicBillThresholdEvidence(),
    overview,
  };
}
