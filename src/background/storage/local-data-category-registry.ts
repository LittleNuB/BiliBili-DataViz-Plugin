import type { Table } from 'dexie';
import type {
  LocalDataCategoryClearResult,
  LocalDataCategoryReadback,
  LocalDataCategoryRegistration,
  LocalDataCategoryUsage,
  LocalDataClearedCounts,
} from '../../shared/local-data-category-contract.ts';
import { db } from './db.ts';
import {
  clearBlindBoxDrawHistory,
  collectBlindBoxDrawHistoryUsage,
  readBlindBoxDrawHistoryAfterClear,
} from './blind-box-draw-history-repo.ts';

type AnyTable = Table<any, any, any>;

const HISTORY_STORAGE_KEYS = [
  'lastSyncTime',
  'historySyncing',
  'historySyncStartedAt',
  'historySyncProgress',
  'historySyncCancelRequested',
  'backfillComplete',
  'deviceTypeMigrationComplete',
];

const DYNAMIC_BILL_STORAGE_KEYS = [
  'dynamicBillSyncState',
  'dynamicBillFilterPreference',
];

const LOCAL_SETTING_STORAGE_KEYS = [
  'userConfig',
  'floatingPopupWindowId',
];

export type LocalDataCategoryTableName =
  | 'watchHistory'
  | 'playerEvents'
  | 'dailyAggregates'
  | 'favoriteFolders'
  | 'favoriteItems'
  | 'smartFavoriteIndex'
  | 'currentVideoTranscriptSources'
  | 'currentVideoTranscriptSegments'
  | 'followedCreators'
  | 'followedVideoUpdates'
  | 'dynamicBillItems'
  | 'dynamicBillExplanations'
  | 'dynamicBillFeedback'
  | 'dynamicBillCreatorPauses'
  | 'dynamicBillRotationRecords';

export interface LocalDataCategoryTable {
  count: () => Promise<number>;
  toArray: () => Promise<unknown[]>;
  clear: () => Promise<void>;
}

export interface LocalDataCategoryStorage {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  remove: (keys: string[]) => Promise<void>;
}

export interface LocalDataCategoryRegistryDependencies {
  tables: Record<LocalDataCategoryTableName, LocalDataCategoryTable>;
  storage: LocalDataCategoryStorage;
  transaction: (
    tables: LocalDataCategoryTable[],
    operation: () => Promise<void>,
  ) => Promise<void>;
}

interface CategoryTableGroup {
  tables: LocalDataCategoryTable[];
  clearOnlyTables?: LocalDataCategoryTable[];
  storageKeys?: string[];
}

export function getRegisteredLocalDataCategories(): LocalDataCategoryRegistration[] {
  return createRegisteredLocalDataCategories({
    tables: {
      watchHistory: db.watchHistory,
      playerEvents: db.playerEvents,
      dailyAggregates: db.dailyAggregates,
      favoriteFolders: db.favoriteFolders,
      favoriteItems: db.favoriteItems,
      smartFavoriteIndex: db.smartFavoriteIndex,
      currentVideoTranscriptSources: db.currentVideoTranscriptSources,
      currentVideoTranscriptSegments: db.currentVideoTranscriptSegments,
      followedCreators: db.followedCreators,
      followedVideoUpdates: db.followedVideoUpdates,
      dynamicBillItems: db.dynamicBillItems,
      dynamicBillExplanations: db.dynamicBillExplanations,
      dynamicBillFeedback: db.dynamicBillFeedback,
      dynamicBillCreatorPauses: db.dynamicBillCreatorPauses,
      dynamicBillRotationRecords: db.dynamicBillRotationRecords,
    },
    storage: {
      get: keys => chrome.storage.local.get(keys),
      remove: keys => chrome.storage.local.remove(keys),
    },
    transaction: async (tables, operation) => {
      await db.transaction('rw', tables as unknown as AnyTable[], operation);
    },
  });
}

