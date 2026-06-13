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

test('food and lifestyle videos do not fall into 游戏 from broad entertainment hints alone', async () => {
  const item = makeFavoriteItem('200:BVFOOD', {
    folderTitle: '娱乐收藏',
    title: '美食探店，品尝活鱼馆菜品',
    intro: '探店记录，试吃招牌活鱼菜。',
    tagName: '娱乐',
    tags: ['美食', '探店'],
  });
  const writes = await buildIndexAndCollectWrites(item, {
    path: ['娱乐', '游戏'],
    summary: '这是一条美食探店视频，重点是菜品和餐厅体验。',
    keywords: ['美食', '探店', '菜品'],
    aliases: [],
  });

  assert.deepEqual(writes[0]?.path, ['娱乐', '生活']);
  assert.equal(writes[0]?.categoryEvidence?.kind, 'mixed');
  assert.match(writes[0]?.categoryEvidence?.summary ?? '', /美食|探店/);
  assert.doesNotMatch((writes[0]?.path ?? []).join('/'), /游戏/);
});

test('real game videos still enter 游戏 when direct evidence exists', async () => {
  const item = makeFavoriteItem('201:BVGAME', {
    folderTitle: '娱乐收藏',
    title: '原神 5.0 深渊配队攻略',
    intro: '这期聊原神深渊思路和实战技巧。',
    tagName: '游戏',
    tags: ['原神', '攻略', '游戏'],
  });
  const writes = await buildIndexAndCollectWrites(item, {
    path: ['娱乐', '游戏'],
    summary: '游戏攻略视频，围绕原神深渊配队展开。',
    keywords: ['原神', '游戏', '攻略'],
    aliases: ['配队'],
  });

  assert.deepEqual(writes[0]?.path, ['娱乐', '游戏']);
  assert.equal(writes[0]?.categoryEvidence?.downgraded, false);
  assert.match(writes[0]?.categoryEvidence?.summary ?? '', /游戏/);
});

test('ambiguous entertainment items downgrade to 待确认 with insufficient-evidence copy', async () => {
  const item = makeFavoriteItem('202:BVAMB', {
    folderTitle: '娱乐收藏',
    title: '这也太离谱了',
    intro: '一次普通分享。',
    tagName: '娱乐',
    tags: [],
  });
  const writes = await buildIndexAndCollectWrites(item, {
    path: ['娱乐', '游戏'],
    summary: '轻松内容分享。',
    keywords: [],
    aliases: [],
  });

  assert.deepEqual(writes[0]?.path, ['娱乐', '待确认']);
  assert.equal(writes[0]?.categoryEvidence?.kind, 'path_fallback');
  assert.match(writes[0]?.categoryEvidence?.summary ?? '', /证据不足，未放入具体子类|缺少.*直接证据/);
});

function makeFavoriteItem(itemKey: string, overrides: Partial<FavoriteItem> = {}): FavoriteItem {
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

async function buildIndexAndCollectWrites(item: FavoriteItem, aiResponse: {
  path?: unknown;
  summary?: unknown;
  keywords?: unknown;
  aliases?: unknown;
}): Promise<SmartFavoriteIndex[]> {
  const writes: SmartFavoriteIndex[] = [];
  const result = await buildSmartFavoriteIndex(
    4,
    {},
    {
      async createSmartIndex() {
        return aiResponse;
      },
      async getFavoriteItems() {
        return [item];
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
      async putSmartFavoriteIndex(index) {
        writes.push(index);
        return { written: 1, notes: [] };
      },
    },
  );

  assert.equal(result.processed, 1);
  assert.equal(result.indexed, 1);
  assert.equal(result.failed, 0);
  return writes;
}
