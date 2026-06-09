import type { CurrentVideoContext, CurrentVideoContextResult } from './types/current-video-context';
import type {
  CurrentVideoSummaryAiStatus,
  CurrentVideoSummaryEvidence,
  CurrentVideoSummaryResult,
  CurrentVideoSummarySourceTier,
} from './types/current-video-summary';

export interface LocalSummaryOptions {
  aiStatus?: CurrentVideoSummaryAiStatus;
  aiModel?: string | null;
  aiError?: string | null;
  aiNote?: string;
  now?: number;
}

const DESCRIPTION_EVIDENCE_LIMIT = 360;
const DESCRIPTION_AI_PAYLOAD_LIMIT = 1200;
const LIST_LIMIT = 6;

export function buildLocalCurrentVideoSummary(
  context: CurrentVideoContextResult,
  options: LocalSummaryOptions = {},
): CurrentVideoSummaryResult {
  const now = options.now ?? Date.now();
  if (context.kind !== 'video') {
    return {
      status: 'no_context',
      sourceTier: null,
      sourceTierLabel: null,
      confidence: 'low',
      generationMode: 'local_fallback',
      title: 'No current video context',
      summary: noContextSummary(context.reason),
      bullets: ['Open a Bilibili video page so Bili-Bill can read the current video metadata.'],
      evidence: [],
      missingSources: ['metadata', 'description', 'transcript', 'content text'],
      warnings: [],
      limitations: ['No video metadata is available for this tab.'],
      nextQuestions: [],
      ai: {
        status: options.aiStatus ?? 'not_requested',
        model: options.aiModel ?? null,
        error: options.aiError ?? null,
        note: options.aiNote ?? 'AI was not requested because no current video context is available.',
      },
      generatedAt: now,
    };
  }

  const tier = selectSourceTier(context);
  const confidence = tier === 'description_summary' && usefulDescriptionLength(context) >= 80 ? 'medium' : 'low';
  const evidence = buildEvidence(context, tier);
  const missingSources = buildMissingSources(context);
  const limitations = buildLimitations(context, tier);

  return {
    status: 'ready',
    sourceTier: tier,
    sourceTierLabel: sourceTierLabel(tier),
    confidence,
    generationMode: 'local_fallback',
    title: context.title ?? context.bvid,
    summary: buildSummarySentence(context, tier),
    bullets: buildSummaryBullets(context, tier),
    evidence,
    missingSources,
    warnings: Array.from(new Set(context.warnings)),
    limitations,
    nextQuestions: buildNextQuestions(tier),
    ai: {
      status: options.aiStatus ?? 'not_requested',
      model: options.aiModel ?? null,
      error: options.aiError ?? null,
      note: options.aiNote ?? localAiNote(options.aiStatus),
    },
    generatedAt: now,
  };
}

export function loadingCurrentVideoSummary(now = Date.now()): CurrentVideoSummaryResult {
  return {
    status: 'loading',
    sourceTier: null,
    sourceTierLabel: null,
    confidence: 'low',
    generationMode: 'local_fallback',
    title: 'Preparing current video summary',
    summary: 'Reading the current video context and checking whether AI generation is allowed.',
    bullets: [],
    evidence: [],
    missingSources: [],
    warnings: [],
    limitations: ['You can cancel this request; local evidence remains available after cancellation.'],
    nextQuestions: [],
    ai: {
      status: 'not_requested',
      model: null,
      error: null,
      note: 'Loading state before any AI request result is accepted.',
    },
    generatedAt: now,
  };
}

export function cancelledCurrentVideoSummary(
  context: CurrentVideoContextResult | null,
  now = Date.now(),
): CurrentVideoSummaryResult {
  if (context) {
    return {
      ...buildLocalCurrentVideoSummary(context, {
        aiStatus: 'not_requested',
        aiNote: 'The visible AI summary request was cancelled; this is the local evidence fallback.',
        now,
      }),
      status: 'cancelled',
    };
  }

  return {
    ...loadingCurrentVideoSummary(now),
    status: 'cancelled',
    title: 'Summary request cancelled',
    summary: 'The visible summary request was cancelled before a current video context was available.',
    limitations: ['No AI result was accepted after cancellation.'],
  };
}

