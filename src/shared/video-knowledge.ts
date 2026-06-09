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
      title: 'No current video context',
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
      limitations: ['Open a Bilibili video page before generating video knowledge nodes.'],
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
      'No transcript is available, so metadata and description nodes do not represent full-video understanding.',
      'Metadata and description nodes never include generated timestamps.',
      'Jump actions are manual preview actions and require explicit confirmation before changing playback.',
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
    ? `Part ${context.currentPart.page} of ${context.currentPart.total}`
    : 'Single visible video page';
  const duration = context.durationSeconds ? `, duration ${formatDuration(context.durationSeconds)}` : '';
  const creator = context.authorName ? `, creator ${context.authorName}` : '';
  return node({
    id: `node:${context.bvid}:metadata`,
    context,
    page: context.currentPart.page,
    title: context.title ? `Metadata: ${context.title}` : 'Metadata helper',
    reason: `Built only from visible metadata (${partsLabel}${creator}${duration}).`,
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
      title: 'Description helper',
      reason: 'Built from the visible video description only; it is not transcript or body-content evidence.',
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
      reason: 'Built from the Bilibili page/part list. The timestamp is only the start of that part.',
      source: 'page',
      confidence: 0.74,
      evidence: evidence(`page:${page}`, part.title ?? `P${page}`),
      jumpAction: {
        type: 'page',
        targetSeconds: 0,
        targetPage: page,
        targetCid: part.cid,
        previewLabel: `Jump to P${page}${part.title ? `: ${part.title}` : ''}`,
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
        title: `Chapter: ${chapter.title}`,
        reason: 'Built from a visible chapter start time. It does not infer content beyond the chapter label.',
        source: 'chapter',
        confidence: 0.82,
        evidence: evidence(`chapter:${index}:${startSeconds}`, chapter.title),
        jumpAction: {
          type: 'seek',
          targetSeconds: startSeconds,
          targetPage: context.currentPart.page,
          targetCid: context.cid,
          previewLabel: `Jump to ${formatDuration(startSeconds)}: ${chapter.title}`,
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
    sourceLabel: input.source,
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
