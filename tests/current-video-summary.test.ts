import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAssistantPayloadAudit,
  auditAssistantPayload,
  currentVideoSummaryPayloadContract,
} from '../src/shared/assistant-payload-audit.ts';
import {
  buildCurrentVideoSummaryAiPayload,
  buildLocalCurrentVideoSummary,
  cancelledCurrentVideoSummary,
  loadingCurrentVideoSummary,
} from '../src/shared/current-video-summary.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';

test('builds metadata-only summary without treating missing description as content text', () => {
  const summary = buildLocalCurrentVideoSummary(videoContext({
    descriptionText: null,
    descriptionAvailable: false,
  }));

  assert.equal(summary.status, 'ready');
  assert.equal(summary.sourceTierLabel, '元数据摘要');
  assert.equal(summary.confidence, 'low');
  assert.match(summary.summary, /^仅基于可见元数据/);
  assert.ok(summary.missingSources.includes('简介'));
  assert.ok(summary.missingSources.includes('字幕'));
  assert.ok(summary.missingSources.includes('正文文本'));
  assert.ok(summary.limitations.some(item => item.includes('不是完整视频总结')));
});

test('builds description summary while keeping contentText unavailable', () => {
  const context = videoContext({
    descriptionText: 'This description explains the visible topic, structure, and intended audience for the upload.',
    descriptionAvailable: true,
  });
  const summary = buildLocalCurrentVideoSummary(context);

  assert.equal(summary.sourceTierLabel, '简介摘要');
  assert.equal(summary.confidence, 'medium');
  assert.ok(summary.evidence.some(item => item.source === 'description'));
  assert.equal(context.sources.contentText, 'unavailable');
  assert.ok(summary.limitations.some(item => item.includes('简介不会被当作正文内容')));
});

test('marks AI disabled fallback without changing source tier', () => {
  const summary = buildLocalCurrentVideoSummary(videoContext({}), {
    aiStatus: 'disabled',
    aiModel: 'test-model',
  });

  assert.equal(summary.generationMode, 'local_fallback');
  assert.equal(summary.ai.status, 'disabled');
  assert.equal(summary.sourceTierLabel, '简介摘要');
});

test('marks AI not configured fallback', () => {
  const summary = buildLocalCurrentVideoSummary(videoContext({}), {
    aiStatus: 'not_configured',
    aiModel: 'test-model',
  });

  assert.equal(summary.generationMode, 'local_fallback');
  assert.equal(summary.ai.status, 'not_configured');
});

test('marks AI failed fallback with error', () => {
  const summary = buildLocalCurrentVideoSummary(videoContext({}), {
    aiStatus: 'failed',
    aiModel: 'test-model',
    aiError: 'AI_REQUEST_FAILED_TEST',
  });

  assert.equal(summary.generationMode, 'local_fallback');
  assert.equal(summary.ai.status, 'failed');
  assert.equal(summary.ai.error, 'AI_REQUEST_FAILED_TEST');
});

test('marks low-confidence AI fallback', () => {
  const summary = buildLocalCurrentVideoSummary(videoContext({}), {
    aiStatus: 'low_confidence',
    aiModel: 'test-model',
  });

  assert.equal(summary.generationMode, 'local_fallback');
  assert.equal(summary.ai.status, 'low_confidence');
});

test('builds bounded AI payload without authorMid or local ledgers', () => {
  const context = videoContext({
    descriptionText: 'A'.repeat(2000),
    descriptionAvailable: true,
  });
  const payload = buildCurrentVideoSummaryAiPayload(context);
  const audit = auditAssistantPayload(payload, currentVideoSummaryPayloadContract);
  const rawPayload = JSON.stringify(payload);

  assert.equal(payload.video.description.text?.length, 1200);
  assert.equal('authorMid' in payload.video, false);
  assert.equal(payload.availableSources.contentText, 'unavailable');
  assert.doesNotMatch(rawPayload, /authorMid|watchHistory|favorites|following|Cookie|Key\.txt|user profile/i);
  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assertAssistantPayloadAudit(payload, currentVideoSummaryPayloadContract);
});

test('current video AI payload audit reports sensitive fields and tokens', () => {
  const payload = buildCurrentVideoSummaryAiPayload(videoContext({}));
  const badPayload = {
    ...payload,
    watchHistory: [{ bvid: 'BVHistoryLeak', watchedAt: 1000 }],
    localContext: {
      userMid: 42,
    },
    video: {
      ...payload.video,
      authorMid: 12345,
    },
    safetyRules: [
      ...payload.safetyRules,
      'Never send Cookie: SESSDATA=abc or C:\\Users\\LittleNub\\Desktop\\Key.txt.',
    ],
  };
  const audit = auditAssistantPayload(badPayload, currentVideoSummaryPayloadContract);
  const report = audit.violations.map(violation => `${violation.path} ${violation.token ?? ''}`).join('\n');

  assert.equal(audit.passed, false);
  assert.match(report, /\$\.watchHistory/);
  assert.match(report, /\$\.localContext\.userMid/);
  assert.match(report, /\$\.video\.authorMid/);
  assert.match(report, /Cookie\/login token/);
  assert.match(report, /C:\\Users\\LittleNub\\Desktop\\Key\.txt/);
  assert.throws(
    () => assertAssistantPayloadAudit(badPayload, currentVideoSummaryPayloadContract),
    /\$\.video\.authorMid/,
  );
});

test('exposes loading and cancelled states without accepting an AI result', () => {
  const loading = loadingCurrentVideoSummary(100);
  const cancelled = cancelledCurrentVideoSummary(videoContext({}), 200);

  assert.equal(loading.status, 'loading');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.generationMode, 'local_fallback');
  assert.equal(cancelled.ai.status, 'not_requested');
});

function videoContext(options: {
  descriptionText?: string | null;
  descriptionAvailable?: boolean;
}): CurrentVideoContext {
  const descriptionText = options.descriptionText ?? 'A visible description for the current video.';
  const descriptionAvailable = options.descriptionAvailable ?? true;
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Summary000',
    collectedAt: 1000,
    bvid: 'BV1Summary000',
    cid: 100,
    title: 'Current Video Title',
    authorName: 'Current UP',
    authorMid: 12345,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: 'Main part',
      total: 1,
    },
    parts: [
      { page: 1, cid: 100, title: 'Main part', durationSeconds: 600 },
    ],
    chapters: [],
    description: {
      availability: descriptionAvailable ? 'available' : 'unavailable',
      text: descriptionAvailable ? descriptionText : null,
      length: descriptionAvailable ? descriptionText?.length ?? null : null,
    },
    sources: {
      metadata: 'available',
      description: descriptionAvailable ? 'available' : 'unavailable',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'unavailable',
      contentText: 'unavailable',
    },
    warnings: descriptionAvailable
      ? ['transcript_unavailable']
      : ['description_unavailable', 'transcript_unavailable'],
  };
}
