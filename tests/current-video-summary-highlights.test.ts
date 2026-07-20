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
  CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS,
  currentVideoSummaryHighlightBindingFromResult,
  currentVideoSummaryHighlightBindingMatchesRecord,
  readyCurrentVideoSummaryHighlights,
  requestAuditFromEnvelope,
  requestCurrentVideoSummaryHighlightsAi,
  validateCurrentVideoSummaryHighlightsAiOutput,
} from '../src/shared/current-video-summary-highlights.ts';
import {
  cancelCurrentVideoSummaryHighlightsForSource,
  cancelCurrentVideoSummaryHighlightsRequest,
  generateCurrentVideoSummaryHighlights,
  invalidateCurrentVideoSummaryHighlightsAuthorization,
  readCachedCurrentVideoSummaryHighlights,
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
import {
  canUseCurrentVideoSummaryHighlightsClearGeneration,
  getCurrentVideoSummaryHighlightsClearState,
  runCurrentVideoSummaryHighlightsClearCoordinator,
} from '../src/background/current-video-summary-highlights-clear-epoch.ts';
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

  const malformedTimes = validateCurrentVideoSummaryHighlightsAiOutput({
    ...validAiOutput(),
    highlights: [
      { title: '负数时间', description: '负数时间不能被自动改写。', startSeconds: -1, endSeconds: 9, evidenceLineNumbers: [1] },
      { title: '第二亮点', description: '第二个亮点有效。', startSeconds: 10, endSeconds: 19, evidenceLineNumbers: [2] },
      { title: '第三亮点', description: '第三个亮点有效。', startSeconds: 20, endSeconds: 29, evidenceLineNumbers: [3] },
      { title: '第四亮点', description: '第四个亮点有效。', startSeconds: 30, endSeconds: 39, evidenceLineNumbers: [4] },
    ],
  }, envelope);
  assert.deepEqual(malformedTimes, { ok: false, reason: 'highlight_bounds_invalid' });

  const malformedReference = validateCurrentVideoSummaryHighlightsAiOutput({
    ...validAiOutput(),
    summarySentences: [
      { text: '非整数证据引用不能被自动改写。', evidenceLineNumbers: [1.5] },
      { text: '第二句摘要仍然有效。', evidenceLineNumbers: [2] },
    ],
  }, envelope);
  assert.deepEqual(malformedReference, { ok: false, reason: 'summary_sentences_evidence_missing' });

  const outOfOrderKeyPoints = validateCurrentVideoSummaryHighlightsAiOutput({
    ...validAiOutput(),
    keyPoints: [
      { text: '先引用后半段的方法。', evidenceLineNumbers: [4] },
      { text: '再倒回开头的问题。', evidenceLineNumbers: [1] },
      { text: '最后引用结尾结论。', evidenceLineNumbers: [6] },
    ],
  }, envelope);
  assert.deepEqual(outOfOrderKeyPoints, { ok: false, reason: 'key_point_order_invalid' });
});