export function createRegisteredLocalDataCategories(
  dependencies: LocalDataCategoryRegistryDependencies,
): LocalDataCategoryRegistration[] {
  const tables = dependencies.tables;
  return [
    tableCategory(dependencies, 'history', '观看历史', {
      tables: [tables.watchHistory, tables.playerEvents, tables.dailyAggregates],
      storageKeys: HISTORY_STORAGE_KEYS,
    }, counts => ({
      historyRecords: counts[0] ?? 0,
      playerEvents: counts[1] ?? 0,
      dailyAggregates: counts[2] ?? 0,
    })),
    tableCategory(dependencies, 'favorites', '收藏与智能索引', {
      tables: [tables.favoriteFolders, tables.favoriteItems, tables.smartFavoriteIndex],
    }, counts => ({
      favoriteFolders: counts[0] ?? 0,
      favoriteItems: counts[1] ?? 0,
      smartFavoriteIndexes: counts[2] ?? 0,
    })),
    currentVideoSubtitleCategory(dependencies),
    tableCategory(dependencies, 'dynamicBill', '动态账单', {
      tables: [
        tables.followedCreators,
        tables.followedVideoUpdates,
        tables.dynamicBillItems,
        tables.dynamicBillExplanations,
        tables.dynamicBillCreatorPauses,
        tables.dynamicBillRotationRecords,
      ],
      clearOnlyTables: [tables.dynamicBillFeedback],
      storageKeys: DYNAMIC_BILL_STORAGE_KEYS,
    }, counts => ({
      followedCreators: counts[0] ?? 0,
      followedVideoUpdates: counts[1] ?? 0,
      dynamicBillItems: counts[2] ?? 0,
      dynamicBillExplanations: counts[3] ?? 0,
      dynamicBillCreatorPauses: counts[4] ?? 0,
      dynamicBillRotationRecords: counts[5] ?? 0,
    })),
    blindBoxDrawHistoryCategory(dependencies),
    storageCategory(dependencies, 'localSettings', '本地 AI 设置', LOCAL_SETTING_STORAGE_KEYS),
  ];
}

function blindBoxDrawHistoryCategory(
  dependencies: LocalDataCategoryRegistryDependencies,
): LocalDataCategoryRegistration {
  return {
    id: 'blindBoxDrawHistory',
    label: '盲盒抽取记录',
    includeInClearAll: true,
    collectUsage: () => collectBlindBoxDrawHistoryUsage(dependencies.storage),
    clear: async (): Promise<LocalDataCategoryClearResult> => {
      const clearedCount = await clearBlindBoxDrawHistory(dependencies.storage);
      return { cleared: { blindBoxDrawHistory: clearedCount } };
    },
    readAfterClear: () => readBlindBoxDrawHistoryAfterClear(dependencies.storage),
  };
}

function currentVideoSubtitleCategory(
  dependencies: LocalDataCategoryRegistryDependencies,
): LocalDataCategoryRegistration {
  const group = {
    tables: [
      dependencies.tables.currentVideoTranscriptSources,
      dependencies.tables.currentVideoTranscriptSegments,
    ],
  };
  const collectUsage = () => collectCurrentVideoSubtitleUsage(group.tables);
  return {
    id: 'currentVideoSubtitles',
    label: '当前视频字幕缓存',
    includeInClearAll: true,
    collectUsage,
    clear: async () => {
      const [sources, segments] = await Promise.all(group.tables.map(table => table.toArray()));
      await dependencies.transaction(group.tables, async () => {
        for (const table of group.tables) {
          await table.clear();
        }
      });
      return {
        cleared: {
          currentVideoSubtitleSources: sources.length,
          currentVideoSubtitleSegments: segments.length,
        },
      };
    },
    readAfterClear: async () => {
      const usage = await collectUsage();
      return {
        ...usage,
        empty: usage.count === 0 && usage.usageBytes === 0,
      };
    },
  };
}

