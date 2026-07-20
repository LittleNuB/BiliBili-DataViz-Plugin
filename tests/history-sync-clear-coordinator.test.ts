import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasActiveHistoryDataOperation,
  runHistoryClearDataOperation,
  runHistoryPlayerEventDataOperation,
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

test('history clear waits for a player event write that already started', async () => {
  const eventStarted = deferred<void>();
  const releaseEvent = deferred<void>();
  const eventWrite = runHistoryPlayerEventDataOperation(async () => {
    eventStarted.resolve();
    await releaseEvent.promise;
  });
  await eventStarted.promise;

  let clearRan = false;
  const clearing = runHistoryClearDataOperation(async () => {
    clearRan = true;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(clearRan, false);

  releaseEvent.resolve();
  assert.equal(await eventWrite, true);
  await clearing;
  assert.equal(clearRan, true);
});

test('player event writes are suppressed for the full history clear window', async () => {
  const clearStarted = deferred<void>();
  const releaseClear = deferred<void>();
  const clearing = runHistoryClearDataOperation(async () => {
    clearStarted.resolve();
    await releaseClear.promise;
  });
  await clearStarted.promise;

  let eventRan = false;
  const written = await runHistoryPlayerEventDataOperation(async () => {
    eventRan = true;
  });
  assert.equal(written, false);
  assert.equal(eventRan, false);

  releaseClear.resolve();
  await clearing;
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
