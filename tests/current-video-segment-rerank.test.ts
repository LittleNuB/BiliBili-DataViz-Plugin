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

test('applies valid AI rerank without changing local candidate evidence or jump preview', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);
  const firstLocalOrder = local.candidates.map(candidate => candidate.id);

  const result = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async (_config, messages) => {
      const payload = JSON.parse(messages[1].content);
      assert.equal(JSON.stringify(payload).includes('sourceHash'), false);
      return {
        rankedCandidates: [
          {
            candidateId: 'candidate-2',
            explanation: '这条候选更贴近用户说的架构线索。',
            reason: '有界证据片段直接提到架构。',
            confidence: 0.84,
          },
          {
            candidateId: 'candidate-1',
            explanation: '这条也相关，但更像上下文铺垫。',
            reason: '命中问题词但细节较少。',
            confidence: 0.72,
          },
        ],
        overallConfidence: 0.81,
      };
    },
    now: 5000,
  });

  assert.equal(result.aiRerank.status, 'generated');
  assert.equal(result.candidates[0].id, firstLocalOrder[1]);
  assert.equal(result.candidates[0].timeRangeLabel, local.candidates[1].timeRangeLabel);
  assert.equal(result.candidates[0].evidenceText, local.candidates[1].evidenceText);
  assert.deepEqual(result.candidates[0].jumpPreview, local.candidates[1].jumpPreview);
  assert.equal(result.aiRerank.explanations[0].candidateId, firstLocalOrder[1]);
  assert.ok(result.aiRerank.note.includes('跳转前必须确认'));
});

test('rejects unknown AI candidate IDs and keeps local candidate order visible', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);
  const result = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      rankedCandidates: [
        {
          candidateId: 'candidate-99',
          explanation: '看起来相关。',
          reason: '模型词重合。',
          confidence: 0.9,
        },
      ],
      overallConfidence: 0.9,
    }),
    now: 5000,
  });

  assert.equal(result.aiRerank.status, 'rejected');
  assert.match(result.aiRerank.error ?? '', /AI_UNKNOWN_CANDIDATE_ID/);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), local.candidates.map(candidate => candidate.id));
});

test('rejects invented timestamp text from AI output', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);
  const result = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      rankedCandidates: [
        {
          candidateId: 'candidate-1',
          explanation: '应该跳到 0:24 附近。',
          reason: 'AI 试图输出时间点。',
          confidence: 0.9,
        },
      ],
      overallConfidence: 0.9,
    }),
    now: 5000,
  });

  assert.equal(result.aiRerank.status, 'rejected');
  assert.match(result.aiRerank.error ?? '', /AI_TIMESTAMP_OUT_OF_SCHEMA/);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), local.candidates.map(candidate => candidate.id));
});

test('rejects outside titles, unavailable sources, and extra evidence fields', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);

  const outsideTitle = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      rankedCandidates: [
        {
          candidateId: 'candidate-1',
          explanation: '参考《外部视频标题》判断相关。',
          reason: '标题看似相关。',
          confidence: 0.9,
        },
      ],
      overallConfidence: 0.9,
    }),
    now: 5000,
  });
  const unavailableSource = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      rankedCandidates: [
        {
          candidateId: 'candidate-1',
          explanation: '根据评论和弹幕判断相关。',
          reason: '引用了未提供来源。',
          confidence: 0.9,
        },
      ],
      overallConfidence: 0.9,
    }),
    now: 5000,
  });
  const extraEvidence = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      rankedCandidates: [
        {
          candidateId: 'candidate-1',
          explanation: '看起来相关。',
          reason: '模型词重合。',
          confidence: 0.9,
          evidence: 'AI 自己补充的外部证据',
        },
      ],
      overallConfidence: 0.9,
    }),
    now: 5000,
  });

  assert.equal(outsideTitle.aiRerank.status, 'rejected');
  assert.match(outsideTitle.aiRerank.error ?? '', /AI_OUTSIDE_TITLE_REFERENCE/);
  assert.equal(unavailableSource.aiRerank.status, 'rejected');
  assert.match(unavailableSource.aiRerank.error ?? '', /AI_UNAVAILABLE_SOURCE_REFERENCE/);
  assert.equal(extraEvidence.aiRerank.status, 'rejected');
  assert.match(extraEvidence.aiRerank.error ?? '', /AI_SCHEMA_VIOLATION/);
});

test('AI disabled, not configured, and failed states keep local candidates visible', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);
  const disabled = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: false, apiKey: 'test-key' }),
    chat: async () => {
      throw new Error('should not call chat');
    },
    now: 5000,
  });
  const notConfigured = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: '' }),
    chat: async () => {
      throw new Error('should not call chat');
    },
    now: 5000,
  });
  const failed = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => {
      throw new Error('AI_TEST_FAILURE');
    },
    now: 5000,
  });

  assert.equal(disabled.aiRerank.status, 'disabled');
  assert.equal(notConfigured.aiRerank.status, 'not_configured');
  assert.equal(failed.aiRerank.status, 'failed');
  assert.match(failed.aiRerank.error ?? '', /AI_TEST_FAILURE/);
  for (const result of [disabled, notConfigured, failed]) {
    assert.deepEqual(result.candidates.map(candidate => candidate.id), local.candidates.map(candidate => candidate.id));
    assert.equal(result.candidates.length > 0, true);
    assert.ok(result.aiRerank.note.includes('本地候选顺序'));
  }
});

test('low-confidence AI output falls back to local candidate order', async () => {
  const context = withTranscriptEvidence(videoContext());
  const local = localSegmentResult(context);
  const result = await rerankCurrentVideoSegmentCandidates(context, local, {
    config: userConfig({ currentVideoAiAssistantEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      rankedCandidates: [
        {
          candidateId: 'candidate-2',
          explanation: '可能相关，但证据不够稳。',
          reason: '只是弱重合。',
          confidence: 0.31,
        },
      ],
      overallConfidence: 0.32,
    }),
    now: 5000,
  });

  assert.equal(result.aiRerank.status, 'low_confidence');
  assert.match(result.aiRerank.error ?? '', /AI_LOW_CONFIDENCE/);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), local.candidates.map(candidate => candidate.id));
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