test('accepts output limits at the boundary and rejects every oversized item', () => {
  const envelope = fullTextEnvelopeWithLineCount(
    CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.evidenceLineNumbersPerItem + 1,
  );
  const base = validAiOutput();
  const summarySentences = base.summarySentences as Array<{ text: string; evidenceLineNumbers: number[] }>;
  const keyPoints = base.keyPoints as Array<{ text: string; evidenceLineNumbers: number[] }>;
  const highlights = base.highlights as Array<{
    title: string;
    description: string;
    startSeconds: number;
    endSeconds: number;
    evidenceLineNumbers: number[];
  }>;
  const maxReferences = Array.from(
    { length: CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.evidenceLineNumbersPerItem },
    (_, index) => index + 1,
  );
  const boundary = {
    summarySentences: [
      {
        ...summarySentences[0],
        text: '摘'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.summarySentenceChars),
        evidenceLineNumbers: maxReferences,
      },
      ...summarySentences.slice(1),
    ],
    keyPoints: [
      {
        ...keyPoints[0],
        text: '点'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.keyPointChars),
        evidenceLineNumbers: maxReferences,
      },
      ...keyPoints.slice(1),
    ],
    highlights: [
      {
        ...highlights[0],
        title: '亮'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.highlightTitleChars),
        description: '述'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.highlightDescriptionChars),
        evidenceLineNumbers: maxReferences,
      },
      ...highlights.slice(1),
    ],
  };
  assert.equal(validateCurrentVideoSummaryHighlightsAiOutput(boundary, envelope).ok, true);

  const oversizedCases = [
    {
      output: { ...boundary, summarySentences: [{ ...boundary.summarySentences[0], text: '摘'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.summarySentenceChars + 1) }, ...boundary.summarySentences.slice(1)] },
      reason: 'summary_sentences_text_too_long',
    },
    {
      output: { ...boundary, summarySentences: [{ ...boundary.summarySentences[0], evidenceLineNumbers: [...maxReferences, maxReferences.length + 1] }, ...boundary.summarySentences.slice(1)] },
      reason: 'summary_sentences_evidence_too_many',
    },
    {
      output: { ...boundary, keyPoints: [{ ...boundary.keyPoints[0], text: '点'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.keyPointChars + 1) }, ...boundary.keyPoints.slice(1)] },
      reason: 'key_points_text_too_long',
    },
    {
      output: { ...boundary, keyPoints: [{ ...boundary.keyPoints[0], evidenceLineNumbers: [...maxReferences, maxReferences.length + 1] }, ...boundary.keyPoints.slice(1)] },
      reason: 'key_points_evidence_too_many',
    },
    {
      output: { ...boundary, highlights: [{ ...boundary.highlights[0], title: '亮'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.highlightTitleChars + 1) }, ...boundary.highlights.slice(1)] },
      reason: 'highlight_title_too_long',
    },
    {
      output: { ...boundary, highlights: [{ ...boundary.highlights[0], description: '述'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.highlightDescriptionChars + 1) }, ...boundary.highlights.slice(1)] },
      reason: 'highlight_description_too_long',
    },
    {
      output: { ...boundary, highlights: [{ ...boundary.highlights[0], evidenceLineNumbers: [...maxReferences, maxReferences.length + 1] }, ...boundary.highlights.slice(1)] },
      reason: 'highlight_evidence_too_many',
    },
  ];
  for (const testCase of oversizedCases) {
    assert.deepEqual(
      validateCurrentVideoSummaryHighlightsAiOutput(testCase.output, envelope),
      { ok: false, reason: testCase.reason },
    );
  }
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

test('runtime payload audit blocks chat before an outbound call', async () => {
  const payload = {
    ...buildCurrentVideoSummaryHighlightsAiPayload(fullTextEnvelope()),
    watchHistory: [{ title: '不应发送的记录' }],
  };
  let chatCalls = 0;

  await assert.rejects(
    requestCurrentVideoSummaryHighlightsAi(
      userConfig({ enabled: true, apiKey: 'test-key' }).ai,
      payload as ReturnType<typeof buildCurrentVideoSummaryHighlightsAiPayload>,
      async () => {
        chatCalls += 1;
        return validAiOutput();
      },
    ),
    /Assistant payload privacy audit failed/,
  );
  assert.equal(chatCalls, 0);
});

