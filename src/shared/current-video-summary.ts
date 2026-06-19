import type { CurrentVideoContext, CurrentVideoContextResult } from './types/current-video-context';
import type {
  CurrentVideoSummaryAiStatus,
  CurrentVideoSummaryEvidence,
  CurrentVideoSummaryResult,
  CurrentVideoSummarySourceTier,
  CurrentVideoSummaryTimestampRange,
} from './types/current-video-summary';
import type { CurrentVideoTranscriptSegment } from './types/current-video-transcript';

export interface LocalSummaryOptions {
  aiStatus?: CurrentVideoSummaryAiStatus;
  aiModel?: string | null;
  aiError?: string | null;
  aiNote?: string;
  transcriptSegments?: CurrentVideoTranscriptSegment[];
  now?: number;
}

const DESCRIPTION_EVIDENCE_LIMIT = 360;
const DESCRIPTION_AI_PAYLOAD_LIMIT = 1200;
const LIST_LIMIT = 6;
const TRANSCRIPT_CHUNK_LIMIT = 8;
const TRANSCRIPT_CHUNK_TEXT_LIMIT = 900;
const TRANSCRIPT_SEGMENT_TEXT_LIMIT = 260;
const TRANSCRIPT_EVIDENCE_LIMIT = 220;
const TRANSCRIPT_BULLET_LIMIT = 5;
const LOW_TRANSCRIPT_SEGMENT_COUNT = 3;

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
      title: '没有当前视频上下文',
      summary: noContextSummary(context.reason),
      bullets: ['请打开一个 B 站视频页，Bili-Bill 才能读取当前视频元数据。'],
      evidence: [],
      timestampRanges: [],
      missingSources: ['元数据', '简介', '字幕', '正文文本'],
      warnings: [],
      limitations: ['当前标签页没有可用的视频元数据。'],
      nextQuestions: [],
      ai: {
        status: options.aiStatus ?? 'not_requested',
        model: options.aiModel ?? null,
        error: options.aiError ?? null,
        note: options.aiNote ?? '没有当前视频上下文，因此没有请求 AI。',
      },
      generatedAt: now,
    };
  }

  const transcriptChunks = buildTranscriptSummaryChunks(context, options.transcriptSegments);
  const tier = transcriptChunks.length > 0 ? 'transcript_summary' : selectSourceTier(context);
  const confidence = buildSummaryConfidence(context, tier, transcriptChunks);
  const transcriptRanges = buildTranscriptTimestampRanges(transcriptChunks);
  const evidence = buildEvidence(context, tier, transcriptChunks);
  const missingSources = buildMissingSources(context, tier);
  const limitations = buildLimitations(context, tier);

  return {
    status: 'ready',
    sourceTier: tier,
    sourceTierLabel: sourceTierLabel(tier),
    confidence,
    generationMode: 'local_fallback',
    title: context.title ?? context.bvid,
    summary: buildSummarySentence(context, tier, transcriptChunks),
    bullets: buildSummaryBullets(context, tier, transcriptChunks),
    evidence,
    timestampRanges: transcriptRanges,
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
    title: '正在准备当前视频摘要',
    summary: '正在读取当前视频上下文，并检查是否允许 AI 生成。',
    bullets: [],
    evidence: [],
    timestampRanges: [],
    missingSources: [],
    warnings: [],
    limitations: ['你可以取消本次请求；取消后仍会保留本地证据结果。'],
    nextQuestions: [],
    ai: {
      status: 'not_requested',
      model: null,
      error: null,
      note: '正在等待 AI 请求结果被确认。',
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
        aiNote: '可见的 AI 摘要请求已取消；当前显示本地证据结果。',
        now,
      }),
      status: 'cancelled',
    };
  }

  return {
    ...loadingCurrentVideoSummary(now),
    status: 'cancelled',
    title: '摘要请求已取消',
    summary: '当前视频上下文可用前，摘要请求已被取消。',
    limitations: ['取消后没有采用任何 AI 结果。'],
  };
}