function tableCategory(
  dependencies: LocalDataCategoryRegistryDependencies,
  id: LocalDataCategoryRegistration['id'],
  label: string,
  group: CategoryTableGroup,
  toClearedCounts: (counts: number[]) => LocalDataClearedCounts,
): LocalDataCategoryRegistration {
  return {
    id,
    label,
    includeInClearAll: true,
    collectUsage: () => collectTableUsage(dependencies.storage, group),
    clear: async () => {
      const counts = await countTables(group.tables);
      const tablesToClear = [...group.tables, ...(group.clearOnlyTables ?? [])];
      await dependencies.transaction(tablesToClear, async () => {
        for (const table of tablesToClear) {
          await table.clear();
        }
      });
      await removeStorageKeys(dependencies.storage, group.storageKeys);
      return { cleared: toClearedCounts(counts) };
    },
    readAfterClear: () => readbackTableUsage(dependencies.storage, group),
  };
}

function storageCategory(
  dependencies: LocalDataCategoryRegistryDependencies,
  id: LocalDataCategoryRegistration['id'],
  label: string,
  storageKeys: string[],
): LocalDataCategoryRegistration {
  const collectUsage = () => collectStorageUsage(dependencies.storage, storageKeys);
  return {
    id,
    label,
    includeInClearAll: true,
    collectUsage,
    clear: async (): Promise<LocalDataCategoryClearResult> => {
      await removeStorageKeys(dependencies.storage, storageKeys);
      return { cleared: { localSettings: true } };
    },
    readAfterClear: async () => {
      const usage = await collectUsage();
      return {
        ...usage,
        empty: usage.count === 0,
      };
    },
  };
}

async function collectTableUsage(
  storage: LocalDataCategoryStorage,
  group: CategoryTableGroup,
): Promise<LocalDataCategoryUsage> {
  const [counts, bytes] = await Promise.all([
    countTables(group.tables),
    estimateTablesUsageBytes(group.tables),
  ]);
  const storageUsage = group.storageKeys
    ? await collectStorageUsage(storage, group.storageKeys)
    : { count: 0, usageBytes: 0 };
  return {
    count: counts.reduce((sum, count) => sum + count, 0),
    usageBytes: bytes + storageUsage.usageBytes,
  };
}

async function collectCurrentVideoSubtitleUsage(
  tables: LocalDataCategoryTable[],
): Promise<LocalDataCategoryUsage> {
  const [sources, segments] = await Promise.all(tables.map(table => table.toArray()));
  const sourceIdentityCount = new Set(
    sources
      .map(row => sourceIdentityKey(row))
      .filter((value): value is string => Boolean(value)),
  ).size;
  const usageBytes = sources.length > 0 || segments.length > 0
    ? serializedSize({ sources, segments })
    : 0;
  return {
    count: sourceIdentityCount,
    usageBytes,
    details: {
      currentVideoSubtitleSources: sources.length,
      currentVideoSubtitleSegments: segments.length,
    },
  };
}

async function collectStorageUsage(
  storage: LocalDataCategoryStorage,
  storageKeys: string[],
): Promise<LocalDataCategoryUsage> {
  const stored = await storage.get(storageKeys);
  const present = Object.fromEntries(
    Object.entries(stored).filter(([, value]) => value !== undefined),
  );
  return {
    count: Object.keys(present).length,
    usageBytes: Object.keys(present).length > 0 ? serializedSize(present) : 0,
  };
}

async function readbackTableUsage(
  storage: LocalDataCategoryStorage,
  group: CategoryTableGroup,
): Promise<LocalDataCategoryReadback> {
  const usage = await collectTableUsage(storage, group);
  return {
    ...usage,
    empty: usage.count === 0,
  };
}

async function countTables(tables: LocalDataCategoryTable[]): Promise<number[]> {
  return await Promise.all(tables.map(table => table.count()));
}

async function estimateTablesUsageBytes(tables: LocalDataCategoryTable[]): Promise<number> {
  const rows = await Promise.all(tables.map(table => table.toArray()));
  return rows.some(tableRows => tableRows.length > 0) ? serializedSize(rows) : 0;
}

async function removeStorageKeys(
  storage: LocalDataCategoryStorage,
  keys: string[] | undefined,
): Promise<void> {
  if (!keys?.length) return;
  await storage.remove(keys);
}

function serializedSize(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
}

function sourceIdentityKey(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const sourceIdentity = record.sourceIdentityKey ?? record.identityKey;
  return typeof sourceIdentity === 'string' && sourceIdentity.trim()
    ? sourceIdentity
    : null;
}
