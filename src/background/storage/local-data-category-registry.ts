import type { Table } from 'dexie';
import type {
  LocalDataCategoryId,
  LocalDataCategoryReadback,
  LocalDataCategoryRegistration,
  LocalDataCategoryUsage,
} from '../../shared/local-data-category-contract.ts';
import type { LocalDataOperationResult } from '../../shared/types/local-data-privacy.ts';
import { db } from './db.ts';

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

interface CategoryTableGroup {
  tables: AnyTable[];
  storageKeys?: string[];
}

interface CategoryCounts {
  cleared: LocalDataOperationResult['cleared'];
}

export function getRegisteredLocalDataCategories(): LocalDataCategoryRegistration[] {
  return [
    tableCategory('history', '观看历史', {
      tables: [db.watchHistory, db.playerEvents, db.dailyAggregates],
      storageKeys: HISTORY_STORAGE_KEYS,
    }, counts => ({
      historyRecords: counts[0] ?? 0,
      playerEvents: counts[1] ?? 0,
      dailyAggregates: counts[2] ?? 0,
    })),
    tableCategory('favorites', '收藏与智能索引', {
      tables: [db.favoriteFolders, db.favoriteItems, db.smartFavoriteIndex],
    }, counts => ({
      favoriteFolders: counts[0] ?? 0,
      favoriteItems: counts[1] ?? 0,
      smartFavoriteIndexes: counts[2] ?? 0,
    })),
    tableCategory('currentVideoSubtitles', '当前视频字幕缓存', {
      tables: [db.currentVideoTranscriptSources, db.currentVideoTranscriptSegments],
    }, counts => ({
      currentVideoSubtitleSources: counts[0] ?? 0,
      currentVideoSubtitleSegments: counts[1] ?? 0,
    })),
    tableCategory('dynamicBill', '动态账单', {
      tables: [
        db.followedCreators,
        db.followedVideoUpdates,
        db.dynamicBillItems,
        db.dynamicBillExplanations,
        db.dynamicBillFeedback,
      ],
      storageKeys: DYNAMIC_BILL_STORAGE_KEYS,
    }, counts => ({
      followedCreators: counts[0] ?? 0,
      followedVideoUpdates: counts[1] ?? 0,
      dynamicBillItems: counts[2] ?? 0,
      dynamicBillExplanations: counts[3] ?? 0,
      dynamicBillFeedback: counts[4] ?? 0,
    })),
    storageCategory('localSettings', '本地 AI 设置', LOCAL_SETTING_STORAGE_KEYS),
  ];
}

export async function clearRegisteredLocalDataCategories(): Promise<{
  cleared: LocalDataOperationResult['cleared'];
  categories: NonNullable<LocalDataOperationResult['categories']>;
}> {
  const cleared: LocalDataOperationResult['cleared'] = {};
  const categories: NonNullable<LocalDataOperationResult['categories']> = [];

  for (const category of getRegisteredLocalDataCategories().filter(item => item.includeInClearAll)) {
    const before = await category.collectUsage();
    const result = await category.clear() as CategoryCounts;
    Object.assign(cleared, result.cleared);
    const after = await category.readAfterClear();
    categories.push({
      id: category.id,
      label: category.label,
      before,
      after,
    });
  }

  return { cleared, categories };
}

export async function clearRegisteredLocalDataCategory(
  id: LocalDataCategoryId,
): Promise<{
  cleared: LocalDataOperationResult['cleared'];
  category: NonNullable<LocalDataOperationResult['categories']>[number];
}> {
  const category = getRegisteredLocalDataCategories().find(item => item.id === id);
  if (!category) throw new Error('LOCAL_DATA_CATEGORY_NOT_REGISTERED');
  const before = await category.collectUsage();
  const result = await category.clear() as CategoryCounts;
  const after = await category.readAfterClear();
  return {
    cleared: result.cleared,
    category: {
      id: category.id,
      label: category.label,
      before,
      after,
    },
  };
}

function tableCategory(
  id: LocalDataCategoryRegistration['id'],
  label: string,
  group: CategoryTableGroup,
  toClearedCounts: (counts: number[]) => LocalDataOperationResult['cleared'],
): LocalDataCategoryRegistration {
  return {
    id,
    label,
    includeInClearAll: true,
    collectUsage: () => collectTableUsage(group),
    clear: async () => {
      const counts = await countTables(group.tables);
      await db.transaction('rw', group.tables, async () => {
        for (const table of group.tables) {
          await table.clear();
        }
      });
      await removeStorageKeys(group.storageKeys);
      return { cleared: toClearedCounts(counts) } satisfies CategoryCounts;
    },
    readAfterClear: () => readbackTableUsage(group),
  };
}

function storageCategory(
  id: LocalDataCategoryRegistration['id'],
  label: string,
  storageKeys: string[],
): LocalDataCategoryRegistration {
  return {
    id,
    label,
    includeInClearAll: true,
    collectUsage: async () => {
      const stored = await chrome.storage.local.get(storageKeys);
      return {
        count: Object.values(stored).filter(value => value !== undefined).length,
        usageBytes: serializedSize(stored),
      };
    },
    clear: async () => {
      await removeStorageKeys(storageKeys);
      return { cleared: { localSettings: true } } satisfies CategoryCounts;
    },
    readAfterClear: async () => {
      const usage = await storageCategory(id, label, storageKeys).collectUsage();
      return {
        ...usage,
        empty: usage.count === 0,
      };
    },
  };
}

async function collectTableUsage(group: CategoryTableGroup): Promise<LocalDataCategoryUsage> {
  const [counts, bytes] = await Promise.all([
    countTables(group.tables),
    estimateTablesUsageBytes(group.tables),
  ]);
  const storageBytes = group.storageKeys
    ? serializedSize(await chrome.storage.local.get(group.storageKeys))
    : 0;
  return {
    count: counts.reduce((sum, count) => sum + count, 0),
    usageBytes: bytes + storageBytes,
  };
}

async function readbackTableUsage(group: CategoryTableGroup): Promise<LocalDataCategoryReadback> {
  const usage = await collectTableUsage(group);
  return {
    ...usage,
    empty: usage.count === 0,
  };
}

async function countTables(tables: AnyTable[]): Promise<number[]> {
  return await Promise.all(tables.map(table => table.count()));
}

async function estimateTablesUsageBytes(tables: AnyTable[]): Promise<number> {
  const rows = await Promise.all(tables.map(table => table.toArray()));
  return serializedSize(rows);
}

async function removeStorageKeys(keys: string[] | undefined): Promise<void> {
  if (!keys?.length) return;
  await chrome.storage.local.remove(keys);
}

function serializedSize(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
}