export interface CurrentVideoSummaryChunkSegment {
  segmentId: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface CurrentVideoSummaryTranscriptChunk {
  chunkId: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  segmentIds: string[];
  segments: CurrentVideoSummaryChunkSegment[];
  language: string | null;
}

interface CurrentVideoSummaryAiPayloadBase {
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
  sourceTier: 'metadata summary' | 'description summary' | 'transcript summary';
  warnings: string[];
  safetyRules: string[];
}

export interface CurrentVideoSummaryMetadataAiPayload extends CurrentVideoSummaryAiPayloadBase {
  intent: 'current_video_summary_v0';
}

export interface CurrentVideoSummaryTranscriptAiPayload extends CurrentVideoSummaryAiPayloadBase {
  intent: 'current_video_transcript_summary_v1';
  transcript: {
    language: string | null;
    coverageStartSeconds: number;
    coverageEndSeconds: number;
    providedChunkCount: number;
    providedSegmentCount: number;
    chunks: CurrentVideoSummaryTranscriptChunk[];
  };
}

export type CurrentVideoSummaryAiPayload =
  | CurrentVideoSummaryMetadataAiPayload
  | CurrentVideoSummaryTranscriptAiPayload;

export function buildCurrentVideoSummaryAiPayload(
  context: CurrentVideoContext,
  options: { transcriptSegments?: CurrentVideoTranscriptSegment[] } = {},
): CurrentVideoSummaryAiPayload {
  const transcriptChunks = buildTranscriptSummaryChunks(context, options.transcriptSegments);
  const tier = transcriptChunks.length > 0 ? 'transcript_summary' : selectSourceTier(context);
  const base = {
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
        text: tier === 'description_summary' || tier === 'transcript_summary'
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
    sourceTier: payloadSourceTierLabel(tier),
    warnings: Array.from(new Set(context.warnings)).slice(0, 12),
  } satisfies Omit<CurrentVideoSummaryAiPayloadBase, 'safetyRules'>;

  if (tier === 'transcript_summary') {
    const allSegments = transcriptChunks.flatMap(chunk => chunk.segments);
    return {
      ...base,
      intent: 'current_video_transcript_summary_v1',
      transcript: {
        language: transcriptChunks[0]?.language ?? null,
        coverageStartSeconds: transcriptChunks[0]?.startSeconds ?? 0,
        coverageEndSeconds: transcriptChunks.reduce(
          (max, chunk) => Math.max(max, chunk.endSeconds),
          transcriptChunks[0]?.endSeconds ?? 0,
        ),
        providedChunkCount: transcriptChunks.length,
        providedSegmentCount: allSegments.length,
        chunks: transcriptChunks,
      },
      safetyRules: [
        'Summarize only the provided current-video transcript chunks and metadata.',
        'Do not add segment IDs or timestamps that are not present in this payload.',
        'If evidence is weak, keep confidence low and say the result is based on bounded subtitle evidence.',
      ],
    };
  }

  return {
    ...base,
    intent: 'current_video_summary_v0',
    safetyRules: [
      'Do not claim a full-video summary because this payload does not contain transcript segments or content text.',
      'If availableSources.transcript is available, treat it only as source availability metadata; no transcript text was provided.',
      'Do not infer body content beyond visible metadata, description, page titles, or chapter titles.',
      'Return the same source tier provided in sourceTier.',
    ],
  };
}

export interface CurrentVideoSummaryAiCandidate {
  summary?: unknown;
  bullets?: unknown;
  confidence?: unknown;
}

export type CurrentVideoSummaryAiValidation =
  | { ok: true; summary: string; bullets: string[]; confidence: number }
  | { ok: false; reason: string; error: string };

export function validateCurrentVideoSummaryAiOutput(
  ai: CurrentVideoSummaryAiCandidate,
  payload: CurrentVideoSummaryAiPayload,
  fallback: Pick<CurrentVideoSummaryResult, 'summary' | 'bullets'>,
): CurrentVideoSummaryAiValidation {
  const normalized = normalizeAiSummaryCandidate(ai, fallback);
  const references = collectAiReferences(ai);
  const bounds = payload.intent === 'current_video_transcript_summary_v1'
    ? transcriptPayloadBounds(payload)
    : { segmentIds: new Set<string>(), timestamps: new Set<number>(), timestampLabels: new Set<string>() };

  for (const segmentId of references.segmentIds) {
    if (!bounds.segmentIds.has(segmentId)) {
      return {
        ok: false,
        reason: 'segment_out_of_payload',
        error: `AI_SEGMENT_OUT_OF_PAYLOAD:${segmentId}`,
      };
    }
  }

  for (const timestamp of references.timestamps) {
    if (!bounds.timestamps.has(roundTimestamp(timestamp))) {
      return {
        ok: false,
        reason: 'timestamp_out_of_payload',
        error: `AI_TIMESTAMP_OUT_OF_PAYLOAD:${timestamp}`,
      };
    }
  }

  for (const label of references.timestampLabels) {
    if (!bounds.timestampLabels.has(label)) {
      return {
        ok: false,
        reason: 'timestamp_label_out_of_payload',
        error: `AI_TIMESTAMP_OUT_OF_PAYLOAD:${label}`,
      };
    }
  }

  return { ok: true, ...normalized };
}

export function buildTranscriptSummaryChunks(
  context: CurrentVideoContext,
  segments: CurrentVideoTranscriptSegment[] | undefined,
): CurrentVideoSummaryTranscriptChunk[] {
  if (!context.transcriptEvidence?.active || !context.cid || !segments?.length) return [];
  const evidence = context.transcriptEvidence;
  const expectedLanguage = languageKey(evidence.language);
  const expectedSourceHash = evidence.sourceHash;
  const rows = segments
    .filter(segment =>
      segment.bvid === context.bvid
      && segment.cid === context.cid
      && segment.page === context.currentPart.page
      && !segment.stale
      && (!expectedSourceHash || segment.sourceHash === expectedSourceHash)
      && (!evidence.language || languageKey(segment.language) === expectedLanguage)
      && Number.isFinite(segment.startSeconds)
      && Number.isFinite(segment.endSeconds)
      && segment.endSeconds > segment.startSeconds
      && Boolean(normalizeText(segment.text)),
    )
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);

