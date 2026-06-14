import type { CurrentVideoContext, CurrentVideoContextResult } from './types/current-video-context';
import type { CurrentVideoTranscriptSegment } from './types/current-video-transcript';
import type {
  CurrentVideoSegmentRetrievalCandidate,
  CurrentVideoSegmentRetrievalCandidateSource,
  CurrentVideoSegmentRetrievalConfidenceLabel,
  CurrentVideoSegmentRetrievalResult,
  CurrentVideoSegmentRetrievalStatus,
} from './types/current-video-segment-retrieval';
import type { VideoKnowledgeNode, VideoKnowledgeResult } from './types/video-knowledge';
import { buildCurrentVideoTimestampJumpPreview } from './current-video-timestamp-jump.ts';

const DEFAULT_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 5;
const MIN_TIMED_SCORE = 0.02;
const MIN_METADATA_SCORE = 0.22;
const LOW_CONFIDENCE_THRESHOLD = 0.45;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.62;
const HIGH_CONFIDENCE_THRESHOLD = 0.78;
const EVIDENCE_TEXT_LIMIT = 220;

const QUERY_HELPER_WORDS = [
  '那段',
  '这一段',
  '这段',
  '地方',
  '哪里',
  '哪个',
  '讲到',
  '讲了',
  '讲',
  '介绍',
  '说到',
  '说',
  '关于',
  '部分',
  '片段',
  '时间',
  '视频',
  '一下',
  '这个',
  '那个',
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '及',
  '到',
];

export interface SearchCurrentVideoSegmentsOptions {
  query: string;
  now?: number;
  limit?: number;
  contextMaxAgeMs?: number;
  transcriptSegments?: CurrentVideoTranscriptSegment[];
  videoKnowledge?: VideoKnowledgeResult | null;
}

interface QueryProfile {
  original: string;
  normalized: string;
  compact: string;
  meaningfulCompact: string;
  terms: string[];
  cjkTerms: string[];
  latinTerms: string[];
}

interface ScoreResult {
  score: number;
  reasons: string[];
  matchedTerms: string[];
  exact: boolean;
}

