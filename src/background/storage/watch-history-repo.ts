import { db } from './db';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { buildWatchSessionKey } from '../../shared/utils/session-key';

export async function findByKid(kid: number): Promise<WatchHistoryRecord | undefined> {
  return db.watchHistory.where({ kid }).first();
}

export async function existsByKid(kid: number): Promise<boolean> {
  const count = await db.watchHistory.where({ kid }).count();
  return count > 0;
}

export async function existsBySessionKey(sessionKey: string): Promise<boolean> {
  const count = await db.watchHistory.where({ sessionKey }).count();
  return count > 0;
}

export async function existsByAvidCidViewAt(
  avid: number,
  cid: number,
  viewAt: number,
): Promise<boolean> {
  const count = await db.watchHistory.where({ avid, cid, viewAt }).count();
  return count > 0;
}

export async function insertRecord(record: WatchHistoryRecord): Promise<number> {
  return db.watchHistory.put(ensureSessionKey(record));
}

export async function bulkInsert(records: WatchHistoryRecord[]): Promise<number> {
  return db.watchHistory.bulkPut(records.map(ensureSessionKey));
}

export async function getRecordsByDateRange(
  startDate: string,
  endDate: string,
): Promise<WatchHistoryRecord[]> {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const startTs = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0).getTime() / 1000;
  const endTs = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999).getTime() / 1000;
  return db.watchHistory.where('viewAt').between(startTs, endTs, true, true).toArray();
}

export async function getRecordsSince(timestamp: number): Promise<WatchHistoryRecord[]> {
  return db.watchHistory.where('viewAt').above(timestamp).toArray();
}

export async function getKnownWatchHistoryBvids(): Promise<string[]> {
  const keys = await db.watchHistory.orderBy('bvid').uniqueKeys();
  return keys
    .map(key => typeof key === 'string' ? key.trim() : '')
    .filter(Boolean);
}

export async function getTotalCount(): Promise<number> {
  return db.watchHistory.count();
}

export async function getOldestRecord(): Promise<WatchHistoryRecord | undefined> {
  return db.watchHistory.orderBy('viewAt').first();
}

export async function getNewestRecord(): Promise<WatchHistoryRecord | undefined> {
  return db.watchHistory.orderBy('viewAt').last();
}

export async function deleteOlderThan(timestamp: number): Promise<number> {
  return db.watchHistory.where('viewAt').below(timestamp).delete();
}

export async function updateDeviceTypesFromHistory(items: Array<{
  kid?: number;
  avid: number;
  cid: number;
  viewAt: number;
  deviceType: number;
}>): Promise<number> {
  let updated = 0;

  for (const item of items) {
    const sessionKey = buildWatchSessionKey(item.kid, item.viewAt);
    const record = await db.watchHistory.where({ sessionKey }).first()
      ?? await db.watchHistory.where({ avid: item.avid, cid: item.cid, viewAt: item.viewAt }).first();
    if (!record || record.deviceType === item.deviceType) continue;

    await db.watchHistory.update(record.id!, { deviceType: item.deviceType });
    updated++;
  }

  return updated;
}

function ensureSessionKey(record: WatchHistoryRecord): WatchHistoryRecord {
  return {
    ...record,
    sessionKey: record.sessionKey || buildWatchSessionKey(record.kid, record.viewAt, record.bvid, record.cid),
  };
}