  if (rows.length === 0) return [];

  const chunks: CurrentVideoSummaryTranscriptChunk[] = [];
  let current: CurrentVideoSummaryTranscriptChunk | null = null;

  for (const segment of rows) {
    const segmentText = limitText(segment.text, TRANSCRIPT_SEGMENT_TEXT_LIMIT);
    const chunkSegment: CurrentVideoSummaryChunkSegment = {
      segmentId: segment.segmentId,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segmentText,
    };
    const nextText = current ? `${current.text} ${segmentText}` : segmentText;
    if (current && nextText.length > TRANSCRIPT_CHUNK_TEXT_LIMIT) {
      chunks.push(current);
      current = null;
    }

    if (!current) {
      current = {
        chunkId: '',
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segmentText,
        segmentIds: [segment.segmentId],
        segments: [chunkSegment],
        language: segment.language,
      };
      continue;
    }

    current.endSeconds = segment.endSeconds;
    current.text = nextText;
    current.segmentIds.push(segment.segmentId);
    current.segments.push(chunkSegment);
  }

  if (current) chunks.push(current);

  return selectBoundedTranscriptChunks(chunks).map((chunk, index) => ({
    ...chunk,
    chunkId: `chunk-${index + 1}`,
  }));
}

function selectBoundedTranscriptChunks(
  chunks: CurrentVideoSummaryTranscriptChunk[],
): CurrentVideoSummaryTranscriptChunk[] {
  if (chunks.length <= TRANSCRIPT_CHUNK_LIMIT) return chunks;
  const selectedIndexes = new Set<number>();
  for (let index = 0; index < TRANSCRIPT_CHUNK_LIMIT; index += 1) {
    selectedIndexes.add(Math.round(index * (chunks.length - 1) / (TRANSCRIPT_CHUNK_LIMIT - 1)));
  }
  return Array.from(selectedIndexes)
    .sort((a, b) => a - b)
    .map(index => chunks[index])
    .filter((chunk): chunk is CurrentVideoSummaryTranscriptChunk => Boolean(chunk));
}

