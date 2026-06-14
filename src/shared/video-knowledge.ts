import type { CurrentVideoContext, CurrentVideoContextResult, CurrentVideoPart } from './types/current-video-context';
import type { CurrentVideoTranscriptSegment } from './types/current-video-transcript';
import type {
  VideoKnowledgeEvidence,
  VideoKnowledgeJumpAction,
  VideoKnowledgeNode,
  VideoKnowledgeResult,
  VideoKnowledgeSafetyFlag,
  VideoKnowledgeSource,
} from './types/video-knowledge';

const DESCRIPTION_EVIDENCE_LIMIT = 280;
const TRANSCRIPT_EVIDENCE_LIMIT = 220;
const TRANSCRIPT_NODE_LIMIT = 6;
const NODE_LIMIT = 16;

export interface BuildVideoKnowledgeOptions {
  now?: number;
  transcriptSegments?: CurrentVideoTranscriptSegment[];
}

export function buildVideoKnowledgeResult(
  context: CurrentVideoContextResult,
  options: BuildVideoKnowledgeOptions | number = {},
): VideoKnowledgeResult {
  const now = typeof options === 'number' ? options : options.now ?? Date.now();
  const transcriptSegments = typeof options === 'number' ? undefined : options.transcriptSegments;

  if (context.kind !== 'video') {
    return {
      status: 'no_context',
      title: '没有当前视频上下文',
      generatedAt: now,
      sourceState: {
        metadata: false,
        description: false,
        pages: false,
        chapters: false,
        transcript: false,
        transcriptEvidence: false,
        contentText: false,
      },
      transcriptEvidence: null,
      nodes: [],
      warnings: ['no_current_video_context'],
      limitations: ['请先打开一个 B 站视频页，再生成视频知识节点。'],
    };
  }

  const transcriptNodes = buildTranscriptNodes(context, transcriptSegments, now);
  const nodes: VideoKnowledgeNode[] = [
    ...transcriptNodes,
    buildMetadataNode(context, now),
    ...buildDescriptionNodes(context, now),
    ...buildPageNodes(context, now),
    ...buildChapterNodes(context, now),
  ].slice(0, NODE_LIMIT);

  return {
    status: 'ready',
    title: context.title ?? context.bvid,
    generatedAt: now,
    sourceState: {
      metadata: context.sources.metadata === 'available',
      description: context.sources.description === 'available',
      pages: context.sources.pages === 'available',
      chapters: context.sources.chapters === 'available',
      transcript: context.sources.transcript === 'available',
      transcriptEvidence: context.transcriptEvidence?.active === true,
      contentText: false,
    },
    transcriptEvidence: context.transcriptEvidence ?? null,
    nodes,
    warnings: buildVideoKnowledgeWarnings(context, transcriptNodes.length),
    limitations: buildVideoKnowledgeLimitations(context, transcriptNodes.length),
  };
}

export function findVideoKnowledgeNode(
  result: VideoKnowledgeResult,
  nodeId: string,
): VideoKnowledgeNode | null {
  return result.nodes.find(node => node.id === nodeId) ?? null;
}

function buildMetadataNode(context: CurrentVideoContext, now: number): VideoKnowledgeNode {
  const partsLabel = context.currentPart.total && context.currentPart.total > 1
    ? `第 ${context.currentPart.page} / ${context.currentPart.total} P`
    : '单个可见视频页';
  const duration = context.durationSeconds ? `，时长 ${formatDuration(context.durationSeconds)}` : '';
  const creator = context.authorName ? `，UP 主 ${context.authorName}` : '';
  return node({
    id: `node:${context.bvid}:metadata`,
    context,
    page: context.currentPart.page,
    title: context.title ? `元数据：${context.title}` : '元数据辅助节点',
    reason: `仅基于可见元数据生成（${partsLabel}${creator}${duration}）。`,
    source: 'metadata',
    confidence: 0.34,
    evidence: evidence('metadata:visible', context.title ?? context.bvid),
    jumpAction: null,
    safetyFlags: ['metadata_only', 'no_transcript', 'low_confidence', 'auto_jump_disabled'],
    now,
  });
}

