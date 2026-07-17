import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditAssistantPayload,
  currentVideoQaPayloadContract,
} from '../src/shared/assistant-payload-audit.ts';
import {
  answerCurrentVideoQuestion,
  buildCurrentVideoQaAiPayload,
} from '../src/shared/current-video-qa.ts';
import { buildCurrentVideoRelatedFavoritesHint } from '../src/shared/current-video-related-favorites.ts';
import { searchCurrentVideoSegments } from '../src/shared/current-video-segment-retrieval.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type { CurrentVideoTranscriptSegment } from '../src/shared/types/current-video-transcript.ts';
import type { UserConfig } from '../src/shared/types/config.ts';

test('answers yes first and cites current-video subtitle evidence', () => {
  const context = withTranscriptEvidence(videoContext());
  const segments = subagentSegments();
  const result = searchCurrentVideoSegments(context, {
    query: '有没有关于 subagent 的介绍？',
    transcriptSegments: segments,
    videoKnowledge: null,
    now: 3000,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.qa.status, 'answered');
  assert.match(result.qa.answer, /^有。/);
  assert.equal(result.qa.citedSegments.length > 0, true);
  assert.equal(result.qa.citedSegments[0].candidateId, result.candidates[0].id);
  assert.ok(result.qa.citedSegments[0].evidenceText.includes('子代理'));
  assert.equal(result.candidates[0].jumpPreview.canJump, true);
});

test('answers not found when current-video transcript evidence has no match', () => {
  const context = withTranscriptEvidence(videoContext());
  const result = searchCurrentVideoSegments(context, {
    query: '量子力学实验',
    transcriptSegments: subagentSegments(),
    videoKnowledge: null,
    now: 3000,
  });

  assert.equal(result.status, 'no_evidence');
  assert.equal(result.qa.status, 'not_found');
  assert.match(result.qa.answer, /^没有。/);
  assert.equal(result.qa.citedSegments.length, 0);
});

test('does not generate a full answer without subtitle body or local nodes', () => {
  const context = videoContext({
    title: 'subagent 主题简介',
    descriptionText: '简介提到 subagent，但没有字幕正文。',
  });
  const result = searchCurrentVideoSegments(context, {
    query: '有没有关于 subagent 的介绍？',
    transcriptSegments: [],
    videoKnowledge: null,
    now: 3000,
  });

  assert.equal(result.status, 'metadata_only');
  assert.equal(result.qa.status, 'no_transcript');
  assert.match(result.qa.answer, /^证据不足。/);
  assert.equal(result.qa.citedSegments.length, 0);
  assert.ok(result.qa.limitations.some(item => item.includes('不能生成完整视频回答')));
});

test('new current-video authorization does not call the legacy cited-fragment QA chat path', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localQaResult(context);
  const localOrder = local.candidates.map(candidate => candidate.id);
  let chatCalls = 0;

  const result = await answerCurrentVideoQuestion(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => {
      chatCalls += 1;
      return {
        answer: 'legacy response',
        status: 'answered',
        confidence: 0.9,
        citedCandidateIds: ['candidate-1'],
      };
    },
    now: 5000,
  });

  assert.equal(chatCalls, 0);
  assert.equal(result.qa.aiState.status, 'disabled');
  assert.match(result.qa.aiState.note, /没有向聊天服务发送视频内容/);
  assert.equal(result.qa.answer, local.qa.answer);
  assert.deepEqual(result.qa.citedSegments, local.qa.citedSegments);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), localOrder);
});

test('audits current-video QA AI payload allowlist and rejects sensitive fields', () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localQaResult(context);
  const built = buildCurrentVideoQaAiPayload(context, local);
  const rawPayload = JSON.stringify(built.payload);
  const audit = auditAssistantPayload(built.payload, currentVideoQaPayloadContract);

  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assert.equal(built.payload.candidates[0].candidateId, 'candidate-1');
  assert.equal('startSeconds' in built.payload.candidates[0], false);
  assert.equal('timeRangeLabel' in built.payload.candidates[0], false);
  assert.doesNotMatch(rawPayload, /segmentId|sourceHash|authorMid|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i);
  assert.equal(rawPayload.includes(local.candidates[0].id), false);

  const badPayload = {
    ...built.payload,
    watchHistory: [{ bvid: 'BVHistoryLeak' }],
    video: {
      ...built.payload.video,
      authorMid: 12345,
    },
    safetyRules: [
      ...built.payload.safetyRules,
      'Do not send Cookie: SESSDATA=abc or C:\\Users\\LittleNub\\Desktop\\Key.txt.',
    ],
  };
  const badAudit = auditAssistantPayload(badPayload, currentVideoQaPayloadContract);
  const report = badAudit.violations.map(violation => `${violation.path} ${violation.token ?? ''}`).join('\n');
  assert.equal(badAudit.passed, false);
  assert.match(report, /\$\.watchHistory/);
  assert.match(report, /\$\.video\.authorMid/);
  assert.match(report, /Cookie\/login token/);
  assert.match(report, /C:\\Users\\LittleNub\\Desktop\\Key\.txt/);
});

