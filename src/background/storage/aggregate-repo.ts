import { db } from './db';
import type { DailyAggregate } from '../../shared/types/watch-event';

export async function getAggregate(date: string): Promise<DailyAggregate | undefined> {
  return db.dailyAggregates.where({ date }).first();
}

export async function upsertAggregate(aggregate: DailyAggregate): Promise<number> {
  const existing = await getAggregate(aggregate.date);
  return db.dailyAggregates.put({
    ...aggregate,
    id: existing?.id,
  });
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
  return db.dailyAggregates.where('date').aboveOrEqual(date).toArray();
}