test('runtime payload audit allows sensitive-looking words in authorized title and transcript content', async () => {
  const segments = transcriptSegments();
  const envelope = buildCurrentVideoFullTextRequestEnvelope({
    operation: 'summary_highlights',
    submittedAt: 10_000,
    model: 'Cookie-model',
    video: {
      bvid: 'BV1SummaryHi',
      cid: 6101,
      page: 1,
      title: 'Cookie、login-state 与 watchHistory 技术说明',
      partTitle: 'Key.txt 配置误区',
      durationSeconds: 120,
    },
    source: 'bilibili_subtitle',
    sourceType: 'bilibili_player_wbi_v2',
    sourceLabel: 'B站字幕',
    language: 'login-state-zh-CN',
    lines: segments.map((segment, index) => ({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: index === 0
        ? '本节讨论 Cookie、login-state、watchHistory、Key.txt 与 browser profile 这些字符串。'
        : segment.text,
    })),
  });
  const payload = buildCurrentVideoSummaryHighlightsAiPayload(envelope);
  let chatCalls = 0;
  const output = await requestCurrentVideoSummaryHighlightsAi(
    userConfig({ enabled: true, apiKey: 'test-key' }).ai,
    payload,
    async () => {
      chatCalls += 1;
      return validAiOutput();
    },
  );

  assert.equal(chatCalls, 1);
  assert.equal(output.highlights.length, 4);
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
  assert.equal(cached?.requestAudit.requestId, result.requestId);
  assert.equal(cached?.requestAudit.text.lineCount, 6);
  assert.equal('lines' in (cached?.requestAudit.text ?? {}), false);
});

test('late valid output stays on the captured cache identity and is not marked current', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const capturedIdentity = context.transcriptEvidence?.sourceIdentityKey ?? '';
  const changedIdentity = 'cv-text-source:v1:changed-after-submit';
  const result = await generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: async () => validAiOutput(),
    resolveCurrentIdentity: async () => ({ sourceIdentityKey: changedIdentity }),
    now: 11_000,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.current, false);
  assert.ok(await getCurrentVideoSummaryHighlightsCache({
    identity: { sourceIdentityKey: capturedIdentity },
    model: 'test-model',
  }));
  assert.equal(await getCurrentVideoSummaryHighlightsCache({
    identity: { sourceIdentityKey: changedIdentity },
    model: 'test-model',
  }), null);
});

test('oversized model output rejects the whole refresh and preserves the previous exact cache', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const config = userConfig({ enabled: true, apiKey: 'test-key' });
  const previous = await generateCurrentVideoSummaryHighlights(context, {
    requestId: 'bounded-previous',
    config,
    transcriptSegments: transcriptSegments(),
    chat: async () => validAiOutput({ suffix: '此前' }),
  });
  assert.equal(previous.status, 'ready');

  const oversized = validAiOutput();
  const summaries = oversized.summarySentences as Array<{ text: string; evidenceLineNumbers: number[] }>;
  oversized.summarySentences = [
    {
      ...summaries[0],
      text: '超'.repeat(CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_OUTPUT_LIMITS.summarySentenceChars + 1),
    },
    ...summaries.slice(1),
  ];
  const rejected = await generateCurrentVideoSummaryHighlights(context, {
    requestId: 'bounded-rejected',
    config,
    transcriptSegments: transcriptSegments(),
    chat: async () => oversized,
  });
  assert.equal(rejected.status, 'invalid_output');
  const cached = await getCurrentVideoSummaryHighlightsCache({
    identity: { sourceIdentityKey: context.transcriptEvidence?.sourceIdentityKey ?? '' },
    model: 'test-model',
  });
  assert.equal(cached?.result.requestId, 'bounded-previous');
  assert.match(cached?.result.summarySentences[0]?.text ?? '', /此前/);
});

