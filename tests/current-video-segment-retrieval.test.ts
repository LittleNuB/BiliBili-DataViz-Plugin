import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCurrentVideoSegments } from '../src/shared/current-video-segment-retrieval.ts';
import { buildVideoKnowledgeResult } from '../src/shared/video-knowledge.ts';
import type { CurrentVideoContext, CurrentVideoContextResult } from '../src/shared/types/current-video-context.ts';
import type { CurrentVideoTranscriptSegment } from '../src/shared/types/current-video-transcript.ts';

test('returns an exact local transcript keyword match without inventing timestamps', () => {
  const context = withTranscriptEvidence(videoContext());
  const segments = transcriptSegments();
  const result = searchCurrentVideoSegments(context, {
    query: 'DeepSeek V3.2 那段',
    transcriptSegments: segments,
    videoKnowledge: buildVideoKnowledgeResult(context, { transcriptSegments: segments, now: 3000 }),
    now: 3000,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.candidates[0].binding.segmentId, segments[0].segmentId);
  assert.equal(result.candidates[0].timeRangeLabel, '0:12-0:18');
  assert.equal(result.candidates[0].sourceLabel, '可定位字幕证据');
  assert.ok(result.candidates[0].confidence >= 0.78);
  assert.ok(result.candidates[0].matchReasons.some(reason => reason.includes('deepseek')));
  assert.equal(result.candidates[0].binding.segmentId?.startsWith('transcript:'), true);
  assert.doesNotMatch(JSON.stringify(result), /watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i);
});

test('matches a Chinese fuzzy phrase by token and n-gram overlap', () => {
  const context = withTranscriptEvidence(videoContext());
  const segments = transcriptSegments();
  const result = searchCurrentVideoSegments(context, {
    query: '讲模型架构的地方',
    transcriptSegments: segments,
    videoKnowledge: buildVideoKnowledgeResult(context, { transcriptSegments: segments, now: 3000 }),
    now: 3000,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.candidates[0].binding.segmentId, segments[1].segmentId);
  assert.equal(result.candidates[0].timeRangeLabel, '0:24-0:32');
  assert.ok(result.candidates[0].evidenceText.includes('模型'));
  assert.ok(result.candidates[0].matchReasons.some(reason => reason.includes('中文短语') || reason.includes('模型')));
});

test('uses a weak metadata helper only when no timed evidence is available', () => {
  const context = videoContext({
    title: 'DeepSeek V3.2 发布会重点回顾',
    descriptionText: '简介提到 DeepSeek V3.2 与模型架构，但没有本地字幕正文。',
  });
  const result = searchCurrentVideoSegments(context, {
    query: 'DeepSeek V3.2',
    transcriptSegments: [],
    videoKnowledge: buildVideoKnowledgeResult(context, { transcriptSegments: [], now: 3000 }),
    now: 3000,
  });

  assert.equal(result.status, 'metadata_only');
  assert.equal(result.candidates[0].startSeconds, null);
  assert.equal(result.candidates[0].timeRangeLabel, '无法定位具体时间');
  assert.equal(result.candidates[0].binding.kind, 'metadata_hint');
  assert.ok(result.summary.includes('无法定位到具体时间点'));
  assert.ok(result.candidates[0].note?.includes('无法定位到具体时间点'));
});

test('returns no evidence when neither transcript nor metadata matches', () => {
  const context = videoContext({
    title: '烘焙经验分享',
    descriptionText: null,
  });
  const result = searchCurrentVideoSegments(context, {
    query: '模型架构',
    transcriptSegments: [],
    videoKnowledge: buildVideoKnowledgeResult(context, { transcriptSegments: [], now: 3000 }),
    now: 3000,
  });

  assert.equal(result.status, 'no_evidence');
  assert.equal(result.candidates.length, 0);
  assert.ok(result.limitations.some(item => item.includes('不会编造时间点')));
});

test('marks weak transcript overlap as low confidence', () => {
  const context = withTranscriptEvidence(videoContext({
    title: '部署注意事项',
    descriptionText: null,
  }));
  const [first] = transcriptSegments();
  const weakSegment: CurrentVideoTranscriptSegment = {
    ...first,
    segmentId: 'transcript:BV1Segment00:101:1:zh-cn:hash123:weak',
    startSeconds: 80,
    endSeconds: 86,
    text: '最后补充一点模型之外的部署注意事项。',
  };
  const result = searchCurrentVideoSegments(context, {
    query: '模型架构',
    transcriptSegments: [weakSegment],
    videoKnowledge: null,
    now: 3000,
  });

  assert.equal(result.status, 'low_confidence');
  assert.equal(result.candidates[0].confidenceLabel, '低');
  assert.ok(result.candidates[0].note?.includes('匹配较弱'));
});

test('rejects stale current-video context', () => {
  const context = withTranscriptEvidence(videoContext());
  const result = searchCurrentVideoSegments(context, {
    query: 'DeepSeek',
    transcriptSegments: transcriptSegments(),
    videoKnowledge: null,
    now: 1000 + 10 * 60 * 1000 + 1,
  });

  assert.equal(result.status, 'stale_context');
  assert.equal(result.candidates.length, 0);
  assert.ok(result.summary.includes('已过期'));
});

test('does not use transcript segments when active evidence is absent', () => {
  const context = videoContext({
    title: 'Current local video',
    descriptionText: null,
  });
  const result = searchCurrentVideoSegments(context, {
    query: 'DeepSeek V3.2',
    transcriptSegments: transcriptSegments(),
    videoKnowledge: null,
    now: 3000,
  });

  assert.equal(result.status, 'no_evidence');
  assert.equal(result.candidates.length, 0);
});

test('uses current-video knowledge node matches without adding a jump action', () => {
  const context = videoContext({
    chapters: [{ title: '模型架构章节', startSeconds: 120 }],
  });
  const knowledge = buildVideoKnowledgeResult(context, { transcriptSegments: [], now: 3000 });
  const result = searchCurrentVideoSegments(context, {
    query: '模型架构',
    transcriptSegments: [],
    videoKnowledge: knowledge,
    now: 3000,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.candidates[0].binding.kind, 'video_knowledge_node');
  assert.equal(result.candidates[0].sourceLabel, '章节弱提示');
  assert.equal(result.candidates[0].timeRangeLabel, '2:00');
  assert.equal('jumpAction' in result.candidates[0], false);
});

test('returns no context without reading broader local data', () => {
  const context: CurrentVideoContextResult = {
    kind: 'no_context',
    url: 'https://www.bilibili.com/',
    collectedAt: 1000,
    reason: 'non_video_page',
    pageType: 'non_video',
  };
  const result = searchCurrentVideoSegments(context, {
    query: 'DeepSeek',
    now: 3000,
  });

  assert.equal(result.status, 'no_context');
  assert.equal(result.candidates.length, 0);
  assert.ok(result.limitations.some(item => item.includes('不会从历史、收藏或账号资料')));
});

function videoContext(options: {
  title?: string;
  descriptionText?: string | null;
  chapters?: CurrentVideoContext['chapters'];
} = {}): CurrentVideoContext {
  const descriptionText = 'descriptionText' in options
    ? options.descriptionText
    : '这是一段可见简介，提到模型架构和发布会背景。';
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Segment00',
    collectedAt: 1000,
    bvid: 'BV1Segment00',
    cid: 101,
    title: options.title ?? 'DeepSeek V3.2 技术解析',
    authorName: 'Local UP',
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: '正片',
      total: 1,
    },
    parts: [{ page: 1, cid: 101, title: '正片', durationSeconds: 600 }],
    chapters: options.chapters ?? [],
    description: {
      availability: descriptionText ? 'available' : 'unavailable',
      text: descriptionText,
      length: descriptionText?.length ?? null,
    },
    sources: {
      metadata: 'available',
      description: descriptionText ? 'available' : 'unavailable',
      pages: 'available',
      chapters: options.chapters?.length ? 'available' : 'unknown',
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
      segmentId: 'transcript:BV1Segment00:101:1:zh-cn:hash123:0',
      startSeconds: 12,
      endSeconds: 18,
      text: 'DeepSeek V3.2 这一段先解释更新目标和上下文。',
    },
    {
      segmentId: 'transcript:BV1Segment00:101:1:zh-cn:hash123:1',
      startSeconds: 24,
      endSeconds: 32,
      text: '接下来讲模型的整体架构，包括专家路由和参数组织。',
    },
    {
      segmentId: 'transcript:BV1Segment00:101:1:zh-cn:hash123:2',
      startSeconds: 36,
      endSeconds: 40,
      text: '最后比较推理成本。',
    },
  ].map(segment => ({
    ...segment,
    bvid: 'BV1Segment00',
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
