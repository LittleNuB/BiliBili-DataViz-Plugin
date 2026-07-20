import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
      for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // Try the next TypeScript source shape.
        }
      }
      throw error;
    }
  },
});

const storageData = new Map<string, unknown>();
Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    storage: {
      local: {
        async get(keys?: string | string[] | null) {
          if (typeof keys === 'string') {
            return storageData.has(keys) ? { [keys]: storageData.get(keys) } : {};
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys.filter(key => storageData.has(key)).map(key => [key, storageData.get(key)]),
            );
          }
          return Object.fromEntries(storageData);
        },
        async set(values: Record<string, unknown>) {
          for (const [key, value] of Object.entries(values)) storageData.set(key, value);
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) storageData.delete(key);
        },
        async clear() {
          storageData.clear();
        },
      },
    },
  },
});

let fetchHandler: ((input: RequestInfo | URL) => Promise<Response>) | null = null;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: (input: RequestInfo | URL) => {
    if (!fetchHandler) return Promise.reject(new Error('TEST_NETWORK_SHOULD_NOT_RUN'));
    return fetchHandler(input);
  },
});

const { default: Dexie } = await import('dexie');
const { db } = await import('../src/background/storage/db.ts');
const favoriteRepo = await import('../src/background/storage/favorite-repo.ts');
const { syncFavorites } = await import('../src/background/favorites/sync.ts');
const { buildSmartFavoriteIndex } = await import('../src/background/favorites/smart.ts');
const localDataRepo = await import('../src/background/storage/local-data-privacy-repo.ts');

const DB_NAME = 'BiliAnalyticsDB';

test.beforeEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
  await db.open();
  storageData.clear();
  fetchHandler = null;
});

test.after(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

test('favorite clear waits for an in-flight sync and removes its completed snapshot', async () => {
  const navStarted = deferred<void>();
  const releaseNav = deferred<void>();
  fetchHandler = async input => {
    const url = input.toString();
    if (url.includes('/x/web-interface/nav')) {
      navStarted.resolve(undefined);
      await releaseNav.promise;
      return biliResponse({ isLogin: true, mid: 7001 });
    }
    if (url.includes('/x/v3/fav/folder/created/list-all')) {
      return biliResponse({
        count: 1,
        list: [{ id: 71, title: '测试收藏夹', media_count: 0 }],
      });
    }
    if (url.includes('/x/v3/fav/resource/list')) {
      return biliResponse({ medias: [], has_more: false });
    }
    throw new Error(`UNEXPECTED_TEST_REQUEST:${url}`);
  };

  const syncing = syncFavorites();
  await navStarted.promise;
  let clearSettled = false;
  const clearing = localDataRepo.clearLocalDataCategory('favorites').finally(() => {
    clearSettled = true;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(clearSettled, false);

  releaseNav.resolve(undefined);
  const syncResult = await syncing;
  const clearResult = await clearing;

  assert.equal(syncResult.status, 'complete');
  assert.equal(clearResult.status, 'completed');
  assert.deepEqual(await Promise.all([
    db.favoriteFolders.count(),
    db.favoriteItems.count(),
    db.smartFavoriteIndex.count(),
  ]), [0, 0, 0]);
});

test('favorite clear waits for an in-flight smart index and removes its completed write', async () => {
  const item = favoriteItem();
  await favoriteRepo.upsertFavoriteItems([item]);
  const indexStarted = deferred<void>();
  const releaseIndex = deferred<void>();
  const indexing = buildSmartFavoriteIndex(1, {}, {
    async createSmartIndex() {
      indexStarted.resolve(undefined);
      await releaseIndex.promise;
      return {
        path: ['知识'],
        summary: '测试摘要',
        keywords: ['测试'],
        aliases: [],
      };
    },
    getFavoriteItems: favoriteRepo.getFavoriteItems,
    getSmartFavoriteIndexMap: favoriteRepo.getSmartFavoriteIndexMap,
    async loadConfig() {
      return {
        ai: {
          baseURL: 'https://example.test',
          apiKey: 'fixture-key',
          chatModel: 'fixture-model',
        },
      };
    },
    putSmartFavoriteIndex: favoriteRepo.putSmartFavoriteIndex,
  });
  await indexStarted.promise;
  let clearSettled = false;
  const clearing = localDataRepo.clearLocalDataCategory('favorites').finally(() => {
    clearSettled = true;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(clearSettled, false);

  releaseIndex.resolve(undefined);
  const indexResult = await indexing;
  const clearResult = await clearing;

  assert.equal(indexResult.indexed, 1);
  assert.equal(clearResult.status, 'completed');
  assert.deepEqual(await Promise.all([
    db.favoriteItems.count(),
    db.smartFavoriteIndex.count(),
  ]), [0, 0]);
});

function biliResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, message: '0', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function favoriteItem() {
  return {
    itemKey: '71:BV1FAVORITEGATE',
    mediaId: 71,
    folderTitle: '测试收藏夹',
    avid: 71,
    bvid: 'BV1FAVORITEGATE',
    title: '测试收藏视频',
    intro: '',
    authorName: '测试 UP',
    authorMid: 71,
    tagName: '知识',
    tags: [],
    cover: '',
    duration: 60,
    pubtime: 1,
    favTime: 1,
    syncedAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
