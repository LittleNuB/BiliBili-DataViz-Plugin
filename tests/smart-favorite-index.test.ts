import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSmartFavoriteIndex } from '../src/background/favorites/smart.ts';
import type { FavoriteItem, SmartFavoriteIndex } from '../src/shared/types/favorite.ts';

test('repeated smart index generation rewrites an existing itemKey instead of crashing', async () => {
  const item = makeFavoriteItem('100:BV1');
  const writes: SmartFavoriteIndex[] = [];

  const result = await buildSmartFavoriteIndex(
    4,
    {},
    {
      async createSmartIndex() {
        return {
          path: ['知识', '历史'],
          summary: 'updated summary',
          keywords: ['kursk'],
          aliases: ['battle'],
        };
      },
      async getFavoriteItems() {
        return [item];
      },
      async getSmartFavoriteIndexMap() {
        return new Map([[
          item.itemKey,
          makeSmartIndex(item.itemKey, {
            status: 'failed',
            contentHash: 'stale-hash',
          }),
        ]]);
      },
      async loadConfig() {
        return {
          ai: {
            baseURL: 'https://example.com',
            apiKey: 'test-key',
            chatModel: 'test-model',
          },
        };
      },
      async putSmartFavoriteIndex(index) {
        writes.push(index);
        return { written: 1, notes: [] };
      },
    },
  );

  assert.equal(result.processed, 1);
  assert.equal(result.indexed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.notes, []);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.itemKey, item.itemKey);
  assert.equal(writes[0]?.status, 'indexed');
});

test('corrupt itemKey writes become skipped diagnostics instead of raw ConstraintError failures', async () => {
  const result = await buildSmartFavoriteIndex(
    4,
    {},
    {
      async createSmartIndex() {
        return {
          path: ['知识'],
          summary: 'summary',
          keywords: [],
          aliases: [],
        };
      },
      async getFavoriteItems() {
        return [makeFavoriteItem('   ')];
      },
      async getSmartFavoriteIndexMap() {
        return new Map();
      },
      async loadConfig() {
        return {
          ai: {
            baseURL: 'https://example.com',
            apiKey: 'test-key',
            chatModel: 'test-model',
          },
        };
      },
      async putSmartFavoriteIndex() {
        return {
          written: 0,
          notes: ['智能索引写入时跳过了 1 条缺少 itemKey 的异常索引记录。'],
        };
      },
    },
  );

  assert.equal(result.processed, 1);
  assert.equal(result.indexed, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 1);
  assert.match(result.notes.join(' '), /缺少 itemKey/);
});

function makeFavoriteItem(itemKey: string): FavoriteItem {
  return {
    itemKey,
    mediaId: 100,
    folderTitle: 'Folder 100',
    avid: 1,
    bvid: 'BV1',
    title: 'Video 1',
    intro: 'intro',
    authorName: 'UP 1',
    authorMid: 1,
    tagName: '知识',
    tags: ['历史'],
    cover: '',
    duration: 0,
    pubtime: 0,
    favTime: 1,
    syncedAt: 1,
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