test('keeps related favorites hints separate from current-video answer payload', () => {
  const context = withTranscriptEvidence(videoContext({
    title: 'Subagent workflow demo',
    descriptionText: 'Visible description about agent handoff and saved learning videos.',
  }));
  const local = localQaResult(context);
  const relatedHint = buildCurrentVideoRelatedFavoritesHint(context, {
    question: 'Find related saved subagent videos',
  });
  const built = buildCurrentVideoQaAiPayload(context, local);
  const rawPayload = JSON.stringify(built.payload);

  assert.match(relatedHint.query, /Find related saved subagent videos/);
  assert.match(relatedHint.query, /Subagent workflow demo/);
  assert.equal('relatedFavorites' in built.payload, false);
  assert.equal('citedVideos' in built.payload, false);
  assert.doesNotMatch(rawPayload, /saved learning videos|related saved|favorite|favorites|收藏|itemKey|mediaId/i);
  assert.equal(rawPayload.includes(relatedHint.query), false);
});

function localQaResult(context: CurrentVideoContext) {
  const result = searchCurrentVideoSegments(context, {
    query: '有没有关于 subagent 的介绍？',
    transcriptSegments: subagentSegments(),
    videoKnowledge: null,
    now: 3000,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.qa.status, 'answered');
  assert.equal(result.candidates.length > 0, true);
  return result;
}

function videoContext(options: {
  title?: string;
  descriptionText?: string | null;
} = {}): CurrentVideoContext {
  const descriptionText = 'descriptionText' in options
    ? options.descriptionText
    : '这是一段可见简介，提到 Agent 协作和开发工作流。';
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Qa000000',
    collectedAt: 1000,
    bvid: 'BV1Qa000000',
    cid: 101,
    title: options.title ?? 'Agent 协作演示',
    authorName: 'Local UP',
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: '正片',
      total: 1,
    },
    parts: [{ page: 1, cid: 101, title: '正片', durationSeconds: 600 }],
    chapters: [],
    description: {
      availability: descriptionText ? 'available' : 'unavailable',
      text: descriptionText,
      length: descriptionText?.length ?? null,
    },
    sources: {
      metadata: 'available',
      description: descriptionText ? 'available' : 'unavailable',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'unavailable',
      contentText: 'unavailable',
    },
    warnings: ['transcript_unavailable'],
  };
}

function withTranscriptEvidence(context: CurrentVideoContext): CurrentVideoContext {
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
    segmentCount: 3,
    staleSegmentCount: 0,
    coverageStartSeconds: 12,
    coverageEndSeconds: 40,
    fetchedAt: 2000,
    updatedAt: 2000,
    reason: 'transcript_segments_cached',
    message: '已缓存字幕正文证据，仅作为本地证据状态展示。',
    warnings: [],
  };
  return context;
}

function subagentSegments(): CurrentVideoTranscriptSegment[] {
  return [
    {
      segmentId: 'transcript:BV1Qa000000:101:1:zh-cn:hash123:0',
      startSeconds: 12,
      endSeconds: 20,
      text: '这里介绍子代理和子智能体如何分担任务，并说明多代理协作的边界。',
    },
    {
      segmentId: 'transcript:BV1Qa000000:101:1:zh-cn:hash123:1',
      startSeconds: 24,
      endSeconds: 32,
      text: '接下来讨论 context window 和工具调用，不引用外部资料。',
    },
  ].map(segment => ({
    ...segment,
    bvid: 'BV1Qa000000',
    cid: 101,
    page: 1,
    language: 'zh-CN',
    source: 'bilibili_subtitle' as const,
    sourceType: 'bilibili_player_wbi_v2' as const,
    sourceHash: 'hash123',
    stale: false,
    fetchedAt: 2000,
    updatedAt: 2000,
  }));
}

function userConfig(overrides: {
  currentVideoAiAssistantEnabled: boolean;
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
      baseURL: 'https://api.test',
      apiKey: overrides.apiKey,
      chatModel: 'test-model',
    },
    assistant: {
      currentVideoAiAssistantEnabled: overrides.currentVideoAiAssistantEnabled,
      smartFavoritesQaAiEnabled: false,
    },
    dynamicBill: {
      aiExplanationsEnabled: false,
    },
  };
}
