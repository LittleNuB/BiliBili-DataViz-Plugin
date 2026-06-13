import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHistoryTailProbePageDiagnostic,
  classifyHistoryTailProbeStop,
} from '../src/shared/history-tail-probe-core.ts';

test('classifies repeated cursor as a terminal probe stop', () => {
  const stop = classifyHistoryTailProbeStop({
    listCount: 30,
    repeatedCursor: true,
    cursor: {
      max: 777,
      view_at: 1_718_000_000,
      has_more: true,
    },
  });

  assert.equal(stop.stopReason, 'repeated_cursor');
  assert.equal(stop.reachedDeclaredEnd, false);
});

test('marks short non-terminal pages as anomalies without forcing a stop', () => {
  const page = buildHistoryTailProbePageDiagnostic({
    pageIndex: 2,
    list: [{ view_at: 1_718_000_000 }, { view_at: 1_717_900_000 }],
    requestedCursor: null,
    responseCursor: {
      max: 456,
      viewAt: 1_717_900_000,
      business: 'archive',
      hasMore: true,
    },
    repeatedCursor: false,
    pageSize: 30,
  });

  assert.equal(page.shortPageAnomaly, true);
  assert.equal(page.emptyPage, false);
  assert.equal(page.declaredEnd, false);
});

test('classifies empty non-terminal pages as cursor anomalies', () => {
  const stop = classifyHistoryTailProbeStop({
    listCount: 0,
    repeatedCursor: false,
    cursor: {
      max: 123,
      view_at: 1_717_000_000,
      has_more: true,
    },
  });

  assert.equal(stop.stopReason, 'empty_page_cursor_anomaly');
  assert.equal(stop.reachedDeclaredEnd, false);
});

test('classifies declared end cursors as terminal end', () => {
  const stop = classifyHistoryTailProbeStop({
    listCount: 30,
    repeatedCursor: false,
    cursor: {
      max: 0,
      view_at: 0,
      has_more: false,
    },
  });

  assert.equal(stop.stopReason, 'api_end');
  assert.equal(stop.reachedDeclaredEnd, true);
});
