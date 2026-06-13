import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareFavoriteFolderRows,
  prepareFavoriteItemRows,
  prepareSmartFavoriteIndexRows,
} from '../src/background/storage/favorite-write-prep.ts';
import type { FavoriteFolder, FavoriteItem, SmartFavoriteIndex } from '../src/shared/types/favorite.ts';

test('keeps the same video in different folders but dedupes duplicate itemKey rows within one sync batch', () => {
  const duplicate = makeFavoriteItem(100, 1, {
    title: 'Video 1 refreshed',
    intro: 'A longer intro for the merged record.',
    syncedAt: 99,
  });
  const prepared = prepareFavoriteItemRows([
    makeFavoriteItem(100, 1),
    duplicate,
    makeFavoriteItem(101, 1),
  ]);

  assert.equal(prepared.rows.length, 2);
  assert.deepEqual(
    prepared.rows.map(item => item.itemKey).sort(),
    ['100:BV1', '101:BV1'],
  );
  assert.equal(
    prepared.rows.find(item => item.itemKey === '100:BV1')?.title,
    'Video 1 refreshed',
  );
  assert.equal(
    prepared.rows.find(item => item.itemKey === '100:BV1')?.intro,
    'A longer intro for the merged record.',
  );
  assert.match(prepared.notes.join(' '), /重复收藏视频/);
});

test('dedupes repeated folder mediaId and keeps Chinese diagnostics', () => {
  const prepared = prepareFavoriteFolderRows([
    makeFavoriteFolder(100, { title: 'Old title', syncedAt: 1 }),
    makeFavoriteFolder(100, { title: 'New title', syncedAt: 2 }),
    { ...makeFavoriteFolder(0), mediaId: 0 },
  ]);

  assert.equal(prepared.rows.length, 1);
  assert.equal(prepared.rows[0]?.title, 'New title');
  assert.match(prepared.notes.join(' '), /重复收藏夹/);
  assert.match(prepared.notes.join(' '), /缺少 mediaId/);
});

test('skips corrupt smart index itemKey values instead of propagating raw uniqueness errors', () => {
  const prepared = prepareSmartFavoriteIndexRows([
    makeSmartIndex(''),
    makeSmartIndex('100:BV1', { summary: 'old' }),
    makeSmartIndex('100:BV1', { summary: 'new' }),
  ]);

  assert.equal(prepared.rows.length, 1);
  assert.equal(prepared.rows[0]?.summary, 'new');
  assert.match(prepared.notes.join(' '), /缺少 itemKey/);
  assert.match(prepared.notes.join(' '), /重复 itemKey/);
});

function makeFavoriteFolder(mediaId: number, overrides: Partial<FavoriteFolder> = {}): FavoriteFolder {
  return {
    mediaId,
    title: `Folder ${mediaId}`,
    cover: '',
    intro: '',
    mediaCount: 1,
    createdAt: 1,
    updatedAt: 1,
    syncedAt: 1,
    ...overrides,
  };
}

function makeFavoriteItem(mediaId: number, id: number, overrides: Partial<FavoriteItem> = {}): FavoriteItem {
  return {
    itemKey: `${mediaId}:BV${id}`,
    mediaId,
    folderTitle: `Folder ${mediaId}`,
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
    syncedAt: 1,
    ...overrides,
  };
}

function makeSmartIndex(itemKey: string, overrides: Partial<SmartFavoriteIndex> = {}): SmartFavoriteIndex {
  return {
    itemKey,
    path: ['知识'],
    summary: 'summary',
    keywords: ['keyword'],
    aliases: [],
    searchableText: 'summary keyword',
    contentHash: 'hash',
    model: 'test-model',
    status: 'indexed',
    indexedAt: 1,
    ...overrides,
  };
}
