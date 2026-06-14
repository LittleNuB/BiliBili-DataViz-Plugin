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

test('keeps available subtitle source state separate from transcript summary', () => {
  const context = videoContext({
    descriptionText: 'This description is still the only text supplied to the summary payload.',
    descriptionAvailable: true,
  });
  context.sources.transcript = 'available';
  context.subtitleProbe = {
    status: 'available',
    available: true,
    checkedAt: 1000,
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
    sourceType: 'bilibili_player_wbi_v2',
    sourceDomain: 'api.bilibili.com',
    sourcePath: '/x/player/wbi/v2',
    trackCount: 1,
    segmentCount: null,
    coverageStartSeconds: null,
    coverageEndSeconds: null,
    languages: ['zh-CN'],
    tracks: [],
    reason: 'subtitle_tracks_available',
    message: '已探测到 1 条字幕轨道；本版本只记录来源状态，不缓存字幕正文，也不会据此生成完整视频总结。',
    warnings: ['transcript_source_available', 'transcript_text_not_cached'],
  };

  const summary = buildLocalCurrentVideoSummary(context);
  const payload = buildCurrentVideoSummaryAiPayload(context);

  assert.equal(summary.sourceTier, 'description_summary');
  assert.equal(payload.sourceTier, 'description summary');
  assert.equal(payload.availableSources.transcript, 'available');
  assert.equal(payload.availableSources.contentText, 'unavailable');
  assert.ok(summary.missingSources.includes('字幕正文/正文文本'));
  assert.ok(summary.limitations.some(item => item.includes('只记录来源状态')));
  assert.doesNotMatch(JSON.stringify(payload), /subtitleProbe|track|aisubtitle|subtitle_url/i);
});

test('keeps cached transcript evidence out of current video summary AI payload', () => {
  const context = videoContext({
    descriptionText: 'This description is still the only text supplied to the summary payload.',
    descriptionAvailable: true,
  });
  context.sources.transcript = 'available';
  context.transcriptEvidence = {
    status: 'cached',
    active: true,
    checkedAt: 2000,
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
    language: 'zh-CN',
    source: 'bilibili_subtitle',
    sourceType: 'bilibili_player_wbi_v2',
    sourceHash: 'hash123',
    segmentCount: 2,
    staleSegmentCount: 0,
    coverageStartSeconds: 0,
    coverageEndSeconds: 8,
    fetchedAt: 2000,
    updatedAt: 2000,
    reason: 'transcript_segments_cached',
    message: '已缓存字幕正文证据，仅作为本地证据状态展示。',
    warnings: [],
  };

  const summary = buildLocalCurrentVideoSummary(context);
  const payload = buildCurrentVideoSummaryAiPayload(context);
  const rawPayload = JSON.stringify(payload);

  assert.equal(summary.sourceTier, 'description_summary');
  assert.equal(payload.availableSources.transcript, 'available');
  assert.equal(payload.availableSources.contentText, 'unavailable');
  assert.ok(summary.evidence.some(item => item.label === '字幕正文证据缓存'));
  assert.ok(summary.limitations.some(item => item.includes('当前版本')));
  assert.doesNotMatch(rawPayload, /sourceHash|segmentId|已缓存字幕正文证据|SECRET TRANSCRIPT|watchHistory|Cookie|Key\.txt/i);
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
