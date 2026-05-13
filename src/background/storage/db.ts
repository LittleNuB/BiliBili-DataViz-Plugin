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
  }
}

export const db = new BiliAnalyticsDB();
