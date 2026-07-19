import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAssistantPayloadAudit,
  auditAssistantPayload,
  currentVideoSummaryHighlightsPayloadContract,
} from '../src/shared/assistant-payload-audit.ts';
import {
  buildCurrentVideoFullTextRequestEnvelope,
  buildCurrentVideoTextSourceIdentity,
} from '../src/shared/current-video-primary-text.ts';
import {
  buildCurrentVideoSummaryHighlightsAiPayload,
  cancelledCurrentVideoSummaryHighlights,
  readyCurrentVideoSummaryHighlights,
  requestSnapshotFromEnvelope,
  validateCurrentVideoSummaryHighlightsAiOutput,
} from '../src/shared/current-video-summary-highlights.ts';
import {
  cancelCurrentVideoSummaryHighlightsForSource,
  cancelCurrentVideoSummaryHighlightsRequest,
  generateCurrentVideoSummaryHighlights,
} from '../src/background/current-video-summary-highlights.ts';
import {
  buildCurrentVideoSummaryHighlightsCacheKey,
  clearCurrentVideoSummaryHighlightsCache,
  collectCurrentVideoSummaryHighlightsCacheUsage,
  getCurrentVideoSummaryHighlightsCache,
  putCurrentVideoSummaryHighlightsCache,
  readCurrentVideoSummaryHighlightsAfterClear,
  CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_BYTES,
  CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_RECORDS,
} from '../src/background/storage/current-video-summary-highlights-repo.ts';
import { db } from '../src/background/storage/db.ts';
import type { UserConfig } from '../src/shared/types/config.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type { CurrentVideoTranscriptSegment } from '../src/shared/types/current-video-transcript.ts';
import type { CurrentVideoSummaryHighlightsAiOutput } from '../src/shared/current-video-summary-highlights.ts';

test('validates all-or-nothing summary, key points, and highlight evidence ranges', () => {
  const envelope = fullTextEnvelope();
  const valid = validateCurrentVideoSummaryHighlightsAiOutput(validAiOutput(), envelope);

  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.result.summarySentences.length, 3);
  assert.equal(valid.result.keyPoints.length, 3);
  assert.equal(valid.result.highlights.length, 4);
  assert.deepEqual(valid.result.summarySentences[0].evidenceLineNumbers, [1, 2]);
  assert.equal(valid.result.highlights[0].timeRangeLabel, '0:00-0:09');

  const badReference = validateCurrentVideoSummaryHighlightsAiOutput({
    ...validAiOutput(),
    keyPoints: [
      { text: '错误要点引用了不存在的行。', evidenceLineNumbers: [99] },
      { text: '第二个要点。', evidenceLineNumbers: [2] },
      { text: '第三个要点。', evidenceLineNumbers: [3] },
    ],
  }, envelope);
  assert.deepEqual(badReference, { ok: false, reason: 'evidence_line_missing' });

  const badTime = validateCurrentVideoSummaryHighlightsAiOutput({
    ...validAiOutput(),
    highlights: [
      { title: '时间不匹配', description: '这个亮点没有覆盖引用行。', startSeconds: 50, endSeconds: 55, evidenceLineNumbers: [1] },
      { title: '第二亮点', description: '第二个亮点有效。', startSeconds: 10, endSeconds: 19, evidenceLineNumbers: [2] },
      { title: '第三亮点', description: '第三个亮点有效。', startSeconds: 20, endSeconds: 29, evidenceLineNumbers: [3] },
      { title: '第四亮点', description: '第四个亮点有效。', startSeconds: 30, endSeconds: 39, evidenceLineNumbers: [4] },
    ],
  }, envelope);
  assert.deepEqual(badTime, { ok: false, reason: 'highlight_evidence_time_mismatch' });
});

test('full-primary-text payload is audited and does not include unrelated local ledgers', () => {
  const payload = buildCurrentVideoSummaryHighlightsAiPayload(fullTextEnvelope());
  const raw = JSON.stringify(payload);
  const audit = auditAssistantPayload(payload, currentVideoSummaryHighlightsPayloadContract);

  assert.equal(payload.intent, 'current_video_summary_highlights_v1');
  assert.equal(payload.textLines.length, 6);
  assert.ok(raw.includes('完整正文第 1 行'));
  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assertAssistantPayloadAudit(payload, currentVideoSummaryHighlightsPayloadContract);
  assert.doesNotMatch(raw, /watchHistory|favoriteItems|followingList|feedbackRecords|Cookie|Key\.txt|Chrome\\User Data|sourceHash|segmentId|subtitle_url/i);
});

