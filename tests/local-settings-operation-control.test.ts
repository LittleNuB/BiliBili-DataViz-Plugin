import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runLocalSettingsClearDataOperation,
  runLocalSettingsWriteOperation,
  tryRunLocalSettingsWriteOperation,
} from '../src/background/storage/local-settings-operation-control.ts';

test('local settings clear waits for a write that already started', async () => {
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const writing = runLocalSettingsWriteOperation(async () => {
    writeStarted.resolve();
    await releaseWrite.promise;
  });
  await writeStarted.promise;

  let clearRan = false;
  const clearing = runLocalSettingsClearDataOperation(async () => {
    clearRan = true;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(clearRan, false);

  releaseWrite.resolve();
  await writing;
  await clearing;
  assert.equal(clearRan, true);
});

test('local settings clear rejects strict writes and suppresses optional writes until release', async () => {
  const clearStarted = deferred<void>();
  const releaseClear = deferred<void>();
  const clearing = runLocalSettingsClearDataOperation(async () => {
    clearStarted.resolve();
    await releaseClear.promise;
  });
  await clearStarted.promise;

  let optionalWriteRan = false;
  const optionalWrite = await tryRunLocalSettingsWriteOperation(async () => {
    optionalWriteRan = true;
  });
  assert.equal(optionalWrite, false);
  assert.equal(optionalWriteRan, false);
  await assert.rejects(
    runLocalSettingsWriteOperation(async () => undefined),
    hasMessage('LOCAL_SETTINGS_CLEAR_IN_PROGRESS'),
  );

  releaseClear.resolve();
  await clearing;
  assert.equal(
    await tryRunLocalSettingsWriteOperation(async () => {
      optionalWriteRan = true;
    }),
    true,
  );
  assert.equal(optionalWriteRan, true);
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

function hasMessage(message: string): (error: unknown) => boolean {
  return error => error instanceof Error && error.message === message;
}
