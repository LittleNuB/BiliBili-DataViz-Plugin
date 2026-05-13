import { db } from './db';
import type { DailyAggregate } from '../../shared/types/watch-event';

export async function getAggregate(date: string): Promise<DailyAggregate | undefined> {
  return db.dailyAggregates.where({ date }).first();
}

export async function upsertAggregate(aggregate: DailyAggregate): Promise<number> {
  return db.dailyAggregates.put(aggregate);
}

export async function getAggregatesByDateRange(
  startDate: string,
  endDate: string,
): Promise<DailyAggregate[]> {
  return db.dailyAggregates
    .where('date')
    .between(startDate, endDate, true, true)
    .toArray();
}

export async function getAggregatesSince(date: string): Promise<DailyAggregate[]> {
  return db.dailyAggregates.where('date').above(date).toArray();
}