test('generation succeeds only after validation and writes exact-identity model cache', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const segments = transcriptSegments();
  let chatCalls = 0;
  const result = await generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: segments,
    chat: async () => {
      chatCalls += 1;
      return validAiOutput();
    },
    currentIdentity: { sourceIdentityKey: context.transcriptEvidence?.sourceIdentityKey ?? '' },
    now: 10_000,
  });

  assert.equal(chatCalls, 1);
  assert.equal(result.status, 'ready');
  assert.equal(result.summarySentences.length, 3);
  assert.equal(result.keyPoints.length, 3);
  assert.equal(result.highlights.length, 4);
  assert.equal(result.cacheHit, false);
  assert.ok(result.cacheKey);

  const cached = await getCurrentVideoSummaryHighlightsCache({
    identity: { sourceIdentityKey: context.transcriptEvidence?.sourceIdentityKey ?? '' },
    model: 'test-model',
  });
  assert.equal(cached?.result.highlights.length, 4);
  assert.equal(cached?.requestSnapshot.requestId, result.requestId);
  assert.equal(cached?.requestSnapshot.text.lines[0].lineNo, 1);
});

test('disabled, unconfigured, and invalid output do not call or replace cache', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const segments = transcriptSegments();
  let chatCalls = 0;

  const disabled = await generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: false, apiKey: 'test-key' }),
    transcriptSegments: segments,
    chat: async () => {
      chatCalls += 1;
      return validAiOutput();
    },
  });
  const unconfigured = await generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: '' }),
    transcriptSegments: segments,
    chat: async () => {
      chatCalls += 1;
      return validAiOutput();
    },
  });
  const invalid = await generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: segments,
    chat: async () => ({
      ...validAiOutput(),
      summarySentences: [{ text: '只有一句摘要。', evidenceLineNumbers: [1] }],
    }),
  });

  assert.equal(chatCalls, 0);
  assert.equal(disabled.ai.status, 'disabled');
  assert.equal(unconfigured.ai.status, 'not_configured');
  assert.equal(invalid.status, 'invalid_output');
  assert.equal((await collectCurrentVideoSummaryHighlightsCacheUsage()).count, 0);
});

test('replacement, cancellation, and clear reject late responses without partial writes', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const segments = transcriptSegments();

  const firstGate = deferredChat();
  const first = generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: segments,
    chat: firstGate.chat,
  });
  await firstGate.ready;
  const second = await generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: segments,
    chat: async () => validAiOutput({ suffix: '较新' }),
  });
  firstGate.resolve(validAiOutput({ suffix: '较旧' }));
  const firstResult = await first;
  assert.equal(second.status, 'ready');
  assert.equal(firstResult.status, 'cancelled');
  assert.equal((await collectCurrentVideoSummaryHighlightsCacheUsage()).count, 1);

  await resetSummaryCache();
  const cancelGate = deferredChat();
  const cancelRun = generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: segments,
    chat: cancelGate.chat,
  });
  const requestId = await cancelGate.requestId;
  cancelCurrentVideoSummaryHighlightsRequest(requestId);
  cancelGate.resolve(validAiOutput());
  assert.equal((await cancelRun).status, 'cancelled');
  assert.equal((await collectCurrentVideoSummaryHighlightsCacheUsage()).count, 0);

  const clearGate = deferredChat();
  const clearRun = generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: segments,
    chat: clearGate.chat,
  });
  await clearGate.ready;
  await clearCurrentVideoSummaryHighlightsCache();
  clearGate.resolve(validAiOutput());
  assert.equal((await clearRun).status, 'cancelled');
  assert.deepEqual(await readCurrentVideoSummaryHighlightsAfterClear(), {
    count: 0,
    usageBytes: 0,
    latestGeneratedAt: null,
    empty: true,
  });

  cancelCurrentVideoSummaryHighlightsForSource(context.transcriptEvidence?.sourceIdentityKey ?? '');
});

