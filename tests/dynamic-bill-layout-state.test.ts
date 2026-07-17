import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseDynamicBillSelectedKey,
  resolveDynamicBillLayoutState,
} from '../dashboard/modules/dynamic-bill/layout-state.ts';
import type {
  DynamicBillColumn,
  DynamicBillItem,
  DynamicBillStatus,
} from '../src/shared/types/dynamic-bill.ts';

test('layout state uses one global empty branch when no item is visible', () => {
  const empty = resolveDynamicBillLayoutState([], 'active', '');
  assert.equal(empty.allColumnsEmpty, true);
  assert.equal(empty.selectedItem, null);
  assert.deepEqual(empty.visibleItems, []);

  const activeEmpty = resolveDynamicBillLayoutState([
    item('consumed-card', 'buried_follow', 'consumed'),
    item('processed-card', 'favorite_related', 'processed'),
  ], 'active', 'consumed-card');

  assert.equal(activeEmpty.allColumnsEmpty, true);
  assert.equal(activeEmpty.selectedItem, null);
  assert.deepEqual(activeEmpty.visibleItems, []);
});

test('layout state keeps the board branch for one-empty and two-empty column scenarios', () => {
  const oneEmpty = resolveDynamicBillLayoutState([
    item('buried-card', 'buried_follow', 'unopened'),
    item('rotation-card', 'follow_rotation', 'opened'),
  ], 'active', 'rotation-card');
  assert.equal(oneEmpty.allColumnsEmpty, false);
  assert.equal(oneEmpty.visibleItems.length, 2);
  assert.equal(oneEmpty.selectedItem?.billKey, 'rotation-card');

  const twoEmpty = resolveDynamicBillLayoutState([
    item('favorite-card', 'favorite_related', 'unopened'),
  ], 'active', '');
  assert.equal(twoEmpty.allColumnsEmpty, false);
  assert.equal(twoEmpty.visibleItems.length, 1);
  assert.equal(twoEmpty.selectedItem?.billKey, 'favorite-card');
});

test('selected bill key follows the current visible filter', () => {
  const items = [
    item('opened-card', 'buried_follow', 'opened'),
    item('processed-card', 'favorite_related', 'processed'),
  ];

  assert.equal(chooseDynamicBillSelectedKey('opened-card', items, 'active'), 'opened-card');
  assert.equal(chooseDynamicBillSelectedKey('processed-card', items, 'active'), 'opened-card');
  assert.equal(chooseDynamicBillSelectedKey('', items, 'processed'), 'processed-card');
});

function item(
  billKey: string,
  column: DynamicBillColumn,
  status: DynamicBillStatus,
): DynamicBillItem {
  return {
    billKey,
    column,
    status,
    updateKey: `${billKey}:update`,
    creatorMid: 1,
    creatorName: '示例 UP',
    creatorFace: '',
    historyBvids: [],
    evidence: {
      kind: column,
      longWindow: windowEvidence(),
      recentWindow: windowEvidence(),
      newVideo: {
        updateKey: `${billKey}:update`,
        dynamicId: `${billKey}:dynamic`,
        bvid: `BV1${billKey.replace(/[^A-Za-z0-9]/g, '').padEnd(10, '0')}`,
        avid: 1,
        title: '匿名示例视频',
        cover: '',
        duration: 120,
        pubtime: 0,
        dynamicTime: 0,
        tagName: '知识',
        tags: [],
      },
      follow: {
        followAgeKnown: false,
      },
      cooldownRatio: 0,
      daysSinceLastWatch: null,
      facts: [],
      thresholds: {
        longWindowDays: 180,
        recentWindowDays: 30,
        updateWindowDays: 7,
        positiveCompletionRate: 0.4,
        minPositiveWatchSeconds: 180,
        minBuriedFollowAgeDays: 180,
        minObservedFollowDays: 30,
        minBuriedWeakWatchCount: 1,
        maxBuriedRecentWatchCount: 1,
        maxBuriedRecentPositiveWatchCount: 0,
        maxItemsPerColumn: 5,
        maxItemsTotal: 15,
      },
    },
    localRank: 1,
    score: 1,
    generatedAt: 0,
  };
}

function windowEvidence() {
  return {
    windowDays: 30,
    startedAt: 0,
    endedAt: 0,
    watchedCount: 0,
    positiveWatchCount: 0,
    totalWatchTimeSeconds: 0,
    avgCompletion: 0,
    lastWatchedAt: 0,
  };
}
