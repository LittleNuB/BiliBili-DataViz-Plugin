import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildLocalDataOperationMessage,
  buildLocalDataSummaryCards,
  buildSmartFavoriteRebuildMessage,
  dangerousLocalDataClearScope,
  LOCAL_DATA_CLEAR_CONFIRMATION,
} from '../src/shared/local-data-privacy.ts';
import {
  runLocalDataCategoryLifecycle,
  runLocalDataCategoryLifecycles,
  validateLocalDataCategoryRegistration,
  type LocalDataCategoryRegistration,
  type LocalDataCategoryReadback,
} from '../src/shared/local-data-category-contract.ts';
import {
  createRegisteredLocalDataCategories,
  getRegisteredLocalDataCategories,
  type LocalDataCategoryRegistryDependencies,
  type LocalDataCategoryTable,
} from '../src/background/storage/local-data-category-registry.ts';
import { BLIND_BOX_DRAW_HISTORY_STORAGE_KEY } from '../src/background/storage/blind-box-draw-history-repo.ts';
import { CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY } from '../src/shared/current-video-primary-text-selection.ts';
import type {
  LocalDataOperationResult,
  LocalDataPrivacySummary,
  SmartFavoriteIndexRebuildResult,
} from '../src/shared/types/local-data-privacy.ts';

test('settings local data cards expose natural Chinese summaries only', () => {
  const cards = buildLocalDataSummaryCards(makeSummary());
  assert.deepEqual(cards.map(card => card.title), [
    '观看历史',
    '收藏与智能索引',
    '当前视频字幕缓存',
    '动态账单',
  ]);
  assert.match(cards.map(card => card.value).join('\n'), /128 条/);
  const copy = JSON.stringify(cards);
  assert.doesNotMatch(copy, /暂停|轮换|动态反馈/);
  assertCleanUserCopy(copy);
});

