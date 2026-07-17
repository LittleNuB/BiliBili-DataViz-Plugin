import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocalDataOperationMessage,
  buildLocalDataSummaryCards,
  buildSmartFavoriteRebuildMessage,
  dangerousLocalDataClearScope,
  LOCAL_DATA_CLEAR_CONFIRMATION,
} from '../src/shared/local-data-privacy.ts';
import { validateLocalDataCategoryRegistration } from '../src/shared/local-data-category-contract.ts';
import { getRegisteredLocalDataCategories } from '../src/background/storage/local-data-category-registry.ts';
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
  assertCleanUserCopy(JSON.stringify(cards));
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
    'localSettings',
  ]);

  for (const category of categories) {
    assert.deepEqual(validateLocalDataCategoryRegistration(category), []);
    assert.equal(category.includeInClearAll, true);
  }
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
      segmentCount: 42,
      staleSegmentCount: 4,
      cachedVideoCount: 2,
      lastUpdatedAt: 1_718_000_000_000,
    },
    dynamicBill: {
      activeFollowedCreatorCount: 12,
      followedVideoUpdateCount: 8,
      billItemCount: 6,
      unopenedItems: 2,
      openedItems: 1,
      consumedItems: 2,
      processedItems: 1,
      feedbackCount: 3,
      explanationCount: 5,
      lastGeneratedAt: 1_718_000_000_000,
      lastSyncedAt: 1_718_000_000_000,
      syncStatus: 'success',
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
