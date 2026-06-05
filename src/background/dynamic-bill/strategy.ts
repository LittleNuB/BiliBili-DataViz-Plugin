import { DYNAMIC_UPDATE_WINDOW_DAYS } from '../../shared/constants';
import type { DynamicBillThresholdEvidence } from '../../shared/types/dynamic-bill';

export const DYNAMIC_BILL_STRATEGY = {
  longWindowDays: 180,
  recentWindowDays: 30,
  updateWindowDays: DYNAMIC_UPDATE_WINDOW_DAYS,
  recentSameVideoWindowDays: 30,
  minCreatorPositiveViews: 3,
  minInterestPositiveViews: 5,
  minInterestLongPositiveShare: 0.08,
  maxInterestRecentPositiveRatio: 0.5,
  positiveCompletionRate: 0.5,
  minPositiveWatchSeconds: 180,
  recentCooldownRatio: 0.5,
  minBuriedFollowAgeDays: 180,
  minBuriedWeakWatchCount: 1,
  maxBuriedRecentWatchCount: 1,
  maxBuriedRecentPositiveWatchCount: 0,
  feedbackDampenCount: 1,
  feedbackCreatorBlockCount: 3,
  feedbackTopicBlockCount: 2,
  feedbackCreatorReviewPromptCount: 2,
  feedbackScoreMultiplier: 0.35,
  maxHighlightsPerItem: 3,
  maxItemsPerColumn: 20,
} as const;

export function getDynamicBillThresholdEvidence(): DynamicBillThresholdEvidence {
  return {
    longWindowDays: DYNAMIC_BILL_STRATEGY.longWindowDays,
    recentWindowDays: DYNAMIC_BILL_STRATEGY.recentWindowDays,
    updateWindowDays: DYNAMIC_BILL_STRATEGY.updateWindowDays,
    recentSameVideoWindowDays: DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays,
    minCreatorPositiveViews: DYNAMIC_BILL_STRATEGY.minCreatorPositiveViews,
    minInterestPositiveViews: DYNAMIC_BILL_STRATEGY.minInterestPositiveViews,
    minInterestLongPositiveShare: DYNAMIC_BILL_STRATEGY.minInterestLongPositiveShare,
    maxInterestRecentPositiveRatio: DYNAMIC_BILL_STRATEGY.maxInterestRecentPositiveRatio,
    positiveCompletionRate: DYNAMIC_BILL_STRATEGY.positiveCompletionRate,
    minPositiveWatchSeconds: DYNAMIC_BILL_STRATEGY.minPositiveWatchSeconds,
    recentCooldownRatio: DYNAMIC_BILL_STRATEGY.recentCooldownRatio,
    minBuriedFollowAgeDays: DYNAMIC_BILL_STRATEGY.minBuriedFollowAgeDays,
    minBuriedWeakWatchCount: DYNAMIC_BILL_STRATEGY.minBuriedWeakWatchCount,
    maxBuriedRecentWatchCount: DYNAMIC_BILL_STRATEGY.maxBuriedRecentWatchCount,
    maxBuriedRecentPositiveWatchCount: DYNAMIC_BILL_STRATEGY.maxBuriedRecentPositiveWatchCount,
    feedbackDampenCount: DYNAMIC_BILL_STRATEGY.feedbackDampenCount,
    feedbackCreatorBlockCount: DYNAMIC_BILL_STRATEGY.feedbackCreatorBlockCount,
    feedbackTopicBlockCount: DYNAMIC_BILL_STRATEGY.feedbackTopicBlockCount,
    feedbackCreatorReviewPromptCount: DYNAMIC_BILL_STRATEGY.feedbackCreatorReviewPromptCount,
    feedbackScoreMultiplier: DYNAMIC_BILL_STRATEGY.feedbackScoreMultiplier,
  };
}