function buildTranscriptTimestampRanges(
  chunks: CurrentVideoSummaryTranscriptChunk[],
): CurrentVideoSummaryTimestampRange[] {
  return chunks.map(chunk => ({
    startSeconds: chunk.startSeconds,
    endSeconds: chunk.endSeconds,
    label: `${formatDuration(chunk.startSeconds)}-${formatDuration(chunk.endSeconds)}`,
    evidenceSnippet: limitText(chunk.text, TRANSCRIPT_EVIDENCE_LIMIT),
    segmentIds: chunk.segmentIds,
    language: chunk.language,
  }));
}

function selectSourceTier(context: CurrentVideoContext): CurrentVideoSummarySourceTier {
  return context.sources.description === 'available' && Boolean(context.description.text?.trim())
    ? 'description_summary'
    : 'metadata_summary';
}

function sourceTierLabel(tier: CurrentVideoSummarySourceTier): '元数据摘要' | '简介摘要' | '字幕正文摘要' {
  if (tier === 'transcript_summary') return '字幕正文摘要';
  return tier === 'description_summary' ? '简介摘要' : '元数据摘要';
}

function payloadSourceTierLabel(tier: CurrentVideoSummarySourceTier): 'metadata summary' | 'description summary' | 'transcript summary' {
  if (tier === 'transcript_summary') return 'transcript summary';
  return tier === 'description_summary' ? 'description summary' : 'metadata summary';
}

function usefulDescriptionLength(context: CurrentVideoContext): number {
  return context.description.text?.trim().length ?? 0;
}

function buildSummaryConfidence(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
  transcriptChunks: CurrentVideoSummaryTranscriptChunk[],
): 'low' | 'medium' | 'high' {
  if (tier === 'transcript_summary') {
    const segmentCount = transcriptChunks.reduce((count, chunk) => count + chunk.segments.length, 0);
    const coverage = transcriptChunks.reduce(
      (max, chunk) => Math.max(max, chunk.endSeconds),
      transcriptChunks[0]?.endSeconds ?? 0,
    ) - (transcriptChunks[0]?.startSeconds ?? 0);
    if (segmentCount >= 12 && coverage >= 90) return 'high';
    if (segmentCount >= LOW_TRANSCRIPT_SEGMENT_COUNT) return 'medium';
    return 'low';
  }
  return tier === 'description_summary' && usefulDescriptionLength(context) >= 80 ? 'medium' : 'low';
}

function buildSummarySentence(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
  transcriptChunks: CurrentVideoSummaryTranscriptChunk[],
): string {
  const title = context.title ?? context.bvid;
  const author = context.authorName ? `，UP 主：${context.authorName}` : '';
  if (tier === 'transcript_summary') {
    const first = transcriptChunks[0];
    const last = transcriptChunks[transcriptChunks.length - 1];
    const range = first && last ? `${formatDuration(first.startSeconds)}-${formatDuration(last.endSeconds)}` : '可引用范围';
    const lead = first ? transcriptLead(first.text) : '已缓存的字幕正文证据';
    return `基于本地缓存的字幕正文证据，《${title}》${author}在 ${range} 的可引用片段中主要围绕：${lead}。`;
  }
  if (tier === 'description_summary') {
    return `基于可见简介和元数据，《${title}》${author}大致围绕：${descriptionLead(context.description.text)}。`;
  }
  return `仅基于可见元数据，《${title}》${author}。目前只能从标题、UP 主、时长，以及可用的分 P 或章节标题判断主题。`;
}

