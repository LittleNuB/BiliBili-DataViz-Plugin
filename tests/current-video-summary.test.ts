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
import { generateCurrentVideoSummary } from '../src/background/current-video-summary.ts';
import type { UserConfig } from '../src/shared/types/config.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type { CurrentVideoTranscriptEvidenceStatus, CurrentVideoTranscriptSegment } from '../src/shared/types/current-video-transcript.ts';

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
  assert.ok(summary.limitations.some(item => item.includes('没有可引用的本地字幕正文片段')));
  assert.doesNotMatch(JSON.stringify(payload), /subtitleProbe|track|aisubtitle|subtitle_url/i);
});

test('does not use active transcript cache without supplied evidence segments', () => {
  const context = videoContext({
    descriptionText: 'This description is still the only text supplied to the summary payload.',
    descriptionAvailable: true,
  });
  withTranscriptEvidence(context);

  const summary = buildLocalCurrentVideoSummary(context);
  const payload = buildCurrentVideoSummaryAiPayload(context);
  const rawPayload = JSON.stringify(payload);

  assert.equal(summary.sourceTier, 'description_summary');
  assert.equal(payload.availableSources.transcript, 'available');
  assert.equal(payload.availableSources.contentText, 'unavailable');
  assert.ok(summary.evidence.some(item => item.label === '字幕正文证据缓存'));
  assert.ok(summary.limitations.some(item => item.includes('没有拿到可引用字幕片段')));
  assert.doesNotMatch(rawPayload, /sourceHash|segmentId|已缓存字幕正文证据|SECRET TRANSCRIPT|watchHistory|Cookie|Key\.txt/i);
});

test('builds transcript-grounded local summary from supplied cached segments', () => {
  const context = withTranscriptEvidence(videoContext({
    descriptionText: 'Metadata description should only be supporting background.',
    descriptionAvailable: true,
  }));
  const summary = buildLocalCurrentVideoSummary(context, {
    transcriptSegments: transcriptSegments(),
    now: 3000,
  });

  assert.equal(summary.status, 'ready');
  assert.equal(summary.sourceTier, 'transcript_summary');
  assert.equal(summary.sourceTierLabel, '字幕正文摘要');
  assert.equal(summary.confidence, 'medium');
  assert.equal(summary.timestampRanges.length > 0, true);
  assert.equal(summary.timestampRanges[0].label, '0:00-0:19');
  assert.ok(summary.summary.includes('字幕正文证据'));
  assert.ok(summary.bullets[0].includes('0:00-0:19'));
  assert.ok(summary.evidence.some(item =>
    item.source === 'transcript'
    && item.startSeconds === 0
    && item.endSeconds === 19
    && item.value.includes('first transcript point'),
  ));
  assert.ok(summary.limitations.some(item => item.includes('不会生成字幕证据之外的时间戳')));
  assert.equal(summary.missingSources.includes('字幕正文/正文文本'), false);
});

test('keeps stale mismatch empty and malformed transcript states on bounded fallback', () => {
  const statuses: CurrentVideoTranscriptEvidenceStatus[] = ['stale', 'language_mismatch', 'empty', 'malformed'];
  for (const status of statuses) {
    const context = videoContext({
      descriptionText: 'Description fallback remains available.',
      descriptionAvailable: true,
    });
    withTranscriptEvidence(context, {
      status,
      active: false,
      message: `状态 ${status} 不能作为当前字幕正文证据。`,
      warnings: [`transcript_${status}`],
    });
    const summary = buildLocalCurrentVideoSummary(context, {
      transcriptSegments: transcriptSegments(),
    });

    assert.equal(summary.sourceTier, 'description_summary');
    assert.equal(summary.timestampRanges.length, 0);
    assert.ok(summary.evidence.some(item => item.value.includes(`状态 ${status}`)));
    assert.ok(summary.limitations.some(item => item.includes('不是完整视频总结')));
  }
});