function buildDescriptionNodes(context: CurrentVideoContext, now: number): VideoKnowledgeNode[] {
  const text = normalizeText(context.description.text);
  if (context.sources.description !== 'available' || !text) return [];

  const excerpt = limitText(text, DESCRIPTION_EVIDENCE_LIMIT);
  return [
    node({
      id: `node:${context.bvid}:description`,
      context,
      page: context.currentPart.page,
      title: '简介辅助节点',
      reason: '仅基于可见视频简介生成；它不是字幕或正文内容证据。',
      source: 'description',
      confidence: text.length >= 80 ? 0.54 : 0.46,
      evidence: {
        textSpan: excerpt,
        startChar: 0,
        endChar: excerpt.length,
        language: null,
        sourceId: 'description:visible',
      },
      jumpAction: null,
      safetyFlags: ['description_only', 'no_transcript', 'auto_jump_disabled'],
      now,
    }),
  ];
}

function buildPageNodes(context: CurrentVideoContext, now: number): VideoKnowledgeNode[] {
  if (context.parts.length === 0) return [];

  return context.parts.map((part, index) => {
    const page = normalizePage(part, index);
    return node({
      id: `node:${context.bvid}:page:${page}`,
      context,
      page,
      cid: part.cid,
      timestamp: 0,
      title: part.title ? `P${page}: ${part.title}` : `P${page}`,
      reason: '基于 B 站分 P 列表生成；时间点只表示该分 P 的起始位置。',
      source: 'page',
      confidence: 0.74,
      evidence: evidence(`page:${page}`, part.title ?? `P${page}`),
      jumpAction: {
        type: 'page',
        targetSeconds: 0,
        targetPage: page,
        targetCid: part.cid,
        previewLabel: `跳到 P${page}${part.title ? `：${part.title}` : ''}`,
        requiresConfirmation: true,
        returnPointSeconds: null,
      },
      safetyFlags: ['page_bound', 'manual_confirm_required', 'auto_jump_disabled', 'no_transcript'],
      now,
    });
  });
}

function buildChapterNodes(context: CurrentVideoContext, now: number): VideoKnowledgeNode[] {
  return context.chapters
    .filter(chapter => Number.isFinite(chapter.startSeconds) && (chapter.startSeconds ?? -1) >= 0)
    .map((chapter, index) => {
      const startSeconds = Math.max(0, Math.floor(chapter.startSeconds ?? 0));
      return node({
        id: `node:${context.bvid}:chapter:${index}:${startSeconds}`,
        context,
        page: context.currentPart.page,
        timestamp: startSeconds,
        title: `章节：${chapter.title}`,
        reason: '基于可见章节起始时间生成，不推断章节标题之外的正文内容。',
        source: 'chapter',
        confidence: 0.82,
        evidence: evidence(`chapter:${index}:${startSeconds}`, chapter.title),
        jumpAction: {
          type: 'seek',
          targetSeconds: startSeconds,
          targetPage: context.currentPart.page,
          targetCid: context.cid,
          previewLabel: `跳到 ${formatDuration(startSeconds)}：${chapter.title}`,
          requiresConfirmation: true,
          returnPointSeconds: null,
        },
        safetyFlags: ['chapter_bound', 'manual_confirm_required', 'auto_jump_disabled', 'no_transcript'],
        now,
      });
    });
}

