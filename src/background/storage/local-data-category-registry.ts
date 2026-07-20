import type { Table } from 'dexie';
import type {
  LocalDataCategoryClearResult,
  LocalDataCategoryReadback,
  LocalDataCategoryRegistration,
  LocalDataCategoryUsage,
  LocalDataClearedCounts,
} from '../../shared/local-data-category-contract.ts';
import { db } from './db.ts';
import { clearTemporaryCurrentVideoTranscriptCache } from '../current-video-temporary-transcript-cache.ts';
import { runCurrentVideoTranscriptClearCoordinator } from '../current-video-transcript-clear-epoch.ts';
import {
  clearBlindBoxDrawHistory,
  collectBlindBoxDrawHistoryUsage,
  readBlindBoxDrawHistoryAfterClear,
} from './blind-box-draw-history-repo.ts';
import { runCurrentVideoSummaryHighlightsClearCoordinator } from '../current-video-summary-highlights-clear-epoch.ts';
import {
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
} from '../../shared/current-video-primary-text-selection.ts';
import {
  coordinateCurrentVideoPrimaryTextSelectionClear,
} from './current-video-primary-text-selection-store.ts';
import {
  invalidateCurrentVideoFullTextQaSources,
} from '../current-video-full-text-qa.ts';
import { runCurrentVideoQaSessionClearCoordinator } from './current-video-qa-session-repo.ts';

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
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
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
  | 'currentVideoSummaryHighlights'
  | 'currentVideoQaSessions'
  | 'followedCreators'
  | 'followedVideoUpdates'
  | 'dynamicBillItems'
  | 'dynamicBillExplanations'
  | 'dynamicBillFeedback'
  | 'dynamicBillCreatorPauses'
  | 'dynamicBillFeedbackActions'
  | 'dynamicBillCreatorFeedbackCounts'
  | 'dynamicBillCreatorReviewPrompts'
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
  onCurrentVideoQaSessionsClear?: () => void;
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
      currentVideoSummaryHighlights: db.currentVideoSummaryHighlights,
      currentVideoQaSessions: db.currentVideoQaSessions,
      followedCreators: db.followedCreators,
      followedVideoUpdates: db.followedVideoUpdates,
      dynamicBillItems: db.dynamicBillItems,
      dynamicBillExplanations: db.dynamicBillExplanations,
      dynamicBillFeedback: db.dynamicBillFeedback,
      dynamicBillCreatorPauses: db.dynamicBillCreatorPauses,
      dynamicBillFeedbackActions: db.dynamicBillFeedbackActions,
      dynamicBillCreatorFeedbackCounts: db.dynamicBillCreatorFeedbackCounts,
      dynamicBillCreatorReviewPrompts: db.dynamicBillCreatorReviewPrompts,
      dynamicBillRotationRecords: db.dynamicBillRotationRecords,
    },
    storage: {
      get: keys => chrome.storage.local.get(keys),
      remove: keys => chrome.storage.local.remove(keys),
    },
    transaction: async (tables, operation) => {
      await db.transaction('rw', tables as unknown as AnyTable[], operation);
    },
    onCurrentVideoQaSessionsClear: invalidateCurrentVideoFullTextQaSources,
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
    currentVideoSummaryHighlightCategory(dependencies),
    currentVideoQaSessionsCategory(dependencies),
    tableCategory(dependencies, 'dynamicBill', '动态账单', {
      tables: [
        tables.followedCreators,
        tables.followedVideoUpdates,
        tables.dynamicBillItems,
        tables.dynamicBillExplanations,
        tables.dynamicBillCreatorPauses,
        tables.dynamicBillFeedbackActions,
        tables.dynamicBillCreatorFeedbackCounts,
        tables.dynamicBillCreatorReviewPrompts,
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
      dynamicBillFeedbackActions: counts[5] ?? 0,
      dynamicBillCreatorFeedbackCounts: counts[6] ?? 0,
      dynamicBillCreatorReviewPrompts: counts[7] ?? 0,
      dynamicBillRotationRecords: counts[8] ?? 0,
    })),
    blindBoxDrawHistoryCategory(dependencies),
    storageCategory(
      dependencies,
      'localSettings',
      '本地 AI 设置',
      LOCAL_SETTING_STORAGE_KEYS,
      coordinateCurrentVideoPrimaryTextSelectionClear,
    ),
  ];
}