function buildSummaryBullets(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
  transcriptChunks: CurrentVideoSummaryTranscriptChunk[],
): string[] {
  if (tier === 'transcript_summary') {
    const bullets = transcriptChunks.slice(0, TRANSCRIPT_BULLET_LIMIT).map(chunk =>
      `${formatDuration(chunk.startSeconds)}-${formatDuration(chunk.endSeconds)}：${transcriptLead(chunk.text)}`,
    );
    if (context.description.text) {
      bullets.push(`简介仍只作为辅助背景：${limitText(context.description.text, 140)}`);
    }
    return bullets.slice(0, TRANSCRIPT_BULLET_LIMIT);
  }

  const bullets: string[] = [];
  if (context.authorName) bullets.push(`元数据显示 UP 主：${context.authorName}。`);
  if (context.durationSeconds) bullets.push(`可见时长：${formatDuration(context.durationSeconds)}。`);
  if (context.currentPart.total && context.currentPart.total > 1) {
    bullets.push(`当前分 P：第 ${context.currentPart.page} / ${context.currentPart.total} P${context.currentPart.title ? `，「${context.currentPart.title}」` : ''}。`);
  }
  if (context.parts.length > 1) {
    bullets.push(`可见 ${context.parts.length} 个分 P 标题，导航上下文比单个标题更充分。`);
  }
  if (context.chapters.length > 0) {
    bullets.push('检测到章节标题，但它们只作为结构标签，不当作字幕证据。');
  }
  if (tier === 'description_summary' && context.description.text) {
    bullets.unshift(`简介写到：${limitText(context.description.text, 180)}`);
  }
  if (bullets.length === 0) {
    bullets.push('当前只有 BVID 和基础页面上下文可用。');
  }
  return bullets.slice(0, 5);
}

function buildEvidence(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
  transcriptChunks: CurrentVideoSummaryTranscriptChunk[],
): CurrentVideoSummaryEvidence[] {
  const evidence: CurrentVideoSummaryEvidence[] = [
    { source: 'metadata', label: 'BVID', value: context.bvid },
  ];
  if (context.title) evidence.push({ source: 'metadata', label: '标题', value: context.title });
  if (context.authorName) evidence.push({ source: 'metadata', label: 'UP 主', value: context.authorName });
  if (context.durationSeconds) evidence.push({ source: 'metadata', label: '时长', value: formatDuration(context.durationSeconds) });
  if (context.currentPart.title) evidence.push({ source: 'page', label: '当前分 P', value: context.currentPart.title });
  if (context.parts.length > 0) evidence.push({ source: 'page', label: '分 P 数量', value: String(context.parts.length) });
  if (context.chapters.length > 0) {
    evidence.push({
      source: 'chapter',
      label: '章节',
      value: context.chapters.slice(0, 3).map(chapter => chapter.title).join('、'),
    });
  }
  if (tier === 'description_summary' && context.description.text) {
    evidence.push({
      source: 'description',
      label: '简介摘录',
      value: limitText(context.description.text, DESCRIPTION_EVIDENCE_LIMIT),
    });
  }
  if (tier === 'transcript_summary') {
    for (const chunk of transcriptChunks.slice(0, TRANSCRIPT_BULLET_LIMIT)) {
      evidence.push({
        source: 'transcript',
        label: `证据片段 ${formatDuration(chunk.startSeconds)}-${formatDuration(chunk.endSeconds)}`,
        value: limitText(chunk.text, TRANSCRIPT_EVIDENCE_LIMIT),
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        segmentIds: chunk.segmentIds,
        language: chunk.language,
      });
    }
    evidence.push({
      source: 'local_fallback',
      label: '证据说明',
      value: '摘要基于当前视频本地缓存的字幕正文证据；未使用弹幕、评论、画面识别或其他本地账本数据。',
    });
    return evidence;
  }
  evidence.push({
    source: 'local_fallback',
    label: '来源边界',
    value: '简介和正文文本是不同来源层级；当前正文文本不可用。',
  });
  if (context.subtitleProbe) {
    evidence.push({
      source: 'local_fallback',
      label: '字幕来源探测',
      value: context.subtitleProbe.message,
    });
  }
  if (context.transcriptEvidence && context.transcriptEvidence.status !== 'missing') {
    evidence.push({
      source: 'local_fallback',
      label: '字幕正文证据缓存',
      value: context.transcriptEvidence.message,
    });
  }
  return evidence;
}

