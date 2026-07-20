import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import {
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
} from '../src/shared/current-video-primary-text-selection.ts';
import { LOCAL_DATA_CLEAR_CONFIRMATION } from '../src/shared/local-data-privacy.ts';

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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

const DB_NAME = 'BiliAnalyticsDB';
const KEY = CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY;
const storageData = new Map<string, unknown>();
let selectionSetStarted = deferred<void>();
let storageClearStarted = deferred<void>();
let storageRemoveStarted = deferred<void>();
let storageClearObserved = deferred<void>();
let waitSelectionSetForStorageClear = false;
let storageClearOvertookSelectionSet = false;
let holdStorageClear: Deferred<void> | null = null;
let holdStorageRemove: Deferred<void> | null = null;

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    storage: {
      local: {
        async get(keys?: string | string[] | Record<string, unknown> | null) {
          if (typeof keys === 'string') {
            return storageData.has(keys) ? { [keys]: structuredClone(storageData.get(keys)) } : {};
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys
                .filter(key => storageData.has(key))
                .map(key => [key, structuredClone(storageData.get(key))]),
            );
          }
          if (keys && typeof keys === 'object') {
            return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
              key,
              storageData.has(key) ? structuredClone(storageData.get(key)) : fallback,
            ]));
          }
          return Object.fromEntries(
            [...storageData.entries()].map(([key, value]) => [key, structuredClone(value)]),
          );
        },
        async set(values: Record<string, unknown>) {
          if (waitSelectionSetForStorageClear && KEY in values) {
            selectionSetStarted.resolve();
            storageClearOvertookSelectionSet = await Promise.race([
              storageClearObserved.promise.then(() => true),
              delay(750).then(() => false),
            ]);
          }
          for (const [key, value] of Object.entries(values)) {
            storageData.set(key, structuredClone(value));
          }
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) storageData.delete(key);
          storageRemoveStarted.resolve();
          await holdStorageRemove?.promise;
        },
        async clear() {
          storageData.clear();
          storageClearObserved.resolve();
          storageClearStarted.resolve();
          await holdStorageClear?.promise;
        },
      },
    },
  },
});

const { default: Dexie } = await import('dexie');
const { db } = await import('../src/background/storage/db.ts');
const { clearAllLocalData } = await import('../src/background/storage/local-data-privacy-repo.ts');
const { getRegisteredLocalDataCategories } = await import('../src/background/storage/local-data-category-registry.ts');
const { DYNAMIC_BILL_MIGRATION_VERSION } = await import('../src/background/dynamic-bill/strategy.ts');
const { getCurrentVideoTranscriptClearState } = await import(
  '../src/background/current-video-transcript-clear-epoch.ts'
);
const { getCurrentVideoSummaryHighlightsClearState } = await import(
  '../src/background/current-video-summary-highlights-clear-epoch.ts'
);
const {
  canUseCurrentVideoQaSessionWriteGuard,
  registerCurrentVideoQaSessionTurnWriteGuard,
  settleCurrentVideoQaSessionTurnWriteGuard,
} = await import('../src/background/storage/current-video-qa-session-repo.ts');
const { saveCurrentVideoPrimaryTextSelection } = await import(
  '../src/background/storage/current-video-primary-text-selection-store.ts'
);

test.beforeEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
  await db.open();
  await db.dynamicBillMigrations.put({
    version: DYNAMIC_BILL_MIGRATION_VERSION,
    completedAt: Date.now(),
  });
  storageData.clear();
  selectionSetStarted = deferred<void>();
  storageClearStarted = deferred<void>();
  storageRemoveStarted = deferred<void>();
  storageClearObserved = deferred<void>();
  waitSelectionSetForStorageClear = false;
  storageClearOvertookSelectionSet = false;
  holdStorageClear = null;
  holdStorageRemove = null;
});

test.after(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

test('clear all waits for an earlier selection save and removes its completed write', async () => {
  waitSelectionSetForStorageClear = true;
  const saving = saveSelection('BV1BeforeClear', 8101, 1, 'source-before-clear');
  await selectionSetStarted.promise;

  const clearing = clearAllLocalData(LOCAL_DATA_CLEAR_CONFIRMATION);
  await Promise.all([saving, clearing]);

  assert.equal(storageClearOvertookSelectionSet, false);
  assert.equal(storageData.has(KEY), false);
});

test('clear all rejects a selection save started while local settings clear is active', async () => {
  holdStorageRemove = deferred<void>();
  const clearing = clearAllLocalData(LOCAL_DATA_CLEAR_CONFIRMATION);
  await storageRemoveStarted.promise;

  try {
    await assert.rejects(
      saveSelection('BV1DuringClear', 8201, 1, 'source-during-clear'),
      /PRIMARY_TEXT_SELECTION_CLEAR_IN_PROGRESS/,
    );
  } finally {
    holdStorageRemove.resolve();
    await clearing;
  }

  assert.equal(storageData.has(KEY), false);
});

test('clear all keeps current-video write barriers active while an early category clear is waiting', async () => {
  holdStorageRemove = deferred<void>();
  const clearing = clearAllLocalData(LOCAL_DATA_CLEAR_CONFIRMATION);
  await storageRemoveStarted.promise;
  const guard = registerCurrentVideoQaSessionTurnWriteGuard({
    sessionId: 'session-during-clear',
    turnId: 'turn-during-clear',
    requestId: 'request-during-clear',
  });

  try {
    assert.equal(getCurrentVideoTranscriptClearState().clearing, true);
    assert.equal(getCurrentVideoSummaryHighlightsClearState().clearing, true);
    assert.equal(canUseCurrentVideoQaSessionWriteGuard('session-during-clear', guard), false);
  } finally {
    settleCurrentVideoQaSessionTurnWriteGuard(guard);
    holdStorageRemove.resolve();
    await clearing;
  }

  assert.equal(getCurrentVideoTranscriptClearState().clearing, false);
  assert.equal(getCurrentVideoSummaryHighlightsClearState().clearing, false);
});

test('local settings clear owns selection lifecycle and rejects writes during clear', async () => {
  storageData.set('userConfig', { assistant: {} });
  storageData.set(KEY, { 'BV1LocalSettings:8301:1': 'source-existing' });
  storageData.set('unrelatedCategoryState', { retained: true });
  const category = getRegisteredLocalDataCategories().find(item => item.id === 'localSettings');
  assert.ok(category);
  assert.equal((await category.collectUsage()).count, 2);

  holdStorageRemove = deferred<void>();
  const clearing = category.clear();
  await storageRemoveStarted.promise;
  try {
    await assert.rejects(
      saveSelection('BV1LocalSettings', 8302, 2, 'source-during-local-settings-clear'),
      /PRIMARY_TEXT_SELECTION_CLEAR_IN_PROGRESS/,
    );
  } finally {
    holdStorageRemove.resolve();
    await clearing;
  }

  assert.deepEqual(await category.readAfterClear(), {
    count: 0,
    usageBytes: 0,
    empty: true,
  });
  assert.deepEqual(storageData.get('unrelatedCategoryState'), { retained: true });
});

function saveSelection(
  bvid: string,
  cid: number,
  page: number,
  selectedSourceIdentityKey: string,
) {
  return saveCurrentVideoPrimaryTextSelection({
    bvid,
    cid,
    page,
    selectedSourceIdentityKey,
  });
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