export interface CurrentVideoSummaryAiPayload {
  intent: 'current_video_summary_v0';
  video: {
    bvid: string;
    cid: number | null;
    title: string | null;
    authorName: string | null;
    durationSeconds: number | null;
    currentPart: {
      page: number;
      title: string | null;
      total: number | null;
    };
    parts: Array<{
      page: number;
      cid: number | null;
      title: string | null;
      durationSeconds: number | null;
    }>;
    chapters: Array<{
      title: string;
      startSeconds: number | null;
    }>;
    description: {
      availability: string;
      text: string | null;
      length: number | null;
    };
  };
  availableSources: {
    metadata: string;
    description: string;
    pages: string;
    chapters: string;
    transcript: string;
    contentText: string;
  };
  sourceTier: 'metadata summary' | 'description summary';
  warnings: string[];
  safetyRules: string[];
}

export function buildCurrentVideoSummaryAiPayload(
  context: CurrentVideoContext,
): CurrentVideoSummaryAiPayload {
  const tier = selectSourceTier(context);
  return {
    intent: 'current_video_summary_v0',
    video: {
      bvid: context.bvid,
      cid: context.cid,
      title: limitNullableText(context.title, 160),
      authorName: limitNullableText(context.authorName, 80),
      durationSeconds: context.durationSeconds,
      currentPart: {
        page: context.currentPart.page,
        title: limitNullableText(context.currentPart.title, 120),
        total: context.currentPart.total,
      },
      parts: context.parts.slice(0, LIST_LIMIT).map(part => ({
        page: part.page,
        cid: part.cid,
        title: limitNullableText(part.title, 120),
        durationSeconds: part.durationSeconds,
      })),
      chapters: context.chapters.slice(0, LIST_LIMIT).map(chapter => ({
        title: limitText(chapter.title, 120),
        startSeconds: chapter.startSeconds,
      })),
      description: {
        availability: context.description.availability,
        text: tier === 'description_summary'
          ? limitNullableText(context.description.text, DESCRIPTION_AI_PAYLOAD_LIMIT)
          : null,
        length: context.description.length,
      },
    },
    availableSources: {
      metadata: context.sources.metadata,
      description: context.sources.description,
      pages: context.sources.pages,
      chapters: context.sources.chapters,
      transcript: context.sources.transcript,
      contentText: context.sources.contentText,
    },
    sourceTier: sourceTierLabel(tier),
    warnings: Array.from(new Set(context.warnings)).slice(0, 12),
    safetyRules: [
      'Do not claim a full-video summary because transcript and content text are unavailable.',
      'Do not infer body content beyond visible metadata, description, page titles, or chapter titles.',
      'Return the same source tier provided in sourceTier.',
    ],
  };
}

function selectSourceTier(context: CurrentVideoContext): CurrentVideoSummarySourceTier {
  return context.sources.description === 'available' && Boolean(context.description.text?.trim())
    ? 'description_summary'
    : 'metadata_summary';
}

function sourceTierLabel(tier: CurrentVideoSummarySourceTier): 'metadata summary' | 'description summary' {
  return tier === 'description_summary' ? 'description summary' : 'metadata summary';
}

function usefulDescriptionLength(context: CurrentVideoContext): number {
  return context.description.text?.trim().length ?? 0;
}