export function searchCurrentVideoSegments(
  context: CurrentVideoContextResult,
  options: SearchCurrentVideoSegmentsOptions,
): CurrentVideoSegmentRetrievalResult {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT));
  const profile = buildQueryProfile(options.query);

  if (!profile.normalized) {
    return result({
      status: 'empty_query',
      context,
      profile,
      now,
      candidates: [],
      summary: '请输入想查找的内容，例如“模型架构那段”或“DeepSeek V3.2”。',
      limitations: ['本功能只检索当前视频已经保存在本地的证据，不会请求 AI 或上传字幕。'],
      contextFresh: false,
    });
  }

  if (context.kind !== 'video') {
    return result({
      status: 'no_context',
      context,
      profile,
      now,
      candidates: [],
      summary: '当前没有可用的视频上下文。请先打开一个 B 站视频页，再检索时间片段。',
      limitations: ['没有当前视频上下文时，不会从历史、收藏或账号资料中查找替代证据。'],
      contextFresh: false,
    });
  }

  const contextFresh = now - context.collectedAt <= (options.contextMaxAgeMs ?? DEFAULT_CONTEXT_MAX_AGE_MS);
  if (!contextFresh) {
    return result({
      status: 'stale_context',
      context,
      profile,
      now,
      candidates: [],
      summary: '当前视频上下文已过期。请刷新视频页或重新打开弹窗后再试。',
      limitations: ['过期上下文不会用于定位时间片段，避免把旧页面证据误认为当前视频。'],
      contextFresh,
    });
  }

  const transcriptSegments = filterCurrentTranscriptSegments(context, options.transcriptSegments ?? []);
  const knowledgeNodes = filterCurrentKnowledgeNodes(context, options.videoKnowledge?.nodes ?? []);
  const evidenceState = {
    transcriptSegmentCount: transcriptSegments.length,
    timedKnowledgeNodeCount: knowledgeNodes.filter(node => knowledgeCandidateSource(node) !== null).length,
    metadataHintAvailable: hasMetadataHint(context),
  };
  const candidates = mergeAndRankCandidates([
    ...buildTranscriptCandidates(context, transcriptSegments, profile),
    ...buildKnowledgeNodeCandidates(knowledgeNodes, profile),
  ], limit);

  if (candidates.length > 0) {
    const status: CurrentVideoSegmentRetrievalStatus = candidates[0].confidence < LOW_CONFIDENCE_THRESHOLD
      ? 'low_confidence'
      : 'ready';
    return result({
      status,
      context,
      profile,
      now,
      candidates,
      summary: status === 'ready'
        ? `找到 ${candidates.length} 个基于当前视频本地证据的候选片段。`
        : '只找到低置信候选，请把问题写得更接近字幕原文或章节标题。',
      limitations: [
        '候选时间只来自当前视频已有字幕片段或本地关键节点，不会推测新时间点。',
        '候选必须预览并确认后才会请求播放器跳转，默认不会自动改变播放位置。',
      ],
      evidenceState,
      contextFresh,
    });
  }

  const metadataCandidates = buildMetadataHintCandidates(context, profile, limit);
  if (metadataCandidates.length > 0) {
    return result({
      status: 'metadata_only',
      context,
      profile,
      now,
      candidates: metadataCandidates,
      summary: '当前没有可定位的字幕片段或本地关键节点；仅找到视频信息或简介中的弱匹配，无法定位到具体时间点。',
      limitations: [
        '仅元数据或简介匹配不能代表字幕正文证据。',
        '没有当前视频字幕片段或本地关键节点时，不会生成推测时间。',
      ],
      evidenceState,
      contextFresh,
    });
  }

  return result({
    status: 'no_evidence',
    context,
    profile,
    now,
    candidates: [],
    summary: '没有找到可用的本地证据。请先缓存当前视频字幕正文，或换一个更具体的关键词。',
    limitations: [
      '当前检索不会读取历史、收藏、关注、反馈、Cookie、浏览器资料或本地密钥。',
      '没有字幕片段或本地关键节点时，不会编造时间点。',
    ],
    evidenceState,
    contextFresh,
  });
}

function buildTranscriptCandidates(
  context: CurrentVideoContext,
  segments: CurrentVideoTranscriptSegment[],
  profile: QueryProfile,
): CurrentVideoSegmentRetrievalCandidate[] {
  return segments
    .map((segment) => {
      const scored = scoreText(profile, segment.text);
      if (scored.score < MIN_TIMED_SCORE) return null;

      const weakHintScore = scoreContextWeakHints(context, profile);
      const confidence = capWeakConfidence(scored.score, confidenceFromScore(
        scored.score + Math.min(0.08, weakHintScore * 0.08),
        'transcript_segment',
        segmentTextQuality(segment),
      ));
      const reasons = [...scored.reasons];
      if (weakHintScore >= 0.5) {
        reasons.push('标题、简介或章节中也有相近提示');
      }

      return candidate({
        id: `candidate:segment:${segment.segmentId}`,
        binding: {
          kind: 'transcript_segment',
          segmentId: segment.segmentId,
        },
        source: 'transcript_segment',
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        evidenceText: segment.text,
        matchReasons: reasons,
        confidence,
      });
    })
    .filter((item): item is CurrentVideoSegmentRetrievalCandidate => Boolean(item));
}

