import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasActiveHistoryDataOperation,
  runHistoryClearDataOperation,
  runHistorySyncDataOperation,
} from '../src/background/sync/sync-control.ts';

test('history sync cannot start while local data clear owns the shared operation gate', async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  let syncRan = false;
  const clearing = runHistoryClearDataOperation(async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;

  try {
    assert.equal(hasActiveHistoryDataOperation(), true);
    await assert.rejects(
      runHistorySyncDataOperation(async () => {
        syncRan = true;
      }),
      /HISTORY_SYNC_IN_PROGRESS/,
    );
    assert.equal(syncRan, false);
  } finally {
    release.resolve();
    await clearing;
  }

  assert.equal(hasActiveHistoryDataOperation(), false);
});

test('local data clear cannot start while history sync owns the shared operation gate', async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  let clearRan = false;
  const syncing = runHistorySyncDataOperation(async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;

  try {
    await assert.rejects(
      runHistoryClearDataOperation(async () => {
        clearRan = true;
      }),
      /HISTORY_SYNC_IN_PROGRESS/,
    );
    assert.equal(clearRan, false);
  } finally {
    release.resolve();
    await syncing;
  }

  assert.equal(hasActiveHistoryDataOperation(), false);
});

test('history data operation gate is released after a failed operation', async () => {
  await assert.rejects(
    runHistorySyncDataOperation(async () => {
      throw new Error('synthetic sync failure');
    }),
    /synthetic sync failure/,
  );
  await runHistoryClearDataOperation(async () => undefined);
  assert.equal(hasActiveHistoryDataOperation(), false);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
