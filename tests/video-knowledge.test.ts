import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVideoKnowledgeResult } from '../src/shared/video-knowledge.ts';
import type { CurrentVideoContext, CurrentVideoContextResult } from '../src/shared/types/current-video-context.ts';
import type { CurrentVideoTranscriptEvidenceStatus, CurrentVideoTranscriptSegment } from '../src/shared/types/current-video-transcript.ts';

test('builds metadata-only node without transcript or fabricated timestamp', () => {
  const result = buildVideoKnowledgeResult(videoContext({
    descriptionText: null,
    parts: [],
    chapters: [],
  }), 1000);

  assert.equal(result.status, 'ready');
  assert.equal(result.sourceState.transcript, false);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].source, 'metadata');
  assert.equal(result.nodes[0].sourceLabel, '元数据');
  assert.equal(result.nodes[0].timestamp, null);
  assert.equal(result.nodes[0].jumpAction, null);
  assert.ok(result.nodes[0].confidence > 0);
  assert.ok(result.limitations.some(item => item.includes('不代表完整视频理解')));
});

test('builds description helper without jump target', () => {
  const result = buildVideoKnowledgeResult(videoContext({
    descriptionText: 'This visible description lists the topic, scope, and audience without being transcript evidence.',
    parts: [],
    chapters: [],
  }), 1000);

  const description = result.nodes.find(node => node.source === 'description');
  assert.ok(description);
  assert.equal(description.timestamp, null);
  assert.equal(description.jumpAction, null);
  assert.equal(description.sourceLabel, '简介');
  assert.ok(description.safetyFlags.includes('description_only'));
  assert.ok(description.evidence?.textSpan?.includes('visible description'));
});