function buildKnowledgeNodeCandidates(
  nodes: VideoKnowledgeNode[],
  profile: QueryProfile,
): CurrentVideoSegmentRetrievalCandidate[] {
  return nodes
    .map((node) => {
      const text = [
        node.title,
        node.reason,
        node.evidence?.textSpan ?? '',
      ].join(' ');
      const scored = scoreText(profile, text);
      if (scored.score < MIN_TIMED_SCORE) return null;

      const source = knowledgeCandidateSource(node);
      if (!source) return null;

      const sourceQuality = node.source === 'transcript'
        ? 0.08
        : node.source === 'chapter'
          ? 0
          : -0.06;
      const confidence = capWeakConfidence(scored.score, confidenceFromScore(
        scored.score + node.confidence * 0.12 + sourceQuality,
        source,
        node.evidence?.textSpan ? 0.05 : 0,
      ));

      return candidate({
        id: node.evidence?.segmentId
          ? `candidate:segment:${node.evidence.segmentId}`
          : `candidate:node:${node.id}`,
        binding: node.evidence?.segmentId
          ? {
              kind: 'transcript_segment',
              segmentId: node.evidence.segmentId,
              nodeId: node.id,
            }
          : {
              kind: 'video_knowledge_node',
              nodeId: node.id,
            },
        source,
        startSeconds: node.timestamp,
        endSeconds: node.endTimestamp,
        evidenceText: node.evidence?.textSpan ?? node.title,
        matchReasons: [
          ...scored.reasons,
          node.source === 'transcript' ? '同时命中本地字幕节点' : '命中当前视频本地节点提示',
        ],
        confidence,
      });
    })
    .filter((item): item is CurrentVideoSegmentRetrievalCandidate => Boolean(item));
}

function buildMetadataHintCandidates(
  context: CurrentVideoContext,
  profile: QueryProfile,
  limit: number,
): CurrentVideoSegmentRetrievalCandidate[] {
  const hints = [
    {
      source: 'metadata_hint' as const,
      id: `candidate:metadata:${context.bvid}`,
      labelText: [context.title, context.currentPart.title].filter(Boolean).join(' / '),
      evidenceText: [context.title, context.currentPart.title, context.authorName].filter(Boolean).join(' / '),
    },
    {
      source: 'description_hint' as const,
      id: `candidate:description:${context.bvid}`,
      labelText: context.description.text ?? '',
      evidenceText: context.description.text ?? '',
    },
  ];

  return hints
    .map((hint) => {
      const scored = scoreText(profile, hint.labelText);
      if (scored.score < MIN_METADATA_SCORE) return null;
      const confidence = Math.min(0.38, confidenceFromScore(scored.score, hint.source, -0.08));
      return candidate({
        id: hint.id,
        binding: { kind: 'metadata_hint' },
        source: hint.source,
        startSeconds: null,
        endSeconds: null,
        evidenceText: hint.evidenceText,
        matchReasons: [...scored.reasons, '这只是视频信息中的弱提示'],
        confidence,
        note: '仅能说明当前视频信息相关，无法定位到具体时间点。',
      });
    })
    .filter((item): item is CurrentVideoSegmentRetrievalCandidate => Boolean(item))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function mergeAndRankCandidates(
  candidates: CurrentVideoSegmentRetrievalCandidate[],
  limit: number,
): CurrentVideoSegmentRetrievalCandidate[] {
  const byId = new Map<string, CurrentVideoSegmentRetrievalCandidate>();
  for (const item of candidates) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }

    byId.set(item.id, {
      ...existing,
      source: preferSource(existing.source, item.source),
      sourceLabel: sourceLabel(preferSource(existing.source, item.source)),
      binding: {
        kind: existing.binding.kind,
        segmentId: existing.binding.segmentId ?? item.binding.segmentId ?? null,
        nodeId: existing.binding.nodeId ?? item.binding.nodeId ?? null,
      },
      confidence: roundScore(Math.max(existing.confidence, item.confidence)),
      confidenceLabel: confidenceLabel(Math.max(existing.confidence, item.confidence)),
      matchReasons: uniqueReasons([...existing.matchReasons, ...item.matchReasons]).slice(0, 4),
      evidenceText: existing.evidenceText.length >= item.evidenceText.length
        ? existing.evidenceText
        : item.evidenceText,
    });
  }

  return Array.from(byId.values())
    .sort((a, b) =>
      b.confidence - a.confidence
      || (a.startSeconds ?? Number.MAX_SAFE_INTEGER) - (b.startSeconds ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, limit);
}

