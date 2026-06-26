import type { WatchHistoryRecord } from '../../shared/types/watch-event';

const DAY_MS = 86_400_000;

export interface HistoryCoverageSpan {
  recordCount: number;
  oldestAt: number;
  newestAt: number;
  spanDays: number;
  requiredDays: number;
  hasEnoughForRecentComparison: boolean;
}

export function getHistoryCoverageSpan(
  records: WatchHistoryRecord[],
  nowMs = Date.now(),
  requiredDays = 30,
): HistoryCoverageSpan {
  const timestamps = records
    .map(record => toEpochMs(record.viewAt))
    .filter(timestamp => timestamp > 0 && timestamp <= nowMs + DAY_MS);
  const normalizedRequiredDays = Math.max(1, Math.floor(requiredDays));

  if (timestamps.length === 0) {
    return {
      recordCount: 0,
      oldestAt: 0,
      newestAt: 0,
      spanDays: 0,
      requiredDays: normalizedRequiredDays,
      hasEnoughForRecentComparison: false,
    };
  }

  const oldestAt = Math.min(...timestamps);
  const newestAt = Math.max(...timestamps);
  const spanDays = Math.max(1, Math.floor((newestAt - oldestAt) / DAY_MS) + 1);

  return {
    recordCount: timestamps.length,
    oldestAt,
    newestAt,
    spanDays,
    requiredDays: normalizedRequiredDays,
    hasEnoughForRecentComparison: spanDays >= normalizedRequiredDays,
  };
}

function toEpochMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value > 1_000_000_000_000 ? value : value * 1000;
}
