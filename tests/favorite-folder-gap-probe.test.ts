import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFavoriteFolderGapReport } from '../src/background/favorites/folder-gap-probe-report.ts';
import type {
  FavoriteFolderSyncDiagnostic,
  FavoriteItem,
  SmartFavoriteIndex,
} from '../src/shared/types/favorite.ts';

test('classifies mixed favorite folder gaps across API, local retention, and index coverage', () => {
  const localItems = [makeFavoriteItem(1), makeFavoriteItem(2), makeFavoriteItem(3)];
  const probeItems = [makeFavoriteItem(1), makeFavoriteItem(2)];
  const indexMap = new Map<string, SmartFavoriteIndex>([
    [localItems[0].itemKey, makeIndex(localItems[0].itemKey, 'indexed')],
    [localItems[1].itemKey, makeIndex(localItems[1].itemKey, 'failed')],
  ]);

  const result = buildFavoriteFolderGapReport(
    { mediaId: 100, title: 'Default', mediaCount: 6 },
    makeDiagnostic({
      reportedMediaCount: 6,
      uniqueResourcesSeen: 4,
      storedVideoItems: 2,
      filteredItems: 1,
      filteredUnavailableItems: 1,
      duplicateResourceIds: 1,
      duplicateBvids: 1,
    }),
    localItems,
    probeItems,
    indexMap,
  );

  assert.equal(result.classification, 'mixed');
  assert.deepEqual(result.gapBuckets, {
    apiMissingItems: 2,
    filteredItems: 1,
    storedButNotIndexedItems: 2,
    localOnlyItems: 1,
  });
  assert.equal(result.localIndexCoverage.overlapItems, 2);
  assert.equal(result.localIndexCoverage.localOnlyItems, 1);
  assert.equal(result.localIndexCoverage.pendingItems, 1);
  assert.equal(result.localIndexCoverage.failedItems, 1);
  assert.match(result.notes.join(' '), /duplicate resources/i);
});

test('classifies filtered-only gaps when the API coverage is complete and local index is healthy', () => {
  const localItems = [makeFavoriteItem(1), makeFavoriteItem(2)];
  const probeItems = [makeFavoriteItem(1), makeFavoriteItem(2)];
  const indexMap = new Map<string, SmartFavoriteIndex>([
    [localItems[0].itemKey, makeIndex(localItems[0].itemKey, 'indexed')],
    [localItems[1].itemKey, makeIndex(localItems[1].itemKey, 'indexed')],
  ]);

  const result = buildFavoriteFolderGapReport(
    { mediaId: 100, title: 'Default', mediaCount: 4 },
    makeDiagnostic({
      reportedMediaCount: 4,
      uniqueResourcesSeen: 4,
      storedVideoItems: 2,
      filteredItems: 2,
      filteredMissingIdItems: 1,
      filteredNonVideoItems: 1,
    }),
    localItems,
    probeItems,
    indexMap,
  );

  assert.equal(result.classification, 'filtered_only');
  assert.equal(result.gapBuckets.apiMissingItems, 0);
  assert.equal(result.gapBuckets.filteredItems, 2);
  assert.equal(result.gapBuckets.storedButNotIndexedItems, 0);
  assert.equal(result.gapBuckets.localOnlyItems, 0);
});

function makeDiagnostic(overrides: Partial<FavoriteFolderSyncDiagnostic>): FavoriteFolderSyncDiagnostic {
  return {
    mediaId: 100,
    title: 'Default',
    reportedMediaCount: 0,
    pageSize: 20,
    requestedPages: 1,
    pagesFetched: 1,
    rawResourcesSeen: 0,
    uniqueResourcesSeen: 0,
    duplicateResourceIds: 0,
    duplicateBvids: 0,
    storedVideoItems: 0,
    filteredUnavailableItems: 0,
    filteredMissingIdItems: 0,
    filteredNonVideoItems: 0,
    filteredItems: 0,
    pageErrors: 0,
    hasMoreAfterStop: false,
    stoppedByMaxPages: false,
    unexplainedDelta: 0,
    completenessState: 'complete',
    stopReason: 'has_more_false',
    pageDiagnostics: [],
    errors: [],
    ...overrides,
  };
}

function makeFavoriteItem(id: number): FavoriteItem {
  return {
    itemKey: `100:BV${id}`,
    mediaId: 100,
    folderTitle: 'Default',
    avid: id,
    bvid: `BV${id}`,
    title: `Video ${id}`,
    intro: '',
    authorName: `UP ${id}`,
    authorMid: id,
    tagName: '',
    tags: [],
    cover: '',
    duration: 0,
    pubtime: 0,
    favTime: id,
    syncedAt: 100 + id,
  };
}

function makeIndex(itemKey: string, status: SmartFavoriteIndex['status']): SmartFavoriteIndex {
  return {
    itemKey,
    path: ['Knowledge'],
    summary: 'Summary',
    keywords: [],
    aliases: [],
    searchableText: 'Summary',
    contentHash: 'hash',
    model: 'test-model',
    status,
    indexedAt: 50,
  };
}
