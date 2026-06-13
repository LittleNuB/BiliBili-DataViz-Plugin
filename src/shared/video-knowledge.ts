import type { CurrentVideoContext, CurrentVideoContextResult, CurrentVideoPart } from './types/current-video-context';
import type {
  VideoKnowledgeEvidence,
  VideoKnowledgeJumpAction,
  VideoKnowledgeNode,
  VideoKnowledgeResult,
  VideoKnowledgeSafetyFlag,
  VideoKnowledgeSource,
} from './types/video-knowledge';

const DESCRIPTION_EVIDENCE_LIMIT = 280;
const NODE_LIMIT = 16;

export function buildVideoKnowledgeResult(
  context: CurrentVideoContextResult,
  now = Date.now(),
): VideoKnowledgeResult {
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
        contentText: false,
      },
      nodes: [],
      warnings: ['no_current_video_context'],
      limitations: ['请先打开一个 B 站视频页，再生成视频知识节点。'],
    };
  }

  const nodes: VideoKnowledgeNode[] = [
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
      transcript: false,
      contentText: false,
    },
    nodes,
    warnings: Array.from(new Set([...context.warnings, 'transcript_unavailable'])),
    limitations: [
      '没有可用字幕，因此元数据和简介节点不代表完整视频理解。',
      '元数据和简介节点不会生成推测时间戳。',
      '跳转动作是手动预览动作，改变播放位置前必须由用户明确确认。',
    ],
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

function node(input: {
  id: string;
  context: CurrentVideoContext;
  page: number;
  cid?: number | null;
  timestamp?: number | null;
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
    endTimestamp: null,
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
