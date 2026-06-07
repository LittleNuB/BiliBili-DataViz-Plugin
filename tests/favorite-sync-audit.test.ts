import assert from 'node:assert/strict';
import test from 'node:test';
import { FAVORITE_PAGE_SIZE } from '../src/shared/constants.ts';
import type { FavoriteFolder, FavoriteFolderSyncDiagnostic, FavoriteItem } from '../src/shared/types/favorite.ts';
import {
  fetchFavoriteItemsWithPageFetcher,
  type FavoriteResourceApiItem,
  type FavoriteResourcesData,
} from '../src/background/favorites/favorite-fetch-loop.ts';
import { assessFavoriteSyncCompleteness } from '../src/background/favorites/sync-audit.ts';
import { persistFavoriteSyncData } from '../src/background/favorites/sync-persistence.ts';

const folder: FavoriteFolder = {
  mediaId: 100,
  title: 'Default',
  cover: '',
  intro: '',
  mediaCount: 0,
  createdAt: 0,
  updatedAt: 0,
  syncedAt: 0,
};

test('fetches all favorite resource pages until has_more is false', async () => {
  const pages: FavoriteResourcesData[] = [
    { medias: makeVideos(FAVORITE_PAGE_SIZE, 0), has_more: true },
    { medias: makeVideos(5, FAVORITE_PAGE_SIZE), has_more: false },
  ];

  const result = await fetchFavoriteItemsWithPageFetcher(
    { ...folder, mediaCount: 25 },
    async pageNumber => pages[pageNumber - 1] ?? { medias: [], has_more: false },
    undefined,
    500,
    FAVORITE_PAGE_SIZE,
  );

  assert.equal(result.items.length, 25);
  assert.equal(result.diagnostic.pagesFetched, 2);
  assert.equal(result.diagnostic.rawResourcesSeen, 25);
  assert.equal(result.diagnostic.unexplainedDelta, 0);
  assert.deepEqual(result.diagnostic.errors, []);
});

test('counts unavailable, non-video, and missing-id favorite resources as filtered', async () => {
  const medias: FavoriteResourceApiItem[] = [
    makeVideo(1),
    { id: 2, bvid: 'BV2', title: '已失效视频', type: 2, attr: 1 },
    { id: 3, bvid: 'BV3', title: 'Audio resource', type: 12 },
    { title: 'Missing id', type: 2 },
  ];

  const result = await fetchFavoriteItemsWithPageFetcher(
    { ...folder, mediaCount: 4 },
    async () => ({ medias, has_more: false }),
    undefined,
    500,
    FAVORITE_PAGE_SIZE,
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.diagnostic.filteredUnavailableItems, 1);
  assert.equal(result.diagnostic.filteredNonVideoItems, 1);
  assert.equal(result.diagnostic.filteredMissingIdItems, 1);
  assert.equal(result.diagnostic.filteredItems, 3);
  assert.equal(result.diagnostic.unexplainedDelta, 0);
});

test('blocks incomplete favorite sync diagnostics before snapshot replacement', () => {
  const diagnostics: FavoriteFolderSyncDiagnostic[] = [{
    mediaId: 100,
    title: 'Default',
    reportedMediaCount: 158,
    pagesFetched: 7,
    rawResourcesSeen: 137,
    storedVideoItems: 137,
    filteredUnavailableItems: 0,
    filteredMissingIdItems: 0,
    filteredNonVideoItems: 0,
    filteredItems: 0,
    hasMoreAfterStop: false,
    stoppedByMaxPages: false,
    unexplainedDelta: 21,
    errors: [],
  }];

  const assessment = assessFavoriteSyncCompleteness(diagnostics);

  assert.equal(assessment.complete, false);
  assert.match(assessment.reason ?? '', /FAVORITE_SYNC_INCOMPLETE/);
  assert.match(assessment.reason ?? '', /delta 21/);
});

test('incomplete favorite sync upserts fetched items without snapshot replacement', async () => {
  const calls: string[] = [];
  const item = makeFavoriteItem(1);
  const diagnostic = makeIncompleteDiagnostic();

  const result = await persistFavoriteSyncData(
    {
      complete: false,
      folders: [{ ...folder, mediaCount: 158 }],
      items: [item],
      diagnostics: [diagnostic],
    },
    {
      async replaceFavoriteSnapshot() {
        calls.push('replace');
        return 0;
      },
      async updateFavoriteFolderSyncDiagnostics(folders, diagnostics) {
        calls.push('diagnostics');
        assert.equal(folders[0].lastSyncDiagnostic?.unexplainedDelta, 21);
        assert.equal(diagnostics[0].mediaId, 100);
      },
      async upsertFavoriteItems(items) {
        calls.push('upsert-items');
        assert.deepEqual(items.map(saved => saved.itemKey), [item.itemKey]);
        return items.length;
      },
    },
  );

  assert.deepEqual(calls, ['diagnostics', 'upsert-items']);
  assert.equal(result.destructiveReplacement, false);
  assert.equal(result.insertedOrUpdated, 1);
});

function makeVideos(count: number, offset: number): FavoriteResourceApiItem[] {
  return Array.from({ length: count }, (_, index) => makeVideo(offset + index + 1));
}

function makeVideo(id: number): FavoriteResourceApiItem {
  return {
    id,
    avid: id,
    bvid: `BV${id}`,
    title: `Video ${id}`,
    type: 2,
    upper: { mid: id, name: `UP ${id}` },
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
    syncedAt: 0,
  };
}

function makeIncompleteDiagnostic(): FavoriteFolderSyncDiagnostic {
  return {
    mediaId: 100,
    title: 'Default',
    reportedMediaCount: 158,
    pagesFetched: 7,
    rawResourcesSeen: 137,
    storedVideoItems: 137,
    filteredUnavailableItems: 0,
    filteredMissingIdItems: 0,
    filteredNonVideoItems: 0,
    filteredItems: 0,
    hasMoreAfterStop: false,
    stoppedByMaxPages: false,
    unexplainedDelta: 21,
    errors: [],
  };
}
