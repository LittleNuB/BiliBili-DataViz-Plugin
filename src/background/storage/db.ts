import Dexie, { type Table } from 'dexie';
import type { WatchHistoryRecord, PlayerEvent, DailyAggregate } from '../../shared/types/watch-event.ts';
import type { FavoriteFolder, FavoriteItem, SmartFavoriteIndex } from '../../shared/types/favorite.ts';
import type {
  DynamicBillExplanation,
  DynamicBillFeedbackRecord,
  DynamicBillItem,
  FollowedCreator,
  FollowedVideoUpdate,
} from '../../shared/types/dynamic-bill.ts';

export class BiliAnalyticsDB extends Dexie {
  watchHistory!: Table<WatchHistoryRecord, number>;
  playerEvents!: Table<PlayerEvent, number>;
  dailyAggregates!: Table<DailyAggregate, number>;
  favoriteFolders!: Table<FavoriteFolder, number>;
  favoriteItems!: Table<FavoriteItem, number>;
  smartFavoriteIndex!: Table<SmartFavoriteIndex, number>;
  followedCreators!: Table<FollowedCreator, number>;
  followedVideoUpdates!: Table<FollowedVideoUpdate, number>;
  dynamicBillItems!: Table<DynamicBillItem, number>;
  dynamicBillExplanations!: Table<DynamicBillExplanation, number>;
  dynamicBillFeedback!: Table<DynamicBillFeedbackRecord, number>;

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

    this.version(3).stores({
      watchHistory:
        '++id, kid, &sessionKey, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
      playerEvents:
        '++id, [bvid+cid], eventType, timestamp, tabId',
      dailyAggregates:
        '++id, &date',
      favoriteFolders:
        '++id, &mediaId, title, syncedAt',
      favoriteItems:
        '++id, &itemKey, mediaId, avid, bvid, authorMid, tagName, favTime, syncedAt',
      smartFavoriteIndex:
        '++id, &itemKey, status, indexedAt, contentHash',
    });

    this.version(4).stores({
      watchHistory:
        '++id, kid, &sessionKey, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
      playerEvents:
        '++id, [bvid+cid], eventType, timestamp, tabId',
      dailyAggregates:
        '++id, &date',
      favoriteFolders:
        '++id, &mediaId, title, syncedAt',
      favoriteItems:
        '++id, &itemKey, mediaId, avid, bvid, authorMid, tagName, favTime, syncedAt',
      smartFavoriteIndex:
        '++id, &itemKey, status, indexedAt, contentHash',
      followedCreators:
        '++id, &mid, followedAt, followAgeKnown, isActive, syncedAt, lastSeenAt',
      followedVideoUpdates:
        '++id, &updateKey, dynamicId, bvid, authorMid, dynamicTime, pubtime, syncedAt',
    });

    this.version(5).stores({
      watchHistory:
        '++id, kid, &sessionKey, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
      playerEvents:
        '++id, [bvid+cid], eventType, timestamp, tabId',
      dailyAggregates:
        '++id, &date',
      favoriteFolders:
        '++id, &mediaId, title, syncedAt',
      favoriteItems:
        '++id, &itemKey, mediaId, avid, bvid, authorMid, tagName, favTime, syncedAt',
      smartFavoriteIndex:
        '++id, &itemKey, status, indexedAt, contentHash',
      followedCreators:
        '++id, &mid, followedAt, followAgeKnown, isActive, syncedAt, lastSeenAt',
      followedVideoUpdates:
        '++id, &updateKey, dynamicId, bvid, authorMid, dynamicTime, pubtime, syncedAt',
      dynamicBillItems:
        '++id, &billKey, column, status, creatorMid, updateKey, generatedAt, localRank',
    });

    this.version(6).stores({
      watchHistory:
        '++id, kid, &sessionKey, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
      playerEvents:
        '++id, [bvid+cid], eventType, timestamp, tabId',
      dailyAggregates:
        '++id, &date',
      favoriteFolders:
        '++id, &mediaId, title, syncedAt',
      favoriteItems:
        '++id, &itemKey, mediaId, avid, bvid, authorMid, tagName, favTime, syncedAt',
      smartFavoriteIndex:
        '++id, &itemKey, status, indexedAt, contentHash',
      followedCreators:
        '++id, &mid, followedAt, followAgeKnown, isActive, syncedAt, lastSeenAt',
      followedVideoUpdates:
        '++id, &updateKey, dynamicId, bvid, authorMid, dynamicTime, pubtime, syncedAt',
      dynamicBillItems:
        '++id, &billKey, column, status, creatorMid, updateKey, generatedAt, localRank',
      dynamicBillFeedback:
        '++id, [scope+key], scope, key, creatorMid, billKey, column, createdAt',
    });

    this.version(7).stores({
      watchHistory:
        '++id, kid, &sessionKey, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
      playerEvents:
        '++id, [bvid+cid], eventType, timestamp, tabId',
      dailyAggregates:
        '++id, &date',
      favoriteFolders:
        '++id, &mediaId, title, syncedAt',
      favoriteItems:
        '++id, &itemKey, mediaId, avid, bvid, authorMid, tagName, favTime, syncedAt',
      smartFavoriteIndex:
        '++id, &itemKey, status, indexedAt, contentHash',
      followedCreators:
        '++id, &mid, followedAt, followAgeKnown, isActive, syncedAt, lastSeenAt',
      followedVideoUpdates:
        '++id, &updateKey, dynamicId, bvid, authorMid, dynamicTime, pubtime, syncedAt',
      dynamicBillItems:
        '++id, &billKey, column, status, creatorMid, updateKey, generatedAt, localRank',
      dynamicBillFeedback:
        '++id, [scope+key], scope, key, creatorMid, billKey, column, createdAt',
      dynamicBillExplanations:
        '++id, &billKey, status, generatedAt, model, contentHash',
    });
  }
}

export const db = new BiliAnalyticsDB();
