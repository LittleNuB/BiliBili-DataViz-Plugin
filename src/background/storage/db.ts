import Dexie, { type Table } from 'dexie';
import type { WatchHistoryRecord, PlayerEvent, DailyAggregate } from '../../shared/types/watch-event';

export class BiliAnalyticsDB extends Dexie {
  watchHistory!: Table<WatchHistoryRecord, number>;
  playerEvents!: Table<PlayerEvent, number>;
  dailyAggregates!: Table<DailyAggregate, number>;

  constructor() {
    super('BiliAnalyticsDB');
    this.version(1).stores({
      watchHistory:
        '++id, &kid, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
      playerEvents:
        '++id, [bvid+cid], eventType, timestamp, tabId',
      dailyAggregates:
        '++id, &date',
    });

    this.version(2).stores({
      watchHistory:
        '++id, kid, &sessionKey, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
      playerEvents:
        '++id, [bvid+cid], eventType, timestamp, tabId',
      dailyAggregates:
        '++id, &date',
    }).upgrade(async (tx) => {
      const table = tx.table('watchHistory');
      await table.toCollection().modify((record) => {
        if (!record.sessionKey) {
          record.sessionKey = record.kid
            ? `${record.kid}:${record.viewAt}`
            : `${record.bvid ?? ''}:${record.cid ?? 0}:${record.viewAt}`;
        }
      });
    });
  }
}

export const db = new BiliAnalyticsDB();