function scoreText(profile: QueryProfile, text: string | null | undefined): ScoreResult {
  const normalized = normalizeText(text);
  if (!normalized || profile.terms.length === 0) {
    return { score: 0, reasons: [], matchedTerms: [], exact: false };
  }

  const compact = compactText(normalized);
  const matchedTerms = uniqueTerms(profile.terms.filter(term => compact.includes(term)));
  const totalWeight = profile.terms.reduce((sum, term) => sum + termWeight(term), 0);
  const matchedWeight = matchedTerms.reduce((sum, term) => sum + termWeight(term), 0);
  const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  const exact = Boolean(profile.meaningfulCompact && compact.includes(profile.meaningfulCompact));
  const latinExact = profile.latinTerms.length > 0 && profile.latinTerms.every(term => compact.includes(term));
  const cjkCoverage = profile.cjkTerms.length > 0
    ? matchedTerms.filter(term => profile.cjkTerms.includes(term)).length / profile.cjkTerms.length
    : 0;

  let score = coverage * 0.58;
  if (exact) score += 0.28;
  if (latinExact) score += 0.18;
  if (cjkCoverage >= 0.5) score += 0.14;
  if (matchedTerms.length >= 2) score += 0.06;
  if (matchedTerms.length === 1 && matchedTerms[0].length <= 2) score -= 0.03;

  const reasons: string[] = [];
  if (exact) {
    reasons.push(`证据文本包含完整关键词“${limitText(profile.original, 26)}”`);
  }
  if (latinExact && !exact) {
    reasons.push(`证据文本命中 ${profile.latinTerms.slice(0, 3).join('、')}`);
  }
  if (matchedTerms.length > 0) {
    reasons.push(`和问题词有重叠：${matchedTerms.slice(0, 5).join('、')}`);
  }
  if (cjkCoverage >= 0.5 && profile.cjkTerms.length > 0) {
    reasons.push('中文短语有连续重叠');
  }

  return {
    score: roundScore(Math.max(0, Math.min(1, score))),
    reasons: uniqueReasons(reasons),
    matchedTerms,
    exact,
  };
}

function filterCurrentTranscriptSegments(
  context: CurrentVideoContext,
  segments: CurrentVideoTranscriptSegment[],
): CurrentVideoTranscriptSegment[] {
  const evidence = context.transcriptEvidence;
  if (
    !context.cid
    || evidence?.active !== true
    || evidence.bvid !== context.bvid
    || evidence.cid !== context.cid
    || evidence.page !== context.currentPart.page
    || !evidence.sourceHash
  ) {
    return [];
  }

  const expectedLanguage = languageKey(evidence.language);
  return segments
    .filter(segment =>
      segment.bvid === context.bvid
      && segment.cid === context.cid
      && segment.page === context.currentPart.page
      && !segment.stale
      && segment.sourceHash === evidence.sourceHash
      && (!evidence.language || languageKey(segment.language) === expectedLanguage)
      && Number.isFinite(segment.startSeconds)
      && Number.isFinite(segment.endSeconds)
      && segment.endSeconds > segment.startSeconds
      && Boolean(normalizeText(segment.text)),
    )
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
}

function filterCurrentKnowledgeNodes(
  context: CurrentVideoContext,
  nodes: VideoKnowledgeNode[],
): VideoKnowledgeNode[] {
  return nodes.filter(node =>
    node.bvid === context.bvid
    && node.page === context.currentPart.page
    && (node.cid === null || context.cid === null || node.cid === context.cid)
    && (
      node.source === 'transcript'
      || node.source === 'chapter'
      || node.source === 'page'
      || node.source === 'metadata'
      || node.source === 'description'
    ),
  );
}

function knowledgeCandidateSource(node: VideoKnowledgeNode): CurrentVideoSegmentRetrievalCandidateSource | null {
  if (node.source === 'transcript' && (node.evidence?.segmentId || node.timestamp !== null)) {
    return 'transcript_node';
  }
  if (node.source === 'chapter' && node.timestamp !== null) return 'chapter_node';
  if (node.source === 'page' && node.timestamp !== null) return 'page_node';
  return null;
}

function scoreContextWeakHints(context: CurrentVideoContext, profile: QueryProfile): number {
  const text = [
    context.title,
    context.currentPart.title,
    context.description.text,
    ...context.chapters.map(chapter => chapter.title),
    ...context.parts.map(part => part.title),
  ].filter(Boolean).join(' ');
  return scoreText(profile, text).score;
}