function buildTranscriptNodes(
  context: CurrentVideoContext,
  segments: CurrentVideoTranscriptSegment[] | undefined,
  now: number,
): VideoKnowledgeNode[] {
  const evidenceState = context.transcriptEvidence;
  if (
    !context.cid
    || evidenceState?.active !== true
    || !segments?.length
    || evidenceState.bvid !== context.bvid
    || evidenceState.cid !== context.cid
    || evidenceState.page !== context.currentPart.page
    || !evidenceState.sourceHash
  ) {
    return [];
  }

  const expectedLanguage = languageKey(evidenceState.language);
  const rows = segments
    .filter(segment =>
      segment.bvid === context.bvid
      && segment.cid === context.cid
      && segment.page === context.currentPart.page
      && !segment.stale
      && segment.sourceHash === evidenceState.sourceHash
      && (!evidenceState.language || languageKey(segment.language) === expectedLanguage)
      && Number.isFinite(segment.startSeconds)
      && Number.isFinite(segment.endSeconds)
      && segment.endSeconds > segment.startSeconds
      && Boolean(normalizeText(segment.text)),
    )
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);

  if (rows.length === 0) return [];

  return selectTranscriptNodeSegments(rows).map((segment, index) => {
    const text = limitText(segment.text, TRANSCRIPT_EVIDENCE_LIMIT);
    return node({
      id: `node:${segment.segmentId}`,
      context,
      page: context.currentPart.page,
      cid: segment.cid,
      timestamp: segment.startSeconds,
      endTimestamp: segment.endSeconds,
      title: transcriptNodeTitle(segment, text),
      reason: transcriptNodeReason(index, rows.length),
      source: 'transcript',
      confidence: transcriptConfidence(evidenceState, segment, rows.length),
      evidence: {
        textSpan: text,
        startChar: 0,
        endChar: text.length,
        language: segment.language,
        sourceId: segment.segmentId,
        segmentId: segment.segmentId,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        sourceHash: segment.sourceHash,
        sourceStatus: 'active',
      },
      jumpAction: null,
      safetyFlags: ['transcript_grounded', 'bounded_current_video', 'auto_jump_disabled'],
      now,
    });
  });
}

function selectTranscriptNodeSegments(
  rows: CurrentVideoTranscriptSegment[],
): CurrentVideoTranscriptSegment[] {
  if (rows.length <= TRANSCRIPT_NODE_LIMIT) return rows;
  const selectedIndexes = new Set<number>();
  for (let index = 0; index < TRANSCRIPT_NODE_LIMIT; index += 1) {
    selectedIndexes.add(Math.round(index * (rows.length - 1) / (TRANSCRIPT_NODE_LIMIT - 1)));
  }
  return Array.from(selectedIndexes)
    .sort((a, b) => a - b)
    .map(index => rows[index])
    .filter((segment): segment is CurrentVideoTranscriptSegment => Boolean(segment));
}

function transcriptNodeTitle(
  segment: CurrentVideoTranscriptSegment,
  text: string,
): string {
  const lead = transcriptLead(text);
  return lead
    ? `字幕节点 ${formatDuration(segment.startSeconds)}-${formatDuration(segment.endSeconds)}：${lead}`
    : `字幕节点 ${formatDuration(segment.startSeconds)}-${formatDuration(segment.endSeconds)}`;
}

function transcriptNodeReason(index: number, total: number): string {
  const ordinal = total > 1 ? `第 ${index + 1} 个` : '当前';
  return `${ordinal}字幕证据片段可作为关键节点候选；时间范围、证据编号和文字片段都来自当前视频本地缓存的有效字幕，不从简介或元数据推断时间点。`;
}

function transcriptConfidence(
  evidenceState: NonNullable<CurrentVideoContext['transcriptEvidence']>,
  segment: CurrentVideoTranscriptSegment,
  matchingSegmentCount: number,
): number {
  const textLength = normalizeText(segment.text).length;
  const duration = segment.endSeconds - segment.startSeconds;
  const coverage = typeof evidenceState.coverageStartSeconds === 'number'
    && typeof evidenceState.coverageEndSeconds === 'number'
    ? evidenceState.coverageEndSeconds - evidenceState.coverageStartSeconds
    : 0;

  let score = 0.62;
  if (textLength >= 24) score += 0.08;
  if (textLength >= 60) score += 0.05;
  if (duration >= 1 && duration <= 20) score += 0.05;
  if (matchingSegmentCount >= 6) score += 0.06;
  else if (matchingSegmentCount <= 2) score -= 0.08;
  if (coverage >= 120) score += 0.06;
  else if (coverage >= 30) score += 0.03;
  if (evidenceState.staleSegmentCount === 0) score += 0.04;
  else score -= 0.08;
  if (evidenceState.warnings.length > 0) score -= 0.04;

  return Math.round(Math.max(0.48, Math.min(0.92, score)) * 100) / 100;
}

