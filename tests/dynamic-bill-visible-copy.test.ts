import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DYNAMIC_BILL_FAILURE_SURFACES,
  dynamicBillFailureCopy,
  explanationStateCopy,
} from '../dashboard/modules/dynamic-bill/failure-copy.ts';
import { planFixedDynamicBillItems } from '../src/background/dynamic-bill/planner.ts';
import { DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE } from '../src/background/dynamic-bill/strategy.ts';
import type {
  FollowedCreator,
  FollowedVideoUpdate,
} from '../src/shared/types/dynamic-bill.ts';

const RAW_ERROR = [
  'provider 401',
  'document is not defined',
  'fallback',
  'transcript',
  'confidence',
  'sourceHash',
  'segmentId',
  'subtitle_url',
].join(' ');

test('dynamic bill failure surfaces never expose provider or runtime error text', () => {
  const rawFailures: unknown[] = [
    new Error(RAW_ERROR),
    RAW_ERROR,
    { error: RAW_ERROR },
  ];

  for (const surface of DYNAMIC_BILL_FAILURE_SURFACES) {
    for (const failure of rawFailures) {
      const copy = dynamicBillFailureCopy(surface, failure);
      assert.match(copy, /[\u3400-\u9fff]/);
      assert.ok(copy.length <= 50, `${surface} copy is not bounded: ${copy}`);
      for (const token of RAW_ERROR.split(' ')) {
        assert.doesNotMatch(copy, new RegExp(token, 'i'));
      }
    }
  }
});

test('dynamic bill failure surfaces retain the unified migration error', () => {
  for (const surface of DYNAMIC_BILL_FAILURE_SURFACES) {
    assert.equal(
      dynamicBillFailureCopy(surface, new Error(DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE)),
      DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE,
    );
  }
});

test('failed explanation state uses bounded copy instead of its stored error', () => {
  const copy = explanationStateCopy({
    billKey: 'update:fixture',
    status: 'failed',
    summary: '本地说明',
    reason: '本地事实',
    viewingAngle: '本地角度',
    keywords: [],
    confidence: 0,
    model: 'fixture',
    generatedAt: 1,
    contentHash: 'fixture',
    error: RAW_ERROR,
  }, {
    enabled: true,
    configured: true,
    model: 'fixture',
  });

  assert.equal(copy, 'AI 解释生成失败；以下使用本地规则事实解释。');
  assert.doesNotMatch(copy, /provider|document|sourceHash|subtitle_url/i);
});

test('planner visible copy uses natural titles without exposing raw BVID', () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);
  const plan = planFixedDynamicBillItems({
    now,
    creators: [
      creator(now, 1),
      creator(now, 2),
    ],
    updates: [
      update(now, 1, 'titled', '这是一条有标题的新投稿', 'BV1VisibleTitle'),
      update(now, 2, 'untitled', '', 'BV1VisibleUntitled'),
    ],
    historyRecords: [],
    knownWatchedBvids: [],
    favoriteItems: [],
    rotationRecords: [],
    pausedCreatorMids: new Set(),
  });
  const visibleCopy = plan.items.flatMap(item => [
    item.evidence.newVideo.title || '视频标题暂缺',
    ...item.evidence.facts,
  ]).join('\n');

  assert.match(visibleCopy, /这是一条有标题的新投稿/);
  assert.match(visibleCopy, /视频标题暂缺/);
  assert.match(visibleCopy, /可用本地观看记录中未发现同一新视频。/);
  assert.doesNotMatch(visibleCopy, /BV1VisibleTitle|BV1VisibleUntitled|BVID/);
});

function creator(now: number, mid: number): FollowedCreator {
  return {
    mid,
    name: `UP ${mid}`,
    face: '',
    sign: '',
    followAgeKnown: false,
    special: false,
    attribute: 0,
    tagId: 0,
    isActive: true,
    firstSeenAt: now,
    syncedAt: now,
    lastSeenAt: now,
  };
}

function update(
  now: number,
  authorMid: number,
  key: string,
  title: string,
  bvid: string,
): FollowedVideoUpdate {
  const nowSeconds = Math.floor(now / 1000);
  return {
    updateKey: `visible-${authorMid}-${key}`,
    dynamicId: `dynamic-${authorMid}-${key}`,
    bvid,
    avid: authorMid,
    title,
    intro: '',
    cover: '',
    duration: 600,
    pubtime: nowSeconds - authorMid,
    dynamicTime: nowSeconds - authorMid,
    authorMid,
    authorName: `UP ${authorMid}`,
    authorFace: '',
    tagName: '知识',
    tags: ['测试'],
    syncedAt: now,
  };
}