test('exposes available subtitle source state without generating transcript nodes', () => {
  const context = videoContext({
    descriptionText: 'Description fallback remains visible.',
    parts: [],
    chapters: [],
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

  const result = buildVideoKnowledgeResult(context, 1000);

  assert.equal(result.sourceState.transcript, true);
  assert.equal(result.sourceState.transcriptEvidence, false);
  assert.equal(result.sourceState.contentText, false);
  assert.equal(result.transcriptEvidence, null);
  assert.equal(result.nodes.some(node => node.source === 'transcript'), false);
  assert.ok(result.warnings.includes('transcript_nodes_not_generated'));
  assert.ok(result.limitations.some(item => item.includes('没有可引用的本地字幕正文片段')));
});

test('does not use active transcript cache without supplied evidence segments', () => {
  const context = videoContext({
    descriptionText: 'Description fallback remains visible.',
    parts: [],
    chapters: [],
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
    coverageEndSeconds: 9,
    fetchedAt: 2000,
    updatedAt: 2000,
    reason: 'transcript_segments_cached',
    message: '已缓存字幕正文证据，仅作为本地证据状态展示。',
    warnings: [],
  };

  const result = buildVideoKnowledgeResult(context, 2000);

  assert.equal(result.sourceState.transcript, true);
  assert.equal(result.sourceState.transcriptEvidence, true);
  assert.equal(result.sourceState.contentText, false);
  assert.equal(result.transcriptEvidence?.segmentCount, 2);
  assert.equal(result.nodes.some(node => node.source === 'transcript'), false);
  assert.ok(result.warnings.includes('transcript_evidence_segments_not_available_for_nodes'));
});

test('builds transcript-grounded nodes from active cached evidence segments', () => {
  const context = withTranscriptEvidence(videoContext({
    descriptionText: 'Description fallback remains visible.',
    parts: [],
    chapters: [],
  }));
  const result = buildVideoKnowledgeResult(context, {
    transcriptSegments: transcriptSegments(),
    now: 3000,
  });

  const transcriptNodes = result.nodes.filter(node => node.source === 'transcript');
  const first = transcriptNodes[0];

  assert.equal(result.sourceState.transcript, true);
  assert.equal(result.sourceState.transcriptEvidence, true);
  assert.equal(result.sourceState.contentText, false);
  assert.equal(transcriptNodes.length, 4);
  assert.ok(first);
  assert.equal(first.timestamp, 0);
  assert.equal(first.endTimestamp, 4);
  assert.equal(first.jumpAction, null);
  assert.equal(first.sourceLabel, '字幕');
  assert.equal(first.evidence?.segmentId, 'transcript:BV1Knowledge00:101:1:zh-cn:hash123:0');
  assert.equal(first.evidence?.sourceId, first.evidence?.segmentId);
  assert.equal(first.evidence?.startSeconds, 0);
  assert.equal(first.evidence?.endSeconds, 4);
  assert.equal(first.evidence?.sourceHash, 'hash123');
  assert.equal(first.evidence?.sourceStatus, 'active');
  assert.ok(first.evidence?.textSpan?.includes('first transcript point'));
  assert.ok(first.reason.includes('不从简介或元数据推断时间点'));
  assert.ok(first.safetyFlags.includes('transcript_grounded'));
  assert.ok(first.safetyFlags.includes('bounded_current_video'));
  assert.ok(first.safetyFlags.includes('auto_jump_disabled'));
  assert.ok(first.confidence >= 0.7);
  assert.ok(result.warnings.includes('transcript_nodes_generated'));
  assert.ok(result.limitations.some(item => item.includes('不新增自动跳转')));
});

test('keeps transcript nodes bounded to current video identity and source hash', () => {
  const context = withTranscriptEvidence(videoContext({
    descriptionText: 'Description fallback remains visible.',
    parts: [],
    chapters: [],
  }));
  const mixedSegments = [
    ...transcriptSegments(),
    {
      ...transcriptSegments()[0],
      segmentId: 'transcript:BV1Other:101:1:zh-cn:hash123:leak',
      bvid: 'BV1Other',
      text: 'SECRET TRANSCRIPT FROM ANOTHER VIDEO',
    },
    {
      ...transcriptSegments()[1],
      segmentId: 'transcript:BV1Knowledge00:101:1:zh-cn:oldhash:stale',
      sourceHash: 'oldhash',
      text: 'OLD HASH TRANSCRIPT SHOULD NOT APPEAR',
    },
  ];
  const result = buildVideoKnowledgeResult(context, {
    transcriptSegments: mixedSegments,
    now: 3000,
  });
  const rawResult = JSON.stringify(result);

  assert.equal(result.nodes.filter(node => node.source === 'transcript').length, 4);
  assert.doesNotMatch(rawResult, /SECRET TRANSCRIPT|OLD HASH TRANSCRIPT|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i);
});

test('does not generate transcript nodes for stale, mismatch, empty, or malformed evidence states', () => {
  const statuses: CurrentVideoTranscriptEvidenceStatus[] = ['stale', 'language_mismatch', 'empty', 'malformed'];
  for (const status of statuses) {
    const context = withTranscriptEvidence(videoContext({
      descriptionText: 'Description fallback remains visible.',
      parts: [],
      chapters: [],
    }), {
      status,
      active: false,
      message: `状态 ${status} 不能作为当前字幕正文证据。`,
      warnings: [`transcript_${status}`],
    });
    const result = buildVideoKnowledgeResult(context, {
      transcriptSegments: transcriptSegments(),
      now: 3000,
    });

    assert.equal(result.nodes.some(node => node.source === 'transcript'), false);
    assert.ok(result.nodes.some(node => node.source === 'description'));
    assert.ok(result.limitations.some(item => item.includes('元数据') || item.includes('简介')));
  }
});

test('drops empty, stale, language-mismatched, and malformed transcript segments', () => {
  const context = withTranscriptEvidence(videoContext({
    descriptionText: 'Description fallback remains visible.',
    parts: [],
    chapters: [],
  }));
  const [valid] = transcriptSegments();
  const result = buildVideoKnowledgeResult(context, {
    transcriptSegments: [
      valid,
      { ...valid, segmentId: 'transcript:bad:empty', text: '   ', startSeconds: 5, endSeconds: 6 },
      { ...valid, segmentId: 'transcript:bad:stale', stale: true, text: 'stale segment', startSeconds: 7, endSeconds: 8 },
      { ...valid, segmentId: 'transcript:bad:lang', language: 'en-US', text: 'wrong language', startSeconds: 9, endSeconds: 10 },
      { ...valid, segmentId: 'transcript:bad:time', text: 'bad time', startSeconds: 11, endSeconds: 11 },
    ],
    now: 3000,
  });

  const transcriptNodes = result.nodes.filter(node => node.source === 'transcript');
  assert.equal(transcriptNodes.length, 1);
  assert.equal(transcriptNodes[0].evidence?.segmentId, valid.segmentId);
});

test('marks pending subtitle probe as unknown source state', () => {
  const context = videoContext({
    descriptionText: null,
    parts: [],
    chapters: [],
  });
  context.sources.transcript = 'unknown';
  context.warnings = ['transcript_probe_pending'];
  const result = buildVideoKnowledgeResult(context, 1000);

  assert.equal(result.sourceState.transcript, false);
  assert.ok(result.warnings.includes('transcript_probe_pending'));
  assert.ok(result.limitations.some(item => item.includes('字幕来源尚未完成探测')));
});

test('builds page and chapter nodes with confirmed manual jump previews', () => {
  const result = buildVideoKnowledgeResult(videoContext({
    descriptionText: null,
    parts: [
      { page: 1, cid: 101, title: 'Intro', durationSeconds: 120 },
      { page: 2, cid: 102, title: 'Demo', durationSeconds: 300 },
    ],
    chapters: [
      { title: 'Setup', startSeconds: 45 },
      { title: 'Result', startSeconds: 180 },
    ],
  }), 1000);

  const pageNode = result.nodes.find(node => node.id.endsWith(':page:2'));
  const chapterNode = result.nodes.find(node => node.source === 'chapter' && node.timestamp === 45);

  assert.ok(pageNode);
  assert.equal(pageNode.sourceLabel, '分 P');
  assert.equal(pageNode.timestamp, 0);
  assert.equal(pageNode.jumpAction?.type, 'page');
  assert.equal(pageNode.jumpAction?.requiresConfirmation, true);
  assert.ok(pageNode.safetyFlags.includes('manual_confirm_required'));

  assert.ok(chapterNode);
  assert.equal(chapterNode.sourceLabel, '章节');
  assert.equal(chapterNode.jumpAction?.type, 'seek');
  assert.equal(chapterNode.jumpAction?.targetSeconds, 45);
  assert.equal(chapterNode.jumpAction?.requiresConfirmation, true);
  assert.ok(chapterNode.safetyFlags.includes('auto_jump_disabled'));
});

test('ignores chapters without real start seconds', () => {
  const result = buildVideoKnowledgeResult(videoContext({
    descriptionText: null,
    parts: [],
    chapters: [
      { title: 'No time', startSeconds: null },
    ],
  }), 1000);

  assert.equal(result.nodes.some(node => node.source === 'chapter'), false);
});

test('returns no-context fallback with no nodes', () => {
  const context: CurrentVideoContextResult = {
    kind: 'no_context',
    url: 'https://www.bilibili.com/',
    collectedAt: 1000,
    reason: 'non_video_page',
    pageType: 'non_video',
  };
  const result = buildVideoKnowledgeResult(context, 1000);

  assert.equal(result.status, 'no_context');
  assert.equal(result.nodes.length, 0);
  assert.equal(result.sourceState.metadata, false);
  assert.ok(result.limitations.some(item => item.includes('打开一个 B 站视频页')));
});

function videoContext(options: {
  descriptionText: string | null;
  parts: CurrentVideoContext['parts'];
  chapters: CurrentVideoContext['chapters'];
}): CurrentVideoContext {
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Knowledge00',
    collectedAt: 1000,
    bvid: 'BV1Knowledge00',
    cid: 101,
    title: 'Knowledge source video',
    authorName: 'Mock UP',
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: options.parts[0]?.title ?? null,
      total: options.parts.length || null,
    },
    parts: options.parts,
    chapters: options.chapters,
    description: {
      availability: options.descriptionText ? 'available' : 'unavailable',
      text: options.descriptionText,
      length: options.descriptionText?.length ?? null,
    },
    sources: {
      metadata: 'available',
      description: options.descriptionText ? 'available' : 'unavailable',
      pages: options.parts.length > 0 ? 'available' : 'unavailable',
      chapters: options.chapters.length > 0 ? 'available' : 'unknown',
      transcript: 'unavailable',
      contentText: 'unavailable',
    },
    warnings: ['transcript_unavailable'],
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
    coverageEndSeconds: 19,
    fetchedAt: 2000,
    updatedAt: 2000,
    reason: 'transcript_segments_cached',
    message: '已缓存字幕正文证据，仅作为本地证据状态展示。',
    warnings: [],
    ...overrides,
  };
  return context;
}

function transcriptSegments(): CurrentVideoTranscriptSegment[] {
  return [
    'first transcript point introduces the problem',
    'second transcript point explains the method',
    'third transcript point compares the result',
    'fourth transcript point closes the conclusion',
  ].map((text, index) => {
    const startSeconds = index * 5;
    const endSeconds = startSeconds + 4;
    return {
      segmentId: `transcript:BV1Knowledge00:101:1:zh-cn:hash123:${index}`,
      bvid: 'BV1Knowledge00',
      cid: 101,
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