function currentVideoQaSessionsCategory(
  dependencies: LocalDataCategoryRegistryDependencies,
): LocalDataCategoryRegistration {
  const table = dependencies.tables.currentVideoQaSessions;
  const collectUsage = async () => {
    const rows = await table.toArray();
    const usageBytes = rows.length > 0 ? serializedRowsSize(rows) : 0;
    return {
      count: rows.length,
      usageBytes,
      details: {
        currentVideoQaSessions: rows.length,
        currentVideoQaSessionBytes: usageBytes,
      },
    };
  };
  return {
    id: 'currentVideoQaSessions',
    label: '问答会话',
    includeInClearAll: true,
    collectUsage,
    clear: async () => runCurrentVideoQaSessionClearCoordinator(async () => {
      dependencies.onCurrentVideoQaSessionsClear?.();
      const usage = await collectUsage();
      await dependencies.transaction([table], async () => {
        await table.clear();
      });
      return {
        cleared: {
          currentVideoQaSessions: usage.count,
          currentVideoQaSessionBytes: usage.usageBytes,
        },
      };
    }),
    readAfterClear: async () => {
      const usage = await collectUsage();
      return {
        ...usage,
        empty: usage.count === 0 && usage.usageBytes === 0,
      };
    },
  };
}

function currentVideoSummaryHighlightCategory(
  dependencies: LocalDataCategoryRegistryDependencies,
): LocalDataCategoryRegistration {
  const table = dependencies.tables.currentVideoSummaryHighlights;
  const collectUsage = async () => {
    const rows = await table.toArray();
    const latestGeneratedAt = rows.reduce<number | null>((latest, row) => {
      const generatedAt = row && typeof row === 'object'
        ? normalizeTimestamp((row as Record<string, unknown>).generatedAt)
        : null;
      if (!generatedAt) return latest;
      return latest === null ? generatedAt : Math.max(latest, generatedAt);
    }, null);
    return {
      count: rows.length,
      usageBytes: rows.length > 0 ? serializedRowsSize(rows) : 0,
      details: {
        currentVideoSummaryHighlightParts: rows.length,
        currentVideoSummaryHighlightBytes: rows.length > 0 ? serializedRowsSize(rows) : 0,
      },
      latestGeneratedAt,
    };
  };
  return {
    id: 'currentVideoSummaryHighlights',
    label: '摘要与亮点',
    includeInClearAll: true,
    collectUsage,
    clear: async () => runCurrentVideoSummaryHighlightsClearCoordinator(async () => {
      const usage = await collectUsage();
      await dependencies.transaction([table], async () => {
        await table.clear();
      });
      return {
        cleared: {
          currentVideoSummaryHighlightParts: usage.count,
          currentVideoSummaryHighlightBytes: usage.usageBytes,
        },
      };
    }),
    readAfterClear: async () => {
      const usage = await collectUsage();
      return {
        ...usage,
        empty: usage.count === 0 && usage.usageBytes === 0,
      };
    },
  };
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
    label: 'B站字幕正文',
    includeInClearAll: true,
    collectUsage,
    clear: async () => runCurrentVideoTranscriptClearCoordinator(async () => {
      const [sources, segments] = await Promise.all(group.tables.map(table => table.toArray()));
      await dependencies.transaction(group.tables, async () => {
        for (const table of group.tables) {
          await table.clear();
        }
      });
      clearTemporaryCurrentVideoTranscriptCache();
      return {
        cleared: {
          currentVideoSubtitleSources: sources.length,
          currentVideoSubtitleSegments: segments.length,
        },
      };
    }),
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
  coordinateClear?: <T>(clear: () => Promise<T>) => Promise<T>,
): LocalDataCategoryRegistration {
  const collectUsage = () => collectStorageUsage(dependencies.storage, storageKeys);
  return {
    id,
    label,
    includeInClearAll: true,
    collectUsage,
    clear: async (): Promise<LocalDataCategoryClearResult> => {
      const clear = async (): Promise<LocalDataCategoryClearResult> => {
        await removeStorageKeys(dependencies.storage, storageKeys);
        return { cleared: { localSettings: true } };
      };
      if (coordinateClear) return coordinateClear(clear);
      return clear();
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
    ? serializedRowsSize([...sources, ...segments])
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

function serializedRowsSize(rows: unknown[]): number {
  return rows.reduce<number>((sum, row) => sum + serializedSize(row), 0);
}

function sourceIdentityKey(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const sourceIdentity = record.sourceIdentityKey ?? record.identityKey;
  return typeof sourceIdentity === 'string' && sourceIdentity.trim()
    ? sourceIdentity
    : null;
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