test('cache prunes by 50 records and 5 MB LRU, then reports clear readback', async () => {
  await resetSummaryCache();
  const envelope = fullTextEnvelope();
  for (let index = 0; index < CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_RECORDS + 3; index += 1) {
    await putCurrentVideoSummaryHighlightsCache(cacheRecord(envelope, {
      suffix: `r${index}`,
      model: `model-${index}`,
      lastAccessedAt: index + 1,
    }));
  }
  const usageByCount = await collectCurrentVideoSummaryHighlightsCacheUsage();
  assert.equal(usageByCount.count, CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_RECORDS);

  await resetSummaryCache();
  const largeMessage = '超大缓存'.repeat(160_000);
  for (let index = 0; index < 8; index += 1) {
    await putCurrentVideoSummaryHighlightsCache(cacheRecord(envelope, {
      suffix: `large-${index}`,
      model: `large-model-${index}`,
      message: largeMessage,
      lastAccessedAt: index + 1,
    }));
  }
  const usageBySize = await collectCurrentVideoSummaryHighlightsCacheUsage();
  assert.ok(usageBySize.usageBytes <= CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_BYTES);
  assert.ok(usageBySize.count < 8);

  const cleared = await clearCurrentVideoSummaryHighlightsCache();
  assert.equal(cleared.currentVideoSummaryHighlightParts, usageBySize.count);
  assert.equal((await readCurrentVideoSummaryHighlightsAfterClear()).empty, true);
});

function fullTextEnvelope() {
  const segments = transcriptSegments();
  return buildCurrentVideoFullTextRequestEnvelope({
    operation: 'summary_highlights',
    submittedAt: 10_000,
    model: 'test-model',
    video: {
      bvid: 'BV1SummaryHi',
      cid: 6101,
      page: 1,
      title: '摘要亮点测试视频',
      partTitle: '主视频',
      durationSeconds: 120,
    },
    source: 'bilibili_subtitle',
    sourceType: 'bilibili_player_wbi_v2',
    sourceLabel: 'B站字幕',
    language: 'zh-CN',
    lines: segments.map(segment => ({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    })),
  });
}

function validAiOutput(options: { suffix?: string } = {}): CurrentVideoSummaryHighlightsAiOutput {
  const suffix = options.suffix ? ` ${options.suffix}` : '';
  return {
    summarySentences: [
      { text: `视频先说明问题背景和约束。${suffix}`, evidenceLineNumbers: [1, 2] },
      { text: `随后讲解方法和执行步骤。${suffix}`, evidenceLineNumbers: [3, 4] },
      { text: `最后总结结果和后续行动。${suffix}`, evidenceLineNumbers: [5, 6] },
    ],
    keyPoints: [
      { text: `先明确主要问题。${suffix}`, evidenceLineNumbers: [1] },
      { text: `再拆解方法步骤。${suffix}`, evidenceLineNumbers: [3, 4] },
      { text: `最后给出结论。${suffix}`, evidenceLineNumbers: [6] },
    ],
    highlights: [
      { title: `问题提出${suffix}`, description: `开头集中说明要解决的问题。${suffix}`, startSeconds: 0, endSeconds: 9, evidenceLineNumbers: [1] },
      { title: `背景约束${suffix}`, description: `这一段补充限制条件。${suffix}`, startSeconds: 10, endSeconds: 19, evidenceLineNumbers: [2] },
      { title: `方法拆解${suffix}`, description: `中段按步骤解释方案。${suffix}`, startSeconds: 20, endSeconds: 39, evidenceLineNumbers: [3, 4] },
      { title: `结果收束${suffix}`, description: `结尾给出结论和行动。${suffix}`, startSeconds: 40, endSeconds: 59, evidenceLineNumbers: [5, 6] },
    ],
  };
}

function videoContext(): CurrentVideoContext {
  const segments = transcriptSegments();
  const identity = buildCurrentVideoTextSourceIdentity({
    bvid: 'BV1SummaryHi',
    cid: 6101,
    page: 1,
    source: 'bilibili_subtitle',
    sourceType: 'bilibili_player_wbi_v2',
    language: 'zh-CN',
    lines: segments,
  });
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1SummaryHi',
    collectedAt: 10_000,
    bvid: 'BV1SummaryHi',
    cid: 6101,
    title: '摘要亮点测试视频',
    authorName: 'Test UP',
    authorMid: 100,
    durationSeconds: 120,
    currentPart: { page: 1, title: '主视频', total: 1 },
    parts: [{ page: 1, cid: 6101, title: '主视频', durationSeconds: 120 }],
    chapters: [],
    description: { availability: 'available', text: '匿名测试简介。', length: 7 },
    sources: {
      metadata: 'available',
      description: 'available',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'available',
      contentText: 'available',
    },
    transcriptEvidence: {
      status: 'cached',
      active: true,
      checkedAt: 10_000,
      bvid: 'BV1SummaryHi',
      cid: 6101,
      page: 1,
      language: 'zh-CN',
      source: 'bilibili_subtitle',
      sourceType: 'bilibili_player_wbi_v2',
      sourceIdentityKey: identity.sourceIdentityKey,
      sourceHash: identity.sourceHash,
      bodyHash: identity.bodyHash,
      timelineHash: identity.timelineHash,
      segmentCount: segments.length,
      staleSegmentCount: 0,
      serializedBytes: 2048,
      coverageStartSeconds: 0,
      coverageEndSeconds: 59,
      fetchedAt: 10_000,
      updatedAt: 10_000,
      reason: 'cached',
      message: '已缓存当前正文。',
      warnings: [],
    },
    warnings: [],
  };
}