function hasMetadataHint(context: CurrentVideoContext): boolean {
  return Boolean(
    normalizeText(context.title)
    || normalizeText(context.currentPart.title)
    || normalizeText(context.description.text),
  );
}

function candidate(input: {
  id: string;
  binding: CurrentVideoSegmentRetrievalCandidate['binding'];
  source: CurrentVideoSegmentRetrievalCandidateSource;
  startSeconds: number | null;
  endSeconds: number | null;
  evidenceText: string;
  matchReasons: string[];
  confidence: number;
  note?: string | null;
}): CurrentVideoSegmentRetrievalCandidate {
  const confidence = roundScore(Math.max(0, Math.min(1, input.confidence)));
  return {
    id: input.id,
    binding: input.binding,
    source: input.source,
    sourceLabel: sourceLabel(input.source),
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    timeRangeLabel: formatTimeRange(input.startSeconds, input.endSeconds),
    evidenceText: limitText(input.evidenceText, EVIDENCE_TEXT_LIMIT),
    matchReasons: uniqueReasons(input.matchReasons).slice(0, 4),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    note: input.note ?? (confidence < LOW_CONFIDENCE_THRESHOLD ? '匹配较弱，建议换成更具体的关键词。' : null),
    jumpPreview: {
      canJump: false,
      requiresConfirmation: true,
      disabledReason: 'candidate_not_found',
      message: '候选需要重新验证后才能跳转。',
      targetSeconds: null,
      targetTimeLabel: null,
      sourceLabel: sourceLabel(input.source),
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      evidencePreview: limitText(input.evidenceText, 140),
    },
  };
}

function result(input: {
  status: CurrentVideoSegmentRetrievalStatus;
  context: CurrentVideoContextResult;
  profile: QueryProfile;
  now: number;
  candidates: CurrentVideoSegmentRetrievalCandidate[];
  summary: string;
  limitations: string[];
  evidenceState?: {
    transcriptSegmentCount: number;
    timedKnowledgeNodeCount: number;
    metadataHintAvailable: boolean;
  };
  contextFresh: boolean;
}): CurrentVideoSegmentRetrievalResult {
  const videoContext = input.context.kind === 'video' ? input.context : null;
  const fallbackEvidenceState = {
    transcriptSegmentCount: input.candidates.filter(candidate => candidate.binding.segmentId).length,
    timedKnowledgeNodeCount: input.candidates.filter(candidate =>
      candidate.binding.kind === 'video_knowledge_node'
      || candidate.binding.nodeId,
    ).length,
    metadataHintAvailable: input.candidates.some(candidate => candidate.binding.kind === 'metadata_hint'),
  };
  const evidenceState = input.evidenceState ?? fallbackEvidenceState;

  return {
    status: input.status,
    query: input.profile.original,
    normalizedQuery: input.profile.normalized,
    title: videoContext?.title ?? videoContext?.bvid ?? '当前视频',
    generatedAt: input.now,
    candidates: input.candidates.map(candidate => ({
      ...candidate,
      jumpPreview: buildCurrentVideoTimestampJumpPreview(input.context, candidate, {
        now: input.now,
      }),
    })),
    summary: input.summary,
    limitations: input.limitations,
    evidenceState: {
      transcriptSegmentCount: evidenceState.transcriptSegmentCount,
      timedKnowledgeNodeCount: evidenceState.timedKnowledgeNodeCount,
      metadataHintAvailable: evidenceState.metadataHintAvailable,
      contextFresh: input.contextFresh,
    },
  };
}

function buildQueryProfile(query: string): QueryProfile {
  const original = normalizeText(query);
  const normalized = normalizeSearchText(original);
  const compact = compactText(normalized);
  const meaningfulCompact = stripQueryHelpers(compact);
  const latinTerms = uniqueTerms(
    (normalized.match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? [])
      .map(compactText)
      .filter(term => term.length >= 2),
  );
  const cjkTerms = buildCjkTerms(normalized);
  const terms = uniqueTerms([
    meaningfulCompact.length >= 2 ? meaningfulCompact : '',
    ...latinTerms,
    ...cjkTerms,
  ].filter(Boolean));

  return {
    original,
    normalized,
    compact,
    meaningfulCompact,
    terms,
    cjkTerms,
    latinTerms,
  };
}