function buildMissingSources(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string[] {
  const missing: string[] = [];
  if (context.sources.description !== 'available') missing.push('简介');
  if (tier === 'transcript_summary') {
    missing.push('弹幕', '评论', '画面识别');
  } else if (context.sources.transcript === 'unknown') {
    missing.push('字幕来源探测');
  } else if (context.sources.transcript !== 'available') {
    missing.push('字幕');
  }
  if (tier !== 'transcript_summary' && context.sources.contentText !== 'available') {
    missing.push(context.sources.transcript === 'available' ? '字幕正文/正文文本' : '正文文本');
  }
  if (context.sources.pages !== 'available') missing.push('分 P 标题');
  if (context.sources.chapters !== 'available') missing.push('章节');
  return missing;
}

function buildLimitations(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string[] {
  if (tier === 'transcript_summary') {
    const limitations = [
      '本结果基于当前视频本地缓存的字幕正文证据，不包含弹幕、评论、画面识别或完整本地账本。',
      '时间范围只来自已缓存字幕片段；不会生成字幕证据之外的时间戳。',
    ];
    if (context.transcriptEvidence?.status && context.transcriptEvidence.status !== 'cached') {
      limitations.push(context.transcriptEvidence.message);
    }
    return limitations;
  }

  const limitations = [
    transcriptLimitation(context),
    '完整正文文本不可用；简介不会被当作正文内容。',
  ];
  if (tier === 'metadata_summary') {
    limitations.unshift('当前只有元数据可用，因此摘要置信度较低，只能判断主题层面。');
  } else {
    limitations.unshift('摘要使用可见简介和元数据，但不包含字幕或完整正文文本。');
  }
  if (context.sources.chapters === 'available') {
    limitations.push('章节标题只能说明结构，不会被扩展成正文内容判断。');
  }
  return limitations;
}

function transcriptLimitation(context: CurrentVideoContext): string {
  if (context.transcriptEvidence?.active) {
    return '已发现本地字幕正文证据状态，但当前摘要请求没有拿到可引用字幕片段；因此仍显示元数据或简介结果，不会声称完整理解视频正文。';
  }

  if (context.sources.transcript === 'available') {
    return '已探测到字幕来源，但没有可引用的本地字幕正文片段；因此这仍不是完整视频总结。';
  }

  if (context.sources.transcript === 'unknown') {
    return '字幕来源尚未完成探测；当前只能使用元数据和简介作为本地证据兜底，不能做完整视频总结。';
  }

  if (context.subtitleProbe?.message) {
    return `${context.subtitleProbe.message} 因此这不是完整视频总结，也不会声称理解了完整视频正文。`;
  }

  return '没有可用字幕，因此这不是完整视频总结，也不会声称理解了完整视频正文。';
}

function buildNextQuestions(tier: CurrentVideoSummarySourceTier): string[] {
  if (tier === 'transcript_summary') {
    return ['展开证据片段', '刷新字幕正文证据'];
  }
  return tier === 'description_summary'
    ? ['只看简介重点', '查找相关收藏']
    : ['刷新当前视频元数据', '查找相关收藏'];
}

function noContextSummary(reason: string): string {
  if (reason === 'non_video_page') return '当前标签页不是 B 站视频页。';
  if (reason === 'video_context_unavailable') return '当前 B 站视频上下文暂时不可用。';
  return '没有可用的当前视频上下文。';
}

function descriptionLead(text: string | null): string {
  const normalized = normalizeText(text);
  if (!normalized) return '简介里的可见文本';
  const sentence = normalized.split(/(?<=[.!?。！？])\s+/u)[0] ?? normalized;
  return limitText(sentence, 180);
}

function transcriptLead(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return '可引用字幕正文片段';
  const sentence = normalized.split(/(?<=[.!?。！？])\s+/u)[0] ?? normalized;
  return limitText(sentence, 180);
}

function normalizeAiSummaryCandidate(
  ai: CurrentVideoSummaryAiCandidate,
  fallback: Pick<CurrentVideoSummaryResult, 'summary' | 'bullets'>,
): { summary: string; bullets: string[]; confidence: number } {
  const summary = normalizeUnknownText(ai.summary, fallback.summary, 520);
  const bullets = normalizeAiBullets(ai.bullets, fallback.bullets);
  const confidence = normalizeConfidence(ai.confidence);
  return { summary, bullets, confidence };
}

function normalizeAiBullets(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const bullets = value
    .map(item => normalizeUnknownText(item, '', 220))
    .filter(Boolean)
    .slice(0, 5);
  return bullets.length > 0 ? bullets : fallback;
}

function normalizeUnknownText(value: unknown, fallback: string, maxLength: number): string {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const text = raw || fallback;
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.round(Math.max(0, Math.min(1, numeric)) * 100) / 100;
}

function transcriptPayloadBounds(payload: CurrentVideoSummaryTranscriptAiPayload): {
  segmentIds: Set<string>;
  timestamps: Set<number>;
  timestampLabels: Set<string>;
} {
  const segmentIds = new Set<string>();
  const timestamps = new Set<number>();
  const timestampLabels = new Set<string>();
  for (const chunk of payload.transcript.chunks) {
    addAllowedTimestamp(chunk.startSeconds, timestamps, timestampLabels);
    addAllowedTimestamp(chunk.endSeconds, timestamps, timestampLabels);
    for (const segmentId of chunk.segmentIds) segmentIds.add(segmentId);
    for (const segment of chunk.segments) {
      segmentIds.add(segment.segmentId);
      addAllowedTimestamp(segment.startSeconds, timestamps, timestampLabels);
      addAllowedTimestamp(segment.endSeconds, timestamps, timestampLabels);
    }
  }
  return { segmentIds, timestamps, timestampLabels };
}

function addAllowedTimestamp(
  value: number,
  timestamps: Set<number>,
  timestampLabels: Set<string>,
): void {
  const rounded = roundTimestamp(value);
  timestamps.add(rounded);
  timestampLabels.add(formatDuration(rounded));
}

function collectAiReferences(value: unknown): {
  segmentIds: Set<string>;
  timestamps: Set<number>;
  timestampLabels: Set<string>;
} {
  const references = {
    segmentIds: new Set<string>(),
    timestamps: new Set<number>(),
    timestampLabels: new Set<string>(),
  };
  visitAiReferences(value, '$', references);
  return references;
}

function visitAiReferences(
  value: unknown,
  path: string,
  references: ReturnType<typeof collectAiReferences>,
): void {
  if (typeof value === 'string') {
    for (const segmentId of value.match(/transcript:[A-Za-z0-9:._-]+/g) ?? []) {
      references.segmentIds.add(segmentId);
    }
    for (const label of value.match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g) ?? []) {
      references.timestampLabels.add(normalizeTimestampLabel(label));
    }
    return;
  }

  if (typeof value === 'number') {
    if (/\.(startSeconds|endSeconds|timestamp|targetSeconds)$/.test(path)) {
      references.timestamps.add(roundTimestamp(value));
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitAiReferences(item, `${path}[${index}]`, references));
    return;
  }

  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visitAiReferences(child, `${path}.${key}`, references);
  }
}

function normalizeTimestampLabel(label: string): string {
  const parts = label.split(':').map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part))) return label;
  if (parts.length === 2) {
    return formatDuration(parts[0] * 60 + parts[1]);
  }
  if (parts.length === 3) {
    return formatDuration(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  return label;
}

function roundTimestamp(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function localAiNote(status?: CurrentVideoSummaryAiStatus): string {
  switch (status) {
    case 'disabled':
      return 'AI 摘要未在设置中启用，因此当前显示本地证据结果。';
    case 'not_configured':
      return 'AI 摘要已启用但尚未在设置中配置 API Key，因此当前显示本地证据结果。';
    case 'failed':
      return 'AI 生成失败，当前显示本地证据结果。';
    case 'low_confidence':
      return 'AI 返回的置信度较低，当前显示本地证据结果。';
    case 'invalid_output':
      return 'AI 返回内容超出本次证据范围，当前显示本地字幕正文证据结果。';
    default:
      return '本地证据结果；本次没有请求 AI。';
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