test('settings page keeps Dynamic Bill storage internals out of ordinary copy', async () => {
  const source = await readFile(
    new URL('../dashboard/modules/settings/SettingsPage.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /账单暂停记录|账单轮换记录/);
  assert.doesNotMatch(source, /dynamicBill\.(creatorPauseCount|rotationRecordCount|feedbackCount)/);
});

test('settings local data operation messages stay bounded to counts', () => {
  const subtitleMessage = buildLocalDataOperationMessage({
    operation: 'clear_current_video_subtitle_cache',
    completedAt: 1_718_000_000_000,
    cleared: {
      currentVideoSubtitleSources: 3,
      currentVideoSubtitleSegments: 42,
    },
  });
  assert.equal(subtitleMessage, '已清理当前视频字幕缓存：移除 3 条来源记录和 42 段字幕正文。');

  const clearAllMessage = buildLocalDataOperationMessage({
    operation: 'clear_all_local_data',
    completedAt: 1_718_000_000_000,
    cleared: {
      historyRecords: 128,
      favoriteItems: 24,
      currentVideoSubtitleSegments: 42,
      dynamicBillItems: 6,
      localSettings: true,
    },
  } satisfies LocalDataOperationResult);
  assert.match(clearAllMessage, /本地 AI 设置和功能开关也已恢复为默认状态/);
  assert.doesNotMatch(clearAllMessage, /暂停|轮换|动态反馈/);
  assertCleanUserCopy([subtitleMessage, clearAllMessage].join('\n'));
});

test('settings dangerous clear scope requires explicit Chinese confirmation', () => {
  assert.equal(LOCAL_DATA_CLEAR_CONFIRMATION, '清理本地数据');
  const scope = dangerousLocalDataClearScope().join('\n');
  assert.match(scope, /本地 AI 服务设置/);
  assertCleanUserCopy(scope);
});

test('settings smart favorite rebuild message summarizes the run', () => {
  const message = buildSmartFavoriteRebuildMessage({
    totalItems: 24,
    clearedIndexes: 21,
    processed: 24,
    indexed: 22,
    failed: 2,
    skipped: 0,
    notes: [],
    completedAt: 1_718_000_000_000,
  } satisfies SmartFavoriteIndexRebuildResult);
  assert.match(message, /本地收藏 24 条/);
  assert.match(message, /失败项可在确认 AI 设置后再次重建/);
  assertCleanUserCopy(message);
});

test('local data categories expose the shared lifecycle contract', () => {
  const categories = getRegisteredLocalDataCategories();
  assert.deepEqual(categories.map(category => category.id), [
    'history',
    'favorites',
    'currentVideoSubtitles',
    'dynamicBill',
    'blindBoxDrawHistory',
    'localSettings',
  ]);

  for (const category of categories) {
    assert.deepEqual(validateLocalDataCategoryRegistration(category), []);
    assert.equal(category.includeInClearAll, true);
  }
});

test('registered categories collect usage, clear independently, and read back the cleared state', async () => {
  const dependencies = createRegistryDependencies();
  const categories = createRegisteredLocalDataCategories(dependencies);
  const usageBefore = await Promise.all(categories.map(category => category.collectUsage()));

  assert.deepEqual(usageBefore.map(usage => usage.count), [3, 3, 1, 9, 2, 3]);
  assert.ok(usageBefore.every(usage => usage.usageBytes > 0));
  assert.equal(usageBefore[2].details?.currentVideoSubtitleSources, 1);
  assert.equal(usageBefore[2].details?.currentVideoSubtitleSegments, 1);
  const subtitleRows = [
    registryRow('currentVideoTranscriptSources'),
    registryRow('currentVideoTranscriptSegments'),
  ];
  const subtitleRecordSumBytes = subtitleRows.reduce((sum, row) => sum + utf8JsonBytes(row), 0);
  const subtitleWrappedBytes = utf8JsonBytes({
    sources: [subtitleRows[0]],
    segments: [subtitleRows[1]],
  });
  assert.equal(usageBefore[2].usageBytes, subtitleRecordSumBytes);
  assert.ok(usageBefore[2].usageBytes < subtitleWrappedBytes);

  const history = categories[0];
  const favorites = categories[1];
  const historyClear = await history.clear();
  assert.equal(historyClear.cleared.historyRecords, 1);
  assert.deepEqual(await history.readAfterClear(), {
    count: 0,
    usageBytes: 0,
    empty: true,
  });
  assert.equal((await favorites.collectUsage()).count, 3, 'independent clear must not touch another category');

  for (const category of categories.slice(1)) {
    const clearResult = await category.clear();
    assert.ok(Object.keys(clearResult.cleared).length > 0);
    if (category.id === 'dynamicBill') {
      assert.equal(clearResult.cleared.dynamicBillCreatorPauses, 1);
      assert.equal(clearResult.cleared.dynamicBillFeedbackActions, 1);
      assert.equal(clearResult.cleared.dynamicBillCreatorFeedbackCounts, 1);
      assert.equal(clearResult.cleared.dynamicBillCreatorReviewPrompts, 1);
      assert.equal(clearResult.cleared.dynamicBillRotationRecords, 1);
      assert.equal('dynamicBillFeedback' in clearResult.cleared, false);
    }
    if (category.id === 'currentVideoSubtitles') {
      const localSettings = categories.find(entry => entry.id === 'localSettings');
      assert.equal((await localSettings?.collectUsage())?.count, 3, 'subtitle clear must preserve source choices');
    }
    const readback = await category.readAfterClear();
    assert.equal(readback.count, 0, category.label);
    assert.equal(readback.empty, true, category.label);
  }
  assert.equal(await dependencies.tables.dynamicBillFeedback.count(), 0);
});

test('lifecycle results retain completed categories and name a failed category in natural Chinese', async () => {
  const calls: string[] = [];
  const registrations = [
    lifecycleRegistration('history', '观看历史', calls),
    lifecycleRegistration('favorites', '收藏与智能索引', calls, 'clear'),
    lifecycleRegistration('dynamicBill', '动态账单', calls),
  ];

  const results = await runLocalDataCategoryLifecycles(registrations);

  assert.deepEqual(results.map(result => result.status), ['success', 'failure', 'success']);
  assert.deepEqual(calls, [
    '观看历史:usage',
    '观看历史:clear',
    '观看历史:readback',
    '收藏与智能索引:usage',
    '收藏与智能索引:clear',
    '动态账单:usage',
    '动态账单:clear',
    '动态账单:readback',
  ]);
  assert.equal(results[0].status === 'success' && results[0].after.empty, true);
  assert.equal(results[1].status, 'failure');
  if (results[1].status === 'failure') {
    assert.equal(results[1].failedStage, 'clear');
    assert.match(results[1].message, /收藏与智能索引清理失败/);
    assert.equal(results[1].before?.count, 1);
  }
});

test('lifecycle reports a readback failure whenever cleared data remains', async t => {
  const cases: Array<{ name: string; after: LocalDataCategoryReadback }> = [
    {
      name: 'empty is false',
      after: { count: 0, usageBytes: 0, empty: false },
    },
    {
      name: 'count is non-zero',
      after: { count: 1, usageBytes: 0, empty: true },
    },
    {
      name: 'usage is non-zero',
      after: { count: 0, usageBytes: 16, empty: true },
    },
  ];

  for (const currentCase of cases) {
    await t.test(currentCase.name, async () => {
      const registration = lifecycleRegistration('history', '观看历史', []);
      registration.readAfterClear = async () => currentCase.after;

      const result = await runLocalDataCategoryLifecycle(registration);

      assert.equal(result.status, 'failure');
      if (result.status === 'failure') {
        assert.equal(result.failedStage, 'readback');
        assert.equal(result.failureReason, 'data_remaining');
        assert.deepEqual(result.after, currentCase.after);
        assert.match(result.message, /观看历史已执行清理，但回读后仍有本地数据/);
        assertCleanUserCopy(result.message);
      }
    });
  }
});

test('SET-013-A keeps the existing clear-all production transaction', async () => {
  const source = await readFile(
    new URL('../src/background/storage/local-data-privacy-repo.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /db\.transaction\(\s*'rw',\s*db\.tables/);
  assert.match(source, /chrome\.storage\.local\.clear\(\)/);
  assert.match(source, /runCurrentVideoTranscriptClearCoordinator\(\s*async\s*\(\)\s*=>\s*\r?\n\s*coordinateBlindBoxDrawHistoryClear/);
  assert.doesNotMatch(source, /clearRegisteredLocalDataCategories/);
});

function makeSummary(): LocalDataPrivacySummary {
  return {
    checkedAt: 1_718_000_000_000,
    history: {
      totalRecords: 128,
      oldestViewAt: 1_700_000_000,
      newestViewAt: 1_718_000_000,
      lastSyncedAt: 1_718_000_000_000,
      syncing: false,
      backfillComplete: true,
    },
    favorites: {
      folderCount: 4,
      reportedItems: 28,
      storedItems: 24,
      indexedItems: 21,
      failedIndexItems: 1,
      pendingIndexItems: 2,
      incompleteFolders: 0,
      syncComplete: true,
      lastSyncedAt: 1_718_000_000_000,
      lastIndexedAt: 1_718_000_000_000,
    },
    currentVideoSubtitles: {
      sourceCount: 3,
      sourceIdentityCount: 3,
      segmentCount: 42,
      staleSegmentCount: 4,
      cachedVideoCount: 2,
      usageBytes: 8192,
      lastUpdatedAt: 1_718_000_000_000,
    },
    dynamicBill: {
      activeFollowedCreatorCount: 12,
      followedVideoUpdateCount: 8,
      billItemCount: 6,
      rotationRecordCount: 4,
      creatorPauseCount: 1,
      feedbackActionCount: 0,
      creatorFeedbackCount: 0,
      creatorReviewPromptCount: 0,
      activeCreatorPauses: [],
      unopenedItems: 2,
      openedItems: 1,
      consumedItems: 2,
      processedItems: 1,
      explanationCount: 5,
      lastGeneratedAt: 1_718_000_000_000,
      lastSyncedAt: 1_718_000_000_000,
      syncStatus: 'success',
    },
  };
}

function createRegistryDependencies(): LocalDataCategoryRegistryDependencies {
  const tableNames: Array<keyof LocalDataCategoryRegistryDependencies['tables']> = [
    'watchHistory',
    'playerEvents',
    'dailyAggregates',
    'favoriteFolders',
    'favoriteItems',
    'smartFavoriteIndex',
    'currentVideoTranscriptSources',
    'currentVideoTranscriptSegments',
    'followedCreators',
    'followedVideoUpdates',
    'dynamicBillItems',
    'dynamicBillExplanations',
    'dynamicBillFeedback',
    'dynamicBillCreatorPauses',
    'dynamicBillFeedbackActions',
    'dynamicBillCreatorFeedbackCounts',
    'dynamicBillCreatorReviewPrompts',
    'dynamicBillRotationRecords',
  ];
  const tables = Object.fromEntries(
    tableNames.map(name => [name, memoryTable([registryRow(name)])]),
  ) as LocalDataCategoryRegistryDependencies['tables'];
  const storage = new Map<string, unknown>([
    ['lastSyncTime', 100],
    ['dynamicBillSyncState', { status: 'success' }],
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY, ['BV1LATEST01', 'BV1LATEST02']],
    ['userConfig', { assistant: {} }],
    ['floatingPopupWindowId', 7],
    [CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY, {
      'BV1Settings:101:1': 'primary-text:bilibili_subtitle:BV1Settings:101:1:zh-cn:hash',
    }],
  ]);

  return {
    tables,
    storage: {
      get: async keys => Object.fromEntries(keys.map(key => [key, storage.get(key)])),
      remove: async keys => {
        for (const key of keys) storage.delete(key);
      },
    },
    transaction: async (_tables, operation) => operation(),
  };
}

function registryRow(name: keyof LocalDataCategoryRegistryDependencies['tables']): Record<string, unknown> {
  if (name === 'currentVideoTranscriptSources') {
    return {
      id: name,
      identityKey: 'primary-text:bilibili_subtitle:BV1Settings:101:1:zh-cn:hash',
      sourceIdentityKey: 'primary-text:bilibili_subtitle:BV1Settings:101:1:zh-cn:hash',
    };
  }
  if (name === 'currentVideoTranscriptSegments') {
    return {
      id: name,
      segmentId: 'transcript:settings:1',
      sourceIdentityKey: 'primary-text:bilibili_subtitle:BV1Settings:101:1:zh-cn:hash',
    };
  }
  return { id: name, value: `row-${name}` };
}

function memoryTable(initialRows: unknown[]): LocalDataCategoryTable {
  let rows = [...initialRows];
  return {
    count: async () => rows.length,
    toArray: async () => [...rows],
    clear: async () => {
      rows = [];
    },
  };
}

function lifecycleRegistration(
  id: LocalDataCategoryRegistration['id'],
  label: string,
  calls: string[],
  failAt?: 'usage' | 'clear' | 'readback',
): LocalDataCategoryRegistration {
  return {
    id,
    label,
    includeInClearAll: true,
    collectUsage: async () => {
      calls.push(`${label}:usage`);
      if (failAt === 'usage') throw new Error('raw usage failure');
      return { count: 1, usageBytes: 10 };
    },
    clear: async () => {
      calls.push(`${label}:clear`);
      if (failAt === 'clear') throw new Error('raw clear failure');
      return { cleared: {} };
    },
    readAfterClear: async () => {
      calls.push(`${label}:readback`);
      if (failAt === 'readback') throw new Error('raw readback failure');
      return { count: 0, usageBytes: 0, empty: true };
    },
  };
}

function assertCleanUserCopy(text: string): void {
  const forbidden = [
    'G' + 'ET_',
    'C' + 'LEAR_',
    'R' + 'EBUILD_',
    'source' + 'Hash',
    'segment' + 'Id',
    'subtitle' + '_url',
    'DB ' + 'table',
    'Key' + '.txt',
  ];
  for (const token of forbidden) {
    assert.doesNotMatch(text, new RegExp(escapeRegExp(token), 'i'));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function utf8JsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