function transcriptSegments(): CurrentVideoTranscriptSegment[] {
  return Array.from({ length: 6 }, (_, index) => {
    const startSeconds = index * 10;
    return {
      segmentId: `summary-hi-${index}`,
      sourceIdentityKey: 'filled-by-identity',
      bvid: 'BV1SummaryHi',
      cid: 6101,
      page: 1,
      startSeconds,
      endSeconds: startSeconds + 9,
      text: `完整正文第 ${index + 1} 行，用于摘要亮点测试。`,
      language: 'zh-CN',
      source: 'bilibili_subtitle',
      sourceType: 'bilibili_player_wbi_v2',
      sourceHash: 'test-source',
      stale: false,
      fetchedAt: 10_000,
      updatedAt: 10_000,
    };
  });
}

function userConfig(options: { enabled: boolean; apiKey: string }): UserConfig {
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
      apiKey: options.apiKey,
      chatModel: 'test-model',
    },
    assistant: {
      currentVideoAiAssistantEnabled: options.enabled,
      smartFavoritesQaAiEnabled: false,
    },
    dynamicBill: {
      aiExplanationsEnabled: false,
    },
  };
}

function deferredChat() {
  let resolveOutput!: (value: CurrentVideoSummaryHighlightsAiOutput) => void;
  let resolveReady!: () => void;
  let resolveRequestId!: (requestId: string) => void;
  const output = new Promise<CurrentVideoSummaryHighlightsAiOutput>((resolve) => {
    resolveOutput = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const requestId = new Promise<string>((resolve) => {
    resolveRequestId = resolve;
  });
  return {
    ready,
    requestId,
    resolve: resolveOutput,
    chat: async (_config: unknown, messages: Array<{ content: string }>) => {
      const payload = JSON.parse(messages[1].content) as { request: { requestId: string } };
      resolveRequestId(payload.request.requestId);
      resolveReady();
      return await output;
    },
  };
}

function cacheRecord(
  envelope: ReturnType<typeof fullTextEnvelope>,
  options: {
    suffix: string;
    model: string;
    message?: string;
    lastAccessedAt: number;
  },
) {
  const identity = {
    ...envelope.primaryTextIdentity,
    sourceIdentityKey: `${envelope.primaryTextIdentity.sourceIdentityKey}:${options.suffix}`,
  };
  const cacheKey = buildCurrentVideoSummaryHighlightsCacheKey({ identity, model: options.model });
  const result = readyCurrentVideoSummaryHighlights({
    title: '缓存测试',
    sourceLabel: 'B站字幕',
    textSize: { lineCount: 6, charCount: 300, utf8Bytes: 600 },
    summarySentences: [],
    keyPoints: [],
    highlights: [],
    model: options.model,
    cacheKey,
    cacheHit: false,
    current: true,
    requestId: `request-${options.suffix}`,
    generatedAt: options.lastAccessedAt,
  });
  return {
    cacheKey,
    sourceIdentityKey: identity.sourceIdentityKey,
    model: options.model,
    bvid: envelope.video.bvid,
    cid: envelope.video.cid,
    page: envelope.video.page,
    generatedAt: options.lastAccessedAt,
    lastAccessedAt: options.lastAccessedAt,
    requestSnapshot: {
      ...requestSnapshotFromEnvelope(envelope),
      primaryTextIdentity: identity,
    },
    result: {
      ...result,
      message: options.message ?? result.message,
    },
  };
}

async function resetSummaryCache(): Promise<void> {
  await db.currentVideoSummaryHighlights.clear();
}
