import assert from 'node:assert/strict';
import test from 'node:test';
import { auditAssistantPayload, currentVideoSegmentRerankPayloadContract } from '../src/shared/assistant-payload-audit.ts';
import { searchCurrentVideoSegments } from '../src/shared/current-video-segment-retrieval.ts';
import {
  buildCurrentVideoSegmentRerankAiPayload,
  rerankCurrentVideoSegmentCandidates,
} from '../src/shared/current-video-segment-rerank.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type { CurrentVideoTranscriptSegment } from '../src/shared/types/current-video-transcript.ts';
import type { UserConfig } from '../src/shared/types/config.ts';

test('builds a bounded fuzzy segment rerank payload without internal or sensitive fields', () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);
  const built = buildCurrentVideoSegmentRerankAiPayload(context, local);
  const rawPayload = JSON.stringify(built.payload);
  const audit = auditAssistantPayload(built.payload, currentVideoSegmentRerankPayloadContract);

  assert.equal(built.payload.intent, 'current_video_segment_rerank_v1');
  assert.equal(built.payload.candidates.length >= 2, true);
  assert.equal(built.payload.candidates[0].candidateId, 'candidate-1');
  assert.equal(built.payload.candidates[0].localStatus.canJumpAfterConfirmation, true);
  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assert.doesNotMatch(
    rawPayload,
    /segmentId|sourceHash|authorMid|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data|raw subtitle|https:\/\/www\.bilibili\.com/i,
  );
  assert.equal(rawPayload.includes(local.candidates[0].id), false);
  assert.equal('timeRangeLabel' in built.payload.candidates[0], false);
  assert.equal('startSeconds' in built.payload.candidates[0], false);
});

test('new current-video authorization does not call the legacy segment-rerank chat path', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);
  const firstLocalOrder = local.candidates.map(candidate => candidate.id);
  let chatCalls = 0;
  let auditCalls = 0;

  const result = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => {
      chatCalls += 1;
      return {
        rankedCandidates: [],
        overallConfidence: 0.9,
      };
    },
    auditPayload: () => {
      auditCalls += 1;
    },
    now: 5000,
  });

  assert.equal(chatCalls, 0);
  assert.equal(auditCalls, 0);
  assert.equal(result.aiRerank.status, 'disabled');
  assert.match(result.aiRerank.note, /片段排序.*本地处理.*没有请求 AI/);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), local.candidates.map(candidate => candidate.id));
  assert.deepEqual(result.candidates.map(candidate => candidate.id), firstLocalOrder);
});

function localSegmentResult(context: CurrentVideoContext) {
  const result = searchCurrentVideoSegments(context, {
    query: '模型 架构 DeepSeek',
    transcriptSegments: transcriptSegments(),
    videoKnowledge: null,
    now: 3000,
  });

  assert.equal(result.candidates.length >= 2, true);
  assert.equal(result.candidates[0].jumpPreview.canJump, true);
  return result;
}

function videoContext(): CurrentVideoContext {
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1SegmentAi00',
    collectedAt: 1000,
    bvid: 'BV1SegmentAi00',
    cid: 101,
    title: 'DeepSeek V3.2 技术解析',
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
      availability: 'available',
      text: '这是一段可见简介，提到模型架构和发布会背景。',
      length: 24,
    },
    sources: {
      metadata: 'available',
      description: 'available',
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

function transcriptSegments(): CurrentVideoTranscriptSegment[] {
  return [
    {
      segmentId: 'transcript:BV1SegmentAi00:101:1:zh-cn:hash123:0',
      startSeconds: 12,
      endSeconds: 18,
      text: 'DeepSeek V3.2 这一段先解释模型更新目标和上下文。',
    },
    {
      segmentId: 'transcript:BV1SegmentAi00:101:1:zh-cn:hash123:1',
      startSeconds: 24,
      endSeconds: 32,
      text: '接下来讲模型的整体架构，包括专家路由和参数组织。',
    },
    {
      segmentId: 'transcript:BV1SegmentAi00:101:1:zh-cn:hash123:2',
      startSeconds: 36,
      endSeconds: 42,
      text: '最后比较 DeepSeek 模型的推理成本。',
    },
  ].map(segment => ({
    ...segment,
    bvid: 'BV1SegmentAi00',
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
