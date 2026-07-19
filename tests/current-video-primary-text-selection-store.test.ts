import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
  currentVideoPrimaryTextPartKey,
} from '../src/shared/current-video-primary-text-selection.ts';
import {
  saveCurrentVideoPrimaryTextSelection,
  type CurrentVideoPrimaryTextSelectionStorage,
} from '../src/background/storage/current-video-primary-text-selection-store.ts';

const KEY = CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY;

test('single-part save preserves selections for other video parts', async () => {
  const storage = new ControlledSelectionStorage({
    [KEY]: {
      'BV1SelectionA:101:1': 'source-a',
      'BV1SelectionB:202:2': 'source-b',
    },
  });

  const result = await saveCurrentVideoPrimaryTextSelection({
    bvid: 'BV1SelectionC',
    cid: 303,
    page: 3,
    selectedSourceIdentityKey: 'source-c',
  }, storage);

  assert.deepEqual(result.selections, {
    'BV1SelectionA:101:1': 'source-a',
    'BV1SelectionB:202:2': 'source-b',
    'BV1SelectionC:303:3': 'source-c',
  });
  assert.deepEqual(storage.selectionMap(), result.selections);
  assert.equal(storage.setCount, 1);
});

test('interleaved saves from two tabs retain both part updates', async () => {
  const storage = new ControlledSelectionStorage({
    [KEY]: { 'BV1Existing:404:1': 'source-existing' },
  }, 10);

  const [first, second] = await Promise.all([
    saveCurrentVideoPrimaryTextSelection({
      bvid: 'BV1TabOne',
      cid: 501,
      page: 1,
      selectedSourceIdentityKey: 'source-tab-one',
    }, storage),
    saveCurrentVideoPrimaryTextSelection({
      bvid: 'BV1TabTwo',
      cid: 502,
      page: 2,
      selectedSourceIdentityKey: 'source-tab-two',
    }, storage),
  ]);

  assert.equal(first.selectedSourceIdentityKey, 'source-tab-one');
  assert.equal(second.selectedSourceIdentityKey, 'source-tab-two');
  assert.deepEqual(storage.selectionMap(), {
    'BV1Existing:404:1': 'source-existing',
    'BV1TabOne:501:1': 'source-tab-one',
    'BV1TabTwo:502:2': 'source-tab-two',
  });
  assert.equal(storage.setCount, 2);
});

test('storage read failure never writes an unknown selection table', async () => {
  const storage = new ControlledSelectionStorage({
    [KEY]: { 'BV1Existing:601:1': 'source-existing' },
  });
  storage.rejectGetCalls.add(1);

  await assert.rejects(
    saveCurrentVideoPrimaryTextSelection({
      bvid: 'BV1Blocked',
      cid: 602,
      page: 1,
      selectedSourceIdentityKey: 'source-blocked',
    }, storage),
    /PRIMARY_TEXT_SELECTION_READ_FAILED/,
  );

  assert.equal(storage.setCount, 0);
  assert.deepEqual(storage.selectionMap(), {
    'BV1Existing:601:1': 'source-existing',
  });
});

test('set and readback failures do not report a selection as persisted', async (t) => {
  await t.test('set failure', async () => {
    const storage = new ControlledSelectionStorage({
      [KEY]: { 'BV1Existing:701:1': 'source-existing' },
    });
    storage.rejectSetCalls.add(1);

    await assert.rejects(
      saveCurrentVideoPrimaryTextSelection({
        bvid: 'BV1SetFailure',
        cid: 702,
        page: 1,
        selectedSourceIdentityKey: 'source-new',
      }, storage),
      /PRIMARY_TEXT_SELECTION_WRITE_FAILED/,
    );
    assert.equal(storage.getCount, 1);
    assert.equal(storage.setCount, 1);
  });

  await t.test('readback failure', async () => {
    const storage = new ControlledSelectionStorage({
      [KEY]: { 'BV1Existing:801:1': 'source-existing' },
    });
    storage.rejectGetCalls.add(2);

    await assert.rejects(
      saveCurrentVideoPrimaryTextSelection({
        bvid: 'BV1ReadbackFailure',
        cid: 802,
        page: 1,
        selectedSourceIdentityKey: 'source-new',
      }, storage),
      /PRIMARY_TEXT_SELECTION_READBACK_FAILED/,
    );
    assert.equal(storage.getCount, 2);
    assert.equal(storage.setCount, 1);
  });
});

test('part keys require complete current-video identity', () => {
  assert.equal(currentVideoPrimaryTextPartKey({ bvid: 'BV1PartKey', cid: 901, page: 2 }), 'BV1PartKey:901:2');
  assert.equal(currentVideoPrimaryTextPartKey({ bvid: 'BV1PartKey', cid: null, page: 2 }), null);
});

class ControlledSelectionStorage implements CurrentVideoPrimaryTextSelectionStorage {
  private values: Record<string, unknown>;
  private readonly delayMs: number;
  readonly rejectGetCalls = new Set<number>();
  readonly rejectSetCalls = new Set<number>();
  getCount = 0;
  setCount = 0;

  constructor(
    initial: Record<string, unknown>,
    delayMs = 0,
  ) {
    this.values = structuredClone(initial);
    this.delayMs = delayMs;
  }

  async get(key: string): Promise<Record<string, unknown>> {
    this.getCount += 1;
    const call = this.getCount;
    const snapshot = structuredClone(this.values[key]);
    await delay(this.delayMs);
    if (this.rejectGetCalls.has(call)) throw new Error(`get rejected ${call}`);
    return { [key]: snapshot };
  }

  async set(values: Record<string, unknown>): Promise<void> {
    this.setCount += 1;
    const call = this.setCount;
    await delay(this.delayMs);
    if (this.rejectSetCalls.has(call)) throw new Error(`set rejected ${call}`);
    this.values = { ...this.values, ...structuredClone(values) };
  }

  selectionMap(): Record<string, string> {
    return structuredClone((this.values[KEY] ?? {}) as Record<string, string>);
  }
}

function delay(ms: number): Promise<void> {
  return ms > 0
    ? new Promise(resolve => setTimeout(resolve, ms))
    : Promise.resolve();
}
