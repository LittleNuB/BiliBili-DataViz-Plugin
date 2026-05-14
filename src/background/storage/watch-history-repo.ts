import { db } from './db';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';

export async function findByKid(kid: number): Promise<WatchHistoryRecord | undefined> {
  return db.watchHistory.where({ kid }).first();
}

export async function existsByKid(kid: number): Promise<boolean> {
  const count = await db.watchHistory.where({ kid }).count();
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
  return db.watchHistory.put(record);
}

export async function bulkInsert(records: WatchHistoryRecord[]): Promise<number> {
  return db.watchHistory.bulkPut(records);
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
