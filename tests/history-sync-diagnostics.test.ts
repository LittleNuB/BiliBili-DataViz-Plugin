import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWatchSessionKey } from '../src/shared/utils/session-key.ts';
import { classifyHistoryPageStop, normalizeHistoryPageLimit } from '../src/shared/history-sync-core.ts';

test('full sync continues across non-terminal pages', () => {
  const stop = classifyHistoryPageStop({
    mode: 'full',
    listCount: 30,
    firstStored: false,
    lastStored: false,
    newItemsCount: 30,
    cursor: {
      max: 123,
      view_at: 1_717_000_000,
      business: 'archive',
      has_more: true,
    },
  });

  assert.equal(stop.stoppedReason, null);
  assert.equal(stop.reachedEnd, false);
});

test('empty page with has_more cursor is not treated as full completion', () => {
  const stop = classifyHistoryPageStop({
    mode: 'full',
    listCount: 0,
    firstStored: false,
    lastStored: false,
    newItemsCount: 0,
    cursor: {
      max: 456,
      view_at: 1_716_000_000,
      business: 'archive',
      has_more: true,
    },
  });

  assert.equal(stop.stoppedReason, 'empty_page_cursor_anomaly');
  assert.equal(stop.reachedEnd, false);
});

test('requested 9000-row equivalent still normalizes to 300 pages', () => {
  assert.equal(normalizeHistoryPageLimit(300), 300);
});

test('similar records on different dates produce distinct dedup session keys', () => {
  const keyA = buildWatchSessionKey(0, 1_717_000_000, 'BV1abc', 42);
  const keyB = buildWatchSessionKey(0, 1_717_086_400, 'BV1abc', 42);

  assert.notEqual(keyA, keyB);
});
