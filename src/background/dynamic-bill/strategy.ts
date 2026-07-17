import { DYNAMIC_UPDATE_WINDOW_DAYS } from '../../shared/constants.ts';
import type { DynamicBillThresholdEvidence } from '../../shared/types/dynamic-bill.ts';

export const DYNAMIC_BILL_COLUMNS = [
  'buried_follow',
  'favorite_related',
  'follow_rotation',
] as const;

export const DYNAMIC_BILL_MIGRATION_VERSION = 'dynamic-bill-0.13-fixed-columns';
export const DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE = '动态账单本地数据升级失败，请稍后重试。';
export const DYNAMIC_BILL_MIGRATION_CREATOR_PAUSE_DAYS = 30;

export const DYNAMIC_BILL_STRATEGY = {
  longWindowDays: 180,
  recentWindowDays: 30,
  updateWindowDays: DYNAMIC_UPDATE_WINDOW_DAYS,
  recentSameVideoWindowDays: 30,
  positiveCompletionRate: 0.5,
  minPositiveWatchSeconds: 180,
  minBuriedFollowAgeDays: 180,
  minObservedFollowDays: 30,
  minBuriedWeakWatchCount: 1,
  maxBuriedRecentWatchCount: 1,
  maxBuriedRecentPositiveWatchCount: 0,
  maxHighlightsPerItem: 3,
  maxItemsPerColumn: 5,
  maxItemsTotal: 15,
} as const;

export function getDynamicBillThresholdEvidence(): DynamicBillThresholdEvidence {
  return {
    longWindowDays: DYNAMIC_BILL_STRATEGY.longWindowDays,
    recentWindowDays: DYNAMIC_BILL_STRATEGY.recentWindowDays,
    updateWindowDays: DYNAMIC_BILL_STRATEGY.updateWindowDays,
    recentSameVideoWindowDays: DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays,
    positiveCompletionRate: DYNAMIC_BILL_STRATEGY.positiveCompletionRate,
    minPositiveWatchSeconds: DYNAMIC_BILL_STRATEGY.minPositiveWatchSeconds,
    minBuriedFollowAgeDays: DYNAMIC_BILL_STRATEGY.minBuriedFollowAgeDays,
    minObservedFollowDays: DYNAMIC_BILL_STRATEGY.minObservedFollowDays,
    minBuriedWeakWatchCount: DYNAMIC_BILL_STRATEGY.minBuriedWeakWatchCount,
    maxBuriedRecentWatchCount: DYNAMIC_BILL_STRATEGY.maxBuriedRecentWatchCount,
    maxBuriedRecentPositiveWatchCount: DYNAMIC_BILL_STRATEGY.maxBuriedRecentPositiveWatchCount,
    maxItemsPerColumn: DYNAMIC_BILL_STRATEGY.maxItemsPerColumn,
    maxItemsTotal: DYNAMIC_BILL_STRATEGY.maxItemsTotal,
  };
}
