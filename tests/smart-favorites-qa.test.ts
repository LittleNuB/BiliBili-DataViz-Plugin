import assert from 'node:assert/strict';
import test from 'node:test';
import type { FavoriteFolder, FavoriteFolderSyncDiagnostic, FavoriteItem, SmartFavoriteIndex } from '../src/shared/types/favorite.ts';
import { buildSmartFavoriteQaResponse } from '../src/background/favorites/qa-core.ts';

test('returns cited videos with source fields and evidence for local matches', () => {
  const item = makeFavoriteItem(1, {
    title: 'Kursk tank battle documentary',
    folderTitle: 'History',
    authorName: 'Archive UP',
    tagName: 'History',
  });
  const index = makeIndex(item, {
    path: ['Knowledge', 'History', 'WWII', 'Kursk'],
    keywords: ['Kursk', 'Eastern Front'],
    summary: 'A local metadata summary about the Battle of Kursk.',
  });

  const response = buildSmartFavoriteQaResponse({
    query: 'Kursk WWII',
    items: [item],
    indexes: new Map([[item.itemKey, index]]),
    folders: [makeFolder()],
  });

  assert.equal(response.answerType, 'retrieval_answer');
  assert.equal(response.citedVideos.length, 1);
  assert.equal(response.citedVideos[0].bvid, item.bvid);
  assert.equal(response.citedVideos[0].link, `https://www.bilibili.com/video/${item.bvid}`);
  assert.ok(response.citedVideos[0].sourceFields.includes('title'));
  assert.ok(response.citedVideos[0].sourceFields.includes('smart.keywords'));
  assert.match(response.citedVideos[0].evidence, /Matched/);
});

test('returns no_result without inventing citations', () => {
  const item = makeFavoriteItem(1, { title: 'Linear algebra notes' });

  const response = buildSmartFavoriteQaResponse({
    query: 'sourdough starter',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder()],
  });

  assert.equal(response.answerType, 'no_result');
  assert.equal(response.status.kind, 'no_result');
  assert.equal(response.citedVideos.length, 0);
  assert.match(response.evidenceSummary, /No local metadata/);
});

test('returns low-confidence candidates when evidence is weak', () => {
  const item = makeFavoriteItem(1, { tagName: 'Physics' });

  const response = buildSmartFavoriteQaResponse({
    query: 'physics',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder()],
  });

  assert.equal(response.answerType, 'candidate_list');
  assert.equal(response.confidence, 'low');
  assert.equal(response.citedVideos[0].confidence, 'low');
  assert.equal(response.citedVideos[0].sourceFields[0], 'tagName');
});

test('marks answers when the Smart Favorites index is stale', () => {
  const item = makeFavoriteItem(1, {
    title: 'Time management system',
    syncedAt: 2_000,
  });
  const index = makeIndex(item, {
    indexedAt: 1_000,
    keywords: ['time management'],
    path: ['Productivity'],
  });

  const response = buildSmartFavoriteQaResponse({
    query: 'time management',
    items: [item],
    indexes: new Map([[item.itemKey, index]]),
    folders: [makeFolder()],
  });

  assert.equal(response.status.kind, 'stale_index');
  assert.equal(response.status.indexCoverage.staleItems, 1);
  assert.match(response.status.notes.join(' '), /stale or partial/);
});

test('scopes answers to currently synced data when sync diagnostics are incomplete', () => {
  const item = makeFavoriteItem(1, { title: 'Creator workflow automation' });
  const folder = makeFolder({ lastSyncDiagnostic: makeIncompleteDiagnostic() });

  const response = buildSmartFavoriteQaResponse({
    query: 'creator workflow',
    items: [item],
    indexes: new Map(),
    folders: [folder],
  });

  assert.equal(response.status.kind, 'incomplete_sync');
  assert.equal(response.status.syncCoverage.complete, false);
  assert.equal(response.status.syncCoverage.problemFolders, 1);
  assert.match(response.answer, /currently synced/);
});

function makeFolder(overrides: Partial<FavoriteFolder> = {}): FavoriteFolder {
  return {
    mediaId: 100,
    title: 'Default',
    cover: '',
    intro: '',
    mediaCount: 1,
    createdAt: 0,
    updatedAt: 0,
    syncedAt: 1_000,
    ...overrides,
  };
}

function makeFavoriteItem(id: number, overrides: Partial<FavoriteItem> = {}): FavoriteItem {
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
    syncedAt: 1_000,
    ...overrides,
  };
}

function makeIndex(item: FavoriteItem, overrides: Partial<SmartFavoriteIndex> = {}): SmartFavoriteIndex {
  return {
    itemKey: item.itemKey,
    path: [],
    summary: '',
    keywords: [],
    aliases: [],
    searchableText: '',
    contentHash: 'hash',
    model: 'local-test',
    status: 'indexed',
    indexedAt: 1_000,
    ...overrides,
  };
}

function makeIncompleteDiagnostic(): FavoriteFolderSyncDiagnostic {
  return {
    mediaId: 100,
    title: 'Default',
    reportedMediaCount: 20,
    pagesFetched: 1,
    rawResourcesSeen: 10,
    storedVideoItems: 10,
    filteredUnavailableItems: 0,
    filteredMissingIdItems: 0,
    filteredNonVideoItems: 0,
    filteredItems: 0,
    hasMoreAfterStop: true,
    stoppedByMaxPages: false,
    unexplainedDelta: 10,
    errors: [],
  };
}