function buildCjkTerms(value: string): string[] {
  const sequences = value.match(/\p{Script=Han}+/gu) ?? [];
  const terms: string[] = [];
  for (const sequence of sequences) {
    const stripped = stripQueryHelpers(sequence);
    if (stripped.length < 2) continue;
    if (stripped.length <= 8) terms.push(stripped);
    for (let size = 2; size <= Math.min(4, stripped.length); size += 1) {
      for (let index = 0; index <= stripped.length - size; index += 1) {
        const term = stripped.slice(index, index + size);
        if (!QUERY_HELPER_WORDS.includes(term)) terms.push(term);
      }
    }
  }
  return uniqueTerms(terms);
}

function stripQueryHelpers(value: string): string {
  let next = value;
  for (const word of QUERY_HELPER_WORDS) {
    next = next.replaceAll(word, '');
  }
  return next;
}

function confidenceFromScore(
  score: number,
  source: CurrentVideoSegmentRetrievalCandidateSource,
  qualityBonus: number,
): number {
  const sourceBonus = source === 'transcript_segment'
    ? 0.16
    : source === 'transcript_node'
      ? 0.12
      : source === 'chapter_node'
        ? 0.02
        : source === 'page_node'
          ? -0.03
          : -0.14;
  return roundScore(0.22 + score * 0.58 + sourceBonus + qualityBonus);
}

function capWeakConfidence(rawScore: number, confidence: number): number {
  if (rawScore < 0.12) return Math.min(confidence, 0.42);
  if (rawScore < 0.2) return Math.min(confidence, 0.48);
  return confidence;
}

function segmentTextQuality(segment: CurrentVideoTranscriptSegment): number {
  const textLength = normalizeText(segment.text).length;
  const duration = segment.endSeconds - segment.startSeconds;
  let quality = 0;
  if (textLength >= 18) quality += 0.04;
  if (textLength >= 40) quality += 0.03;
  if (duration >= 1 && duration <= 30) quality += 0.03;
  return quality;
}

function sourceLabel(source: CurrentVideoSegmentRetrievalCandidateSource): string {
  switch (source) {
    case 'transcript_segment':
      return '可定位字幕证据';
    case 'transcript_node':
      return '本地字幕节点';
    case 'chapter_node':
      return '章节弱提示';
    case 'page_node':
      return '分 P 弱提示';
    case 'metadata_hint':
      return '视频信息弱提示';
    case 'description_hint':
      return '简介弱提示';
    default:
      return '本地证据';
  }
}

function preferSource(
  a: CurrentVideoSegmentRetrievalCandidateSource,
  b: CurrentVideoSegmentRetrievalCandidateSource,
): CurrentVideoSegmentRetrievalCandidateSource {
  const priority: CurrentVideoSegmentRetrievalCandidateSource[] = [
    'transcript_segment',
    'transcript_node',
    'chapter_node',
    'page_node',
    'description_hint',
    'metadata_hint',
  ];
  return priority.indexOf(a) <= priority.indexOf(b) ? a : b;
}

function confidenceLabel(confidence: number): CurrentVideoSegmentRetrievalConfidenceLabel {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return '高';
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return '中';
  return '低';
}

function formatTimeRange(start: number | null, end: number | null): string {
  if (start === null) return '无法定位具体时间';
  if (typeof end === 'number' && end > start) {
    return `${formatDuration(start)}-${formatDuration(end)}`;
  }
  return formatDuration(start);
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

function termWeight(term: string): number {
  if (/^[a-z0-9.]+$/i.test(term)) return Math.min(4, Math.max(1.4, term.length / 2));
  return Math.min(4, Math.max(1, term.length - 1));
}

function uniqueTerms(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function uniqueReasons(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function normalizeSearchText(value: string): string {
  return normalizeText(value).normalize('NFKC').toLowerCase();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function compactText(value: string): string {
  return normalizeSearchText(value).replace(/[^\p{Script=Han}a-z0-9.]+/gu, '');
}

function limitText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}
