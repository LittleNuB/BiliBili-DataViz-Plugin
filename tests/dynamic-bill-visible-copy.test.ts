import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DYNAMIC_BILL_FAILURE_SURFACES,
  dynamicBillFailureCopy,
  explanationStateCopy,
} from '../dashboard/modules/dynamic-bill/failure-copy.ts';
import { DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE } from '../src/background/dynamic-bill/strategy.ts';

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