test('builds bounded transcript AI payload and passes privacy audit', () => {
  const context = withTranscriptEvidence(videoContext({
    descriptionText: 'Visible description may support the current-video transcript summary.',
    descriptionAvailable: true,
  }));
  const payload = buildCurrentVideoSummaryAiPayload(context, {
    transcriptSegments: transcriptSegments({ count: 36, longText: true }),
  });
  const rawPayload = JSON.stringify(payload);
  const audit = auditAssistantPayload(payload, currentVideoSummaryPayloadContract);

  assert.equal(payload.intent, 'current_video_transcript_summary_v1');
  assert.equal(payload.sourceTier, 'transcript summary');
  assert.equal(payload.availableSources.contentText, 'unavailable');
  assert.ok(payload.transcript.chunks.length <= 8);
  assert.ok(payload.transcript.chunks.every(chunk => chunk.text.length <= 900));
  assert.ok(payload.transcript.chunks[0].segments[0].segmentId.startsWith('transcript:'));
  assert.ok(payload.transcript.chunks[0].segments[0].text.includes('bounded transcript'));
  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assertAssistantPayloadAudit(payload, currentVideoSummaryPayloadContract);
  assert.doesNotMatch(rawPayload, /authorMid|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data|sourceHash/i);
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

test('AI disabled and not configured keep transcript local evidence summary', async () => {
  const context = withTranscriptEvidence(videoContext({}));
  const segments = transcriptSegments();
  const disabled = await generateCurrentVideoSummary(context, {
    config: userConfig({ aiSummariesEnabled: false, apiKey: 'test-key' }),
    transcriptSegments: segments,
    now: 4000,
  });
  const notConfigured = await generateCurrentVideoSummary(context, {
    config: userConfig({ aiSummariesEnabled: true, apiKey: '' }),
    transcriptSegments: segments,
    now: 4000,
  });

  assert.equal(disabled.sourceTier, 'transcript_summary');
  assert.equal(disabled.generationMode, 'local_fallback');
  assert.equal(disabled.ai.status, 'disabled');
  assert.equal(notConfigured.sourceTier, 'transcript_summary');
  assert.equal(notConfigured.ai.status, 'not_configured');
});

test('AI failed and low confidence keep transcript local evidence summary', async () => {
  const context = withTranscriptEvidence(videoContext({}));
  const failed = await generateCurrentVideoSummary(context, {
    config: userConfig({ aiSummariesEnabled: true, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: async () => {
      throw new Error('AI_TEST_FAILURE');
    },
    now: 5000,
  });
  const lowConfidence = await generateCurrentVideoSummary(context, {
    config: userConfig({ aiSummariesEnabled: true, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: async () => ({
      summary: 'AI low confidence answer',
      bullets: ['AI low confidence bullet'],
      confidence: 0.2,
    }),
    now: 5000,
  });

  assert.equal(failed.sourceTier, 'transcript_summary');
  assert.equal(failed.ai.status, 'failed');
  assert.equal(failed.summary.includes('字幕正文证据'), true);
  assert.equal(lowConfidence.sourceTier, 'transcript_summary');
  assert.equal(lowConfidence.ai.status, 'low_confidence');
  assert.equal(lowConfidence.generationMode, 'local_fallback');
});

test('rejects AI segment or timestamp references outside payload and keeps local transcript result', async () => {
  const context = withTranscriptEvidence(videoContext({}));
  const summary = await generateCurrentVideoSummary(context, {
    config: userConfig({ aiSummariesEnabled: true, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: async () => ({
      summary: 'AI tries to cite transcript:outside:segment at 9:59.',
      bullets: ['This should be rejected.'],
      confidence: 0.91,
    }),
    now: 6000,
  });

  assert.equal(summary.sourceTier, 'transcript_summary');
  assert.equal(summary.generationMode, 'local_fallback');
  assert.equal(summary.ai.status, 'invalid_output');
  assert.match(summary.ai.error ?? '', /AI_SEGMENT_OUT_OF_PAYLOAD|AI_TIMESTAMP_OUT_OF_PAYLOAD/);
  assert.ok(summary.evidence.some(item => item.source === 'transcript'));
});

test('accepts valid AI transcript summary without replacing local evidence ranges', async () => {
  const context = withTranscriptEvidence(videoContext({}));
  const summary = await generateCurrentVideoSummary(context, {
    config: userConfig({ aiSummariesEnabled: true, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: async () => ({
      summary: 'AI based on the supplied subtitle evidence around 0:00.',
      bullets: ['0:00 starts from the provided subtitle range.'],
      confidence: 0.78,
    }),
    now: 7000,
  });

  assert.equal(summary.sourceTier, 'transcript_summary');
  assert.equal(summary.generationMode, 'ai');
  assert.equal(summary.ai.status, 'generated');
  assert.equal(summary.timestampRanges[0].label, '0:00-0:19');
  assert.ok(summary.evidence.some(item => item.source === 'transcript'));
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

function withTranscriptEvidence(
  context: CurrentVideoContext,
  overrides: Partial<NonNullable<CurrentVideoContext['transcriptEvidence']>> = {},
): CurrentVideoContext {
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
    segmentCount: 4,
    staleSegmentCount: 0,
    coverageStartSeconds: 0,
    coverageEndSeconds: 18,
    fetchedAt: 2000,
    updatedAt: 2000,
    reason: 'transcript_segments_cached',
    message: '已缓存字幕正文证据，仅作为本地证据状态展示。',
    warnings: [],
    ...overrides,
  };
  return context;
}

function transcriptSegments(options: {
  count?: number;
  longText?: boolean;
} = {}): CurrentVideoTranscriptSegment[] {
  const count = options.count ?? 4;
  return Array.from({ length: count }, (_, index) => {
    const startSeconds = index * 5;
    const endSeconds = startSeconds + 4;
    const text = options.longText
      ? `bounded transcript segment ${index} `.repeat(36)
      : [
          'first transcript point introduces the problem',
          'second transcript point explains the method',
          'third transcript point compares the result',
          'fourth transcript point closes the conclusion',
        ][index] ?? `additional transcript point ${index}`;
    return {
      segmentId: `transcript:BV1Summary000:100:1:zh-cn:hash123:${index}`,
      bvid: 'BV1Summary000',
      cid: 100,
      page: 1,
      startSeconds,
      endSeconds,
      text,
      language: 'zh-CN',
      source: 'bilibili_subtitle',
      sourceType: 'bilibili_player_wbi_v2',
      sourceHash: 'hash123',
      stale: false,
      fetchedAt: 2000,
      updatedAt: 2000,
    };
  });
}

function userConfig(overrides: {
  aiSummariesEnabled: boolean;
  apiKey: string;
}): UserConfig {
  return {
    dailyWatchGoal: 60,
    weeklyWatchGoal: 420,
    overDependencyThreshold: 0.3,
    syncIntervalMinutes: 5,
    retentionDays: 90,
    showSidebar: true,
    theme: 'dark',
    ai: {
      baseURL: 'https://example.invalid',
      apiKey: overrides.apiKey,
      chatModel: 'test-model',
    },
    assistant: {
      aiSummariesEnabled: overrides.aiSummariesEnabled,
      smartFavoritesQaAiEnabled: false,
      currentVideoSegmentRerankAiEnabled: false,
    },
    dynamicBill: {
      aiExplanationsEnabled: false,
    },
  };
}