test('authorization-off keeps an exact cache readable as prior generation and blocks refresh', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const enabledConfig = userConfig({ enabled: true, apiKey: 'test-key' });
  const generated = await generateCurrentVideoSummaryHighlights(context, {
    config: enabledConfig,
    transcriptSegments: transcriptSegments(),
    chat: async () => validAiOutput(),
    currentIdentity: { sourceIdentityKey: context.transcriptEvidence?.sourceIdentityKey ?? '' },
  });
  assert.equal(generated.status, 'ready');

  const cached = await readCachedCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: false, apiKey: 'test-key' }),
  });
  assert.equal(cached.status, 'ready');
  assert.equal(cached.priorGenerated, true);
  assert.equal(cached.canGenerate, false);
  assert.match(cached.message, /此前生成/);

  let chatCalls = 0;
  const blocked = await generateCurrentVideoSummaryHighlights(context, {
    config: userConfig({ enabled: false, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: async () => {
      chatCalls += 1;
      return validAiOutput({ suffix: '不应生成' });
    },
  });
  assert.equal(blocked.ai.status, 'disabled');
  assert.equal(chatCalls, 0);
  assert.equal((await collectCurrentVideoSummaryHighlightsCacheUsage()).count, 1);
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

test('same-source replacement with a changed model aborts the old network request', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const oldGate = deferredRejectingChat();
  const oldConfig = userConfig({ enabled: true, apiKey: 'test-key' });
  oldConfig.ai.chatModel = 'old-model';
  const oldRun = generateCurrentVideoSummaryHighlights(context, {
    requestId: 'old-model-request',
    config: oldConfig,
    transcriptSegments: transcriptSegments(),
    chat: oldGate.chat,
  });
  await oldGate.ready;

  const newConfig = userConfig({ enabled: true, apiKey: 'test-key' });
  newConfig.ai.chatModel = 'new-model';
  const replacement = await generateCurrentVideoSummaryHighlights(context, {
    requestId: 'new-model-request',
    config: newConfig,
    transcriptSegments: transcriptSegments(),
    chat: async () => validAiOutput({ suffix: '新模型' }),
  });

  assert.equal(oldGate.signal?.aborted, true);
  oldGate.reject(new Error('old model request aborted by replacement'));
  assert.equal((await oldRun).status, 'cancelled');
  assert.equal(replacement.status, 'ready');
  const rows = await db.currentVideoSummaryHighlights.toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.model, 'new-model');
  assert.equal(rows[0]?.requestAudit.requestId, 'new-model-request');
});

test('late rejection after exact cancel or authorization disable resolves cancelled and never persists', async () => {
  await resetSummaryCache();
  const context = videoContext();
  const cancelGate = deferredRejectingChat();
  const cancelRun = generateCurrentVideoSummaryHighlights(context, {
    requestId: 'client-captured-source-request',
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: cancelGate.chat,
  });
  await cancelGate.ready;
  cancelCurrentVideoSummaryHighlightsRequest('client-captured-source-request');
  assert.equal(cancelGate.signal?.aborted, true);
  cancelGate.reject(new Error('late network rejection after source changed'));
  assert.equal((await cancelRun).status, 'cancelled');
  assert.equal((await collectCurrentVideoSummaryHighlightsCacheUsage()).count, 0);

  const disabledGate = deferredRejectingChat();
  let authorizationEnabled = true;
  const disabledRun = generateCurrentVideoSummaryHighlights(context, {
    requestId: 'authorization-disabled-request',
    config: userConfig({ enabled: true, apiKey: 'test-key' }),
    transcriptSegments: transcriptSegments(),
    chat: disabledGate.chat,
    authorizationStillEnabled: async () => authorizationEnabled,
  });
  await disabledGate.ready;
  authorizationEnabled = false;
  invalidateCurrentVideoSummaryHighlightsAuthorization();
  assert.equal(disabledGate.signal?.aborted, true);
  disabledGate.reject(new Error('late rejection after authorization disabled'));
  assert.equal((await disabledRun).status, 'cancelled');
  assert.equal((await collectCurrentVideoSummaryHighlightsCacheUsage()).count, 0);
});