function buildSummarySentence(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string {
  const title = context.title ?? context.bvid;
  const author = context.authorName ? ` by ${context.authorName}` : '';
  if (tier === 'description_summary') {
    return `Description summary: based on the visible description and metadata, "${title}"${author} appears to center on ${descriptionLead(context.description.text)}.`;
  }
  return `Metadata summary: based only on visible metadata, "${title}"${author} can be described by its title, creator, duration, and available page or chapter labels.`;
}

function buildSummaryBullets(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string[] {
  const bullets: string[] = [];
  if (context.authorName) bullets.push(`Creator shown in metadata: ${context.authorName}.`);
  if (context.durationSeconds) bullets.push(`Visible duration: ${formatDuration(context.durationSeconds)}.`);
  if (context.currentPart.total && context.currentPart.total > 1) {
    bullets.push(`Current part: ${context.currentPart.page} of ${context.currentPart.total}${context.currentPart.title ? `, "${context.currentPart.title}"` : ''}.`);
  }
  if (context.parts.length > 1) {
    bullets.push(`Page labels are available for ${context.parts.length} parts, so navigation context is stronger than a single title.`);
  }
  if (context.chapters.length > 0) {
    bullets.push(`Chapter labels are available, but they are treated as structure labels, not transcript evidence.`);
  }
  if (tier === 'description_summary' && context.description.text) {
    bullets.unshift(`The description says: ${limitText(context.description.text, 180)}`);
  }
  if (bullets.length === 0) {
    bullets.push('Only the BVID and basic page context are available.');
  }
  return bullets.slice(0, 5);
}

function buildEvidence(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): CurrentVideoSummaryEvidence[] {
  const evidence: CurrentVideoSummaryEvidence[] = [
    { source: 'metadata', label: 'BVID', value: context.bvid },
  ];
  if (context.title) evidence.push({ source: 'metadata', label: 'Title', value: context.title });
  if (context.authorName) evidence.push({ source: 'metadata', label: 'Creator', value: context.authorName });
  if (context.durationSeconds) evidence.push({ source: 'metadata', label: 'Duration', value: formatDuration(context.durationSeconds) });
  if (context.currentPart.title) evidence.push({ source: 'page', label: 'Current part', value: context.currentPart.title });
  if (context.parts.length > 0) evidence.push({ source: 'page', label: 'Parts', value: String(context.parts.length) });
  if (context.chapters.length > 0) {
    evidence.push({
      source: 'chapter',
      label: 'Chapters',
      value: context.chapters.slice(0, 3).map(chapter => chapter.title).join(', '),
    });
  }
  if (tier === 'description_summary' && context.description.text) {
    evidence.push({
      source: 'description',
      label: 'Description excerpt',
      value: limitText(context.description.text, DESCRIPTION_EVIDENCE_LIMIT),
    });
  }
  evidence.push({
    source: 'local_fallback',
    label: 'Source boundary',
    value: 'Description and content text are different source tiers; content text remains unavailable.',
  });
  return evidence;
}

function buildMissingSources(context: CurrentVideoContext): string[] {
  const missing: string[] = [];
  if (context.sources.description !== 'available') missing.push('description');
  if (context.sources.transcript !== 'available') missing.push('transcript');
  if (context.sources.contentText !== 'available') missing.push('content text');
  if (context.sources.pages !== 'available') missing.push('page labels');
  if (context.sources.chapters !== 'available') missing.push('chapters');
  return missing;
}

function buildLimitations(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string[] {
  const limitations = [
    'No transcript is available, so this is not a full video summary and does not claim to understand the complete video body.',
    'Full content text is unavailable; the description is not treated as body content.',
  ];
  if (tier === 'metadata_summary') {
    limitations.unshift('Only metadata is available, so the summary is low confidence and topic-level.');
  } else {
    limitations.unshift('The summary uses the visible description plus metadata, but not transcript or full content text.');
  }
  if (context.sources.chapters === 'available') {
    limitations.push('Chapter labels can describe structure only; they are not expanded into body claims.');
  }
  return limitations;
}

function buildNextQuestions(tier: CurrentVideoSummarySourceTier): string[] {
  return tier === 'description_summary'
    ? ['Show only description highlights', 'Find related favorites']
    : ['Refresh current video metadata', 'Find related favorites'];
}

function noContextSummary(reason: string): string {
  if (reason === 'non_video_page') return 'This tab is not a Bilibili video page.';
  if (reason === 'video_context_unavailable') return 'The current Bilibili video context is still unavailable.';
  return 'No current video context is available.';
}

function descriptionLead(text: string | null): string {
  const normalized = normalizeText(text);
  if (!normalized) return 'the text visible in the description';
  const sentence = normalized.split(/(?<=[.!?。！？])\s+/u)[0] ?? normalized;
  return limitText(sentence, 180);
}

function localAiNote(status?: CurrentVideoSummaryAiStatus): string {
  switch (status) {
    case 'disabled':
      return 'AI summaries are disabled, so this is a local evidence fallback.';
    case 'not_configured':
      return 'AI summaries are enabled but no API key is configured, so this is a local evidence fallback.';
    case 'failed':
      return 'AI generation failed; local evidence fallback is shown.';
    case 'low_confidence':
      return 'AI returned low confidence; local evidence fallback is shown.';
    default:
      return 'Local evidence fallback; AI was not requested.';
  }
}

function limitNullableText(value: string | null, maxLength: number): string | null {
  return value ? limitText(value, maxLength) : null;
}

function limitText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
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