function buildVideoKnowledgeWarnings(context: CurrentVideoContext, transcriptNodeCount: number): string[] {
  const warnings = new Set(context.warnings);
  if (transcriptNodeCount > 0) {
    warnings.add('transcript_nodes_generated');
    return Array.from(warnings);
  }

  if (context.sources.transcript === 'available') {
    warnings.add('transcript_source_available');
    warnings.add('transcript_nodes_not_generated');
  } else if (context.sources.transcript === 'unknown') {
    warnings.add('transcript_probe_pending');
  } else {
    warnings.add('transcript_unavailable');
  }
  if (context.transcriptEvidence?.active) {
    warnings.add('transcript_evidence_cached');
    warnings.add('transcript_evidence_segments_not_available_for_nodes');
  }
  return Array.from(warnings);
}

function buildVideoKnowledgeLimitations(context: CurrentVideoContext, transcriptNodeCount: number): string[] {
  if (transcriptNodeCount > 0) {
    return [
      '已基于当前视频本地缓存的有效字幕生成关键节点候选；每个时间范围只来自真实字幕片段。',
      '字幕节点目前只展示证据和时间范围，不新增自动跳转或新的时间点跳转能力。',
      '证据强度只反映字幕片段的完整度、匹配状态和本地证据质量，不代表视频质量。',
    ];
  }

  const transcriptLimitation = context.transcriptEvidence?.active
    ? '已缓存本地字幕正文证据，但当前没有可用于生成节点的匹配字幕片段；已回退到元数据、简介、分 P 或章节节点。'
    : context.sources.transcript === 'available'
    ? '已探测到字幕来源，但当前没有可引用的本地字幕正文片段；节点只使用元数据、简介、分 P 或章节。'
    : context.sources.transcript === 'unknown'
      ? '字幕来源尚未完成探测；当前节点只基于元数据、简介、分 P 或章节。'
      : '没有可用字幕，因此元数据和简介节点不代表完整视频理解。';

  return [
    transcriptLimitation,
    '元数据和简介节点不会生成推测时间戳。',
    '跳转动作是手动预览动作，改变播放位置前必须由用户明确确认。',
  ];
}

function node(input: {
  id: string;
  context: CurrentVideoContext;
  page: number;
  cid?: number | null;
  timestamp?: number | null;
  endTimestamp?: number | null;
  title: string;
  reason: string;
  source: VideoKnowledgeSource;
  confidence: number;
  evidence: VideoKnowledgeEvidence | null;
  jumpAction: VideoKnowledgeJumpAction | null;
  safetyFlags: VideoKnowledgeSafetyFlag[];
  now: number;
}): VideoKnowledgeNode {
  return {
    id: input.id,
    bvid: input.context.bvid,
    cid: input.cid ?? input.context.cid,
    page: input.page,
    timestamp: input.timestamp ?? null,
    endTimestamp: input.endTimestamp ?? null,
    title: limitText(input.title, 140),
    reason: limitText(input.reason, 260),
    source: input.source,
    sourceLabel: videoKnowledgeSourceLabel(input.source),
    confidence: Math.round(Math.max(0, Math.min(1, input.confidence)) * 100) / 100,
    evidence: input.evidence,
    jumpAction: input.jumpAction,
    safetyFlags: input.safetyFlags,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function evidence(sourceId: string, text: string): VideoKnowledgeEvidence {
  const value = limitText(text, DESCRIPTION_EVIDENCE_LIMIT);
  return {
    textSpan: value,
    startChar: 0,
    endChar: value.length,
    language: null,
    sourceId,
  };
}

function videoKnowledgeSourceLabel(source: VideoKnowledgeSource): string {
  switch (source) {
    case 'metadata':
      return '元数据';
    case 'description':
      return '简介';
    case 'page':
      return '分 P';
    case 'chapter':
      return '章节';
    case 'transcript':
      return '字幕';
    case 'user_bookmark':
      return '用户书签';
    case 'user_note':
      return '用户笔记';
    case 'local_watch_event':
      return '本地播放记录';
    case 'local_fallback':
      return '本地结果';
    default:
      return '本地来源';
  }
}

function normalizePage(part: CurrentVideoPart, index: number): number {
  return Number.isFinite(part.page) && part.page > 0 ? Math.floor(part.page) : index + 1;
}

function normalizeText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function limitText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function transcriptLead(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  const sentence = normalized.split(/(?<=[.!?。！？])\s*/u)[0] ?? normalized;
  return limitText(sentence, 42);
}

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}

export function formatVideoKnowledgeTime(seconds: number): string {
  return formatDuration(seconds);
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