test('cache clear generation is checked inside the write transaction', async () => {
  await resetSummaryCache();
  const envelope = fullTextEnvelope();
  let releaseWrite!: () => void;
  let markPaused!: () => void;
  const paused = new Promise<void>(resolve => { markPaused = resolve; });
  const resume = new Promise<void>(resolve => { releaseWrite = resolve; });
  const expectedClearGeneration = getCurrentVideoSummaryHighlightsClearState().generation;
  const lateWrite = putCurrentVideoSummaryHighlightsCache(
    cacheRecord(envelope, { suffix: 'clear-race', model: 'clear-race-model', lastAccessedAt: 1 }),
    {
      expectedClearGeneration,
      beforeWrite: async () => {
        markPaused();
        await resume;
      },
    },
  );
  await paused;
  await clearCurrentVideoSummaryHighlightsCache();
  releaseWrite();

  const result = await lateWrite;
  assert.equal(result.cached, false);
  assert.equal(result.rejectedReason, 'cleared');
  assert.equal((await collectCurrentVideoSummaryHighlightsCacheUsage()).count, 0);
});

test('overlapping summary clear coordinators keep the write barrier until the last clear finishes', async () => {
  let markOuterStarted!: () => void;
  let releaseOuter!: () => void;
  const outerStarted = new Promise<void>(resolve => { markOuterStarted = resolve; });
  const outerRelease = new Promise<void>(resolve => { releaseOuter = resolve; });

  const outer = runCurrentVideoSummaryHighlightsClearCoordinator(async () => {
    markOuterStarted();
    await outerRelease;
  });
  await outerStarted;
  await runCurrentVideoSummaryHighlightsClearCoordinator(async () => undefined);

  const duringOverlap = getCurrentVideoSummaryHighlightsClearState();
  assert.equal(duringOverlap.clearing, true);
  assert.equal(
    canUseCurrentVideoSummaryHighlightsClearGeneration(duringOverlap.generation),
    false,
  );

  releaseOuter();
  await outer;
  assert.equal(getCurrentVideoSummaryHighlightsClearState().clearing, false);
});

test('post-write invalidation rolls back a replacement and preserves the previous cache row', async () => {
  await resetSummaryCache();
  const envelope = fullTextEnvelope();
  const previous = cacheRecord(envelope, {
    suffix: 'post-write-race',
    model: 'post-write-model',
    message: '此前有效结果',
    lastAccessedAt: 10,
  });
  await putCurrentVideoSummaryHighlightsCache(previous);

  let releaseWrite!: () => void;
  let markPaused!: () => void;
  let authorizationEnabled = true;
  const paused = new Promise<void>(resolve => { markPaused = resolve; });
  const resume = new Promise<void>(resolve => { releaseWrite = resolve; });
  const replacement = {
    ...previous,
    generatedAt: 20,
    lastAccessedAt: 20,
    requestAudit: {
      ...previous.requestAudit,
      requestId: 'post-write-replacement',
    },
    result: {
      ...previous.result,
      generatedAt: 20,
      requestId: 'post-write-replacement',
      message: '不应保留的新结果',
    },
  };
  const lateWrite = putCurrentVideoSummaryHighlightsCache(replacement, {
    canWrite: () => authorizationEnabled,
    afterWrite: async () => {
      markPaused();
      await resume;
    },
  });

  await paused;
  authorizationEnabled = false;
  releaseWrite();
  const result = await lateWrite;
  assert.equal(result.cached, false);
  assert.equal(result.rejectedReason, 'invalidated');
  const rows = await db.currentVideoSummaryHighlights.toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.result.message, '此前有效结果');
  assert.equal(rows[0]?.result.requestId, previous.result.requestId);
  assert.equal(rows[0]?.requestAudit.requestId, previous.requestAudit.requestId);
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
  const storedRows = await db.currentVideoSummaryHighlights.toArray();
  const actualStoredBytes = storedRows.reduce(
    (sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).byteLength,
    0,
  );
  assert.equal(actualStoredBytes, usageBySize.usageBytes);
  assert.ok(actualStoredBytes <= CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_BYTES);
  for (const row of storedRows) {
    assert.equal(row.serializedBytes, new TextEncoder().encode(JSON.stringify(row)).byteLength);
  }

  const cleared = await clearCurrentVideoSummaryHighlightsCache();
  assert.equal(cleared.currentVideoSummaryHighlightParts, usageBySize.count);
  assert.equal((await readCurrentVideoSummaryHighlightsAfterClear()).empty, true);
});

