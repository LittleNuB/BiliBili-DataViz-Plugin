import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCurrentVideoPrimaryTextAuthorization,
} from '../src/shared/current-video-primary-text-selection.ts';

const identity = {
  bvid: 'BV1Authorization',
  cid: 2001,
  page: 1,
};
const partKey = 'BV1Authorization:2001:1';

test('saved exact source stays authoritative when the currently available source changed', () => {
  const authorization = resolveCurrentVideoPrimaryTextAuthorization({
    readStatus: 'ready',
    identity,
    selections: { [partKey]: 'saved-source-v1' },
    availableSourceIdentityKeys: ['active-source-v2'],
  });

  assert.equal(authorization.ready, true);
  assert.equal(authorization.source, 'saved');
  assert.deepEqual(authorization.params, {
    primaryTextSelectionsReady: true,
    selectedSourceIdentityKey: 'saved-source-v1',
  });
});

test('one actual source is authorized exactly when no source was saved', () => {
  const authorization = resolveCurrentVideoPrimaryTextAuthorization({
    readStatus: 'ready',
    identity,
    selections: {},
    availableSourceIdentityKeys: ['only-active-source'],
  });

  assert.equal(authorization.ready, true);
  assert.equal(authorization.source, 'single_available');
  assert.deepEqual(authorization.params, {
    primaryTextSelectionsReady: true,
    selectedSourceIdentityKey: 'only-active-source',
  });
});

test('storage failure and incomplete identity fail closed with natural messages', async (t) => {
  await t.test('read failed', () => {
    const authorization = resolveCurrentVideoPrimaryTextAuthorization({
      readStatus: 'failed',
      identity,
      selections: {},
      availableSourceIdentityKeys: ['active-source-v2'],
    });

    assert.equal(authorization.ready, false);
    assert.deepEqual(authorization.params, { primaryTextSelectionsReady: false });
    assert.match(authorization.message ?? '', /读取失败/);
    assert.doesNotMatch(authorization.message ?? '', /Error|PRIMARY_TEXT|storage/i);
  });

  await t.test('identity missing', () => {
    const authorization = resolveCurrentVideoPrimaryTextAuthorization({
      readStatus: 'ready',
      identity: { ...identity, cid: null },
      selections: {},
      availableSourceIdentityKeys: ['active-source-v2'],
    });

    assert.equal(authorization.ready, false);
    assert.deepEqual(authorization.params, { primaryTextSelectionsReady: false });
    assert.match(authorization.message ?? '', /身份信息不完整/);
  });
});

test('saving and ambiguous unsaved sources remain blocked', async (t) => {
  await t.test('save pending', () => {
    const authorization = resolveCurrentVideoPrimaryTextAuthorization({
      readStatus: 'saving',
      identity,
      selections: { [partKey]: 'old-source' },
      availableSourceIdentityKeys: ['new-source'],
    });
    assert.equal(authorization.ready, false);
    assert.match(authorization.message ?? '', /正在保存/);
  });

  await t.test('multiple sources without a saved choice', () => {
    const authorization = resolveCurrentVideoPrimaryTextAuthorization({
      readStatus: 'ready',
      identity,
      selections: {},
      availableSourceIdentityKeys: ['source-one', 'source-two'],
    });
    assert.equal(authorization.ready, false);
    assert.match(authorization.message ?? '', /多个文本来源/);
  });
});
