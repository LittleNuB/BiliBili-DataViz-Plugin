import type {
  DynamicBillCreatorPauseRecord,
  DynamicBillFeedbackRecord,
} from '../../shared/types/dynamic-bill.ts';
import { DYNAMIC_BILL_STRATEGY } from './strategy.ts';

export function deriveLegacyCreatorPauses(
  feedback: DynamicBillFeedbackRecord[],
  now: number,
  pauseDays = DYNAMIC_BILL_STRATEGY.lessRemindPauseDays,
): DynamicBillCreatorPauseRecord[] {
  const pauseMs = pauseDays * 86_400_000;
  const pausesByCreator = new Map<number, DynamicBillCreatorPauseRecord>();

  for (const record of feedback) {
    if (record.scope !== 'creator') continue;

    const creatorMid = normalizeCreatorMid(record.creatorMid, record.key);
    if (creatorMid === null) continue;

    const startedAt = normalizeTimestamp(record.createdAt);
    if (startedAt === null) continue;

    const expiresAt = startedAt + pauseMs;
    if (expiresAt <= now) continue;

    const existing = pausesByCreator.get(creatorMid);
    if (existing && existing.expiresAt >= expiresAt) continue;

    pausesByCreator.set(creatorMid, {
      creatorMid,
      creatorName: record.creatorName || record.label || String(creatorMid),
      startedAt,
      expiresAt,
      source: 'migration',
      billKey: record.billKey,
      createdAt: now,
      updatedAt: now,
    });
  }

  return Array.from(pausesByCreator.values());
}

function normalizeCreatorMid(creatorMid: unknown, key: string): number | null {
  const raw = Number.isFinite(Number(creatorMid)) ? Number(creatorMid) : Number(key);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function normalizeTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}