test('persisted cache rows contain no second copy of primary text', async () => {
  await resetSummaryCache();
  const envelope = fullTextEnvelope();
  await putCurrentVideoSummaryHighlightsCache(cacheRecord(envelope, {
    suffix: 'no-primary-text-copy',
    model: 'privacy-model',
    lastAccessedAt: 100,
  }));

  const rows = await db.currentVideoSummaryHighlights.toArray();
  assert.equal(rows.length, 1);
  const persisted = JSON.stringify(rows[0]);
  assert.doesNotMatch(persisted, /完整正文第 [1-6] 行/);
  assert.equal('requestSnapshot' in rows[0], false);
  assert.equal('lines' in rows[0].requestAudit.text, false);
  assert.equal(rows[0].requestAudit.primaryTextIdentity.lineCount, 6);
});

test('highlight confirmation binding rejects same-key regeneration until a new preview', () => {
  const envelope = fullTextEnvelope();
  const oldRecord = cacheRecord(envelope, {
    suffix: 'binding',
    model: 'binding-model',
    lastAccessedAt: 100,
  });
  const oldBinding = currentVideoSummaryHighlightBindingFromResult(oldRecord.result, 'highlight-1');
  assert.ok(oldBinding);
  assert.equal(currentVideoSummaryHighlightBindingMatchesRecord(oldBinding, oldRecord), true);

  const replacement = {
    ...oldRecord,
    generatedAt: 101,
    requestAudit: {
      ...oldRecord.requestAudit,
      requestId: 'replacement-request',
    },
    result: {
      ...oldRecord.result,
      generatedAt: 101,
      requestId: 'replacement-request',
      highlights: oldRecord.result.highlights.map((highlight, index) => index === 0
        ? { ...highlight, title: '替换后的第一个亮点', startSeconds: 8, endSeconds: 14 }
        : highlight),
    },
  };
  assert.equal(currentVideoSummaryHighlightBindingMatchesRecord(oldBinding, replacement), false);
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

function fullTextEnvelopeWithLineCount(lineCount: number) {
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
      durationSeconds: Math.max(120, lineCount * 10),
    },
    source: 'bilibili_subtitle',
    sourceType: 'bilibili_player_wbi_v2',
    sourceLabel: 'B站字幕',
    language: 'zh-CN',
    lines: Array.from({ length: lineCount }, (_, index) => ({
      startSeconds: index * 10,
      endSeconds: index * 10 + 9,
      text: `扩展正文第 ${index + 1} 行。`,
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

function deferredRejectingChat() {
  let rejectOutput!: (error: Error) => void;
  let resolveReady!: () => void;
  let signal: AbortSignal | undefined;
  const output = new Promise<CurrentVideoSummaryHighlightsAiOutput>((_resolve, reject) => {
    rejectOutput = reject;
  });
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return {
    ready,
    reject: rejectOutput,
    get signal() {
      return signal;
    },
    chat: async (
      _config: unknown,
      _messages: Array<{ content: string }>,
      options?: { signal?: AbortSignal },
    ) => {
      signal = options?.signal;
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
  const validation = validateCurrentVideoSummaryHighlightsAiOutput(validAiOutput(), envelope);
  if (!validation.ok) throw new Error(`invalid cache fixture: ${validation.reason}`);
  const result = readyCurrentVideoSummaryHighlights({
    title: '缓存测试',
    sourceLabel: 'B站字幕',
    textSize: { lineCount: 6, charCount: 300, utf8Bytes: 600 },
    summarySentences: validation.result.summarySentences,
    keyPoints: validation.result.keyPoints,
    highlights: validation.result.highlights,
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
    requestAudit: {
      ...requestAuditFromEnvelope(envelope),
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
