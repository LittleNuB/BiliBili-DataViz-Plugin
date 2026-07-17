import type { AiConfig, UserConfig } from './types/config.ts';
import type { CurrentVideoContext, CurrentVideoContextResult } from './types/current-video-context.ts';
import type {
  CurrentVideoSegmentRerankAiState,
  CurrentVideoSegmentRerankExplanation,
  CurrentVideoSegmentRetrievalCandidate,
  CurrentVideoSegmentRetrievalResult,
} from './types/current-video-segment-retrieval.ts';

const DEFAULT_RERANK_CANDIDATE_LIMIT = 5;
const PAYLOAD_QUERY_LIMIT = 160;
const PAYLOAD_TITLE_LIMIT = 160;
const PAYLOAD_PART_TITLE_LIMIT = 120;
const PAYLOAD_EVIDENCE_LIMIT = 180;
const PAYLOAD_REASON_LIMIT = 90;
const OUTPUT_TEXT_LIMIT = 140;
const LOW_AI_CONFIDENCE_THRESHOLD = 0.45;

export interface CurrentVideoSegmentRerankAiPayloadCandidate {
  candidateId: string;
  localRank: number;
  sourceLabel: string;
  confidence: number;
  confidenceLabel: string;
  evidenceSnippet: string;
  matchReasons: string[];
  note: string | null;
  localStatus: {
    hasTimedTarget: boolean;
    canJumpAfterConfirmation: boolean;
    hasEvidenceSnippet: boolean;
    confidenceLabel: string;
  };
}

export interface CurrentVideoSegmentRerankAiPayload {
  intent: 'current_video_segment_rerank_v1';
  query: string;
  video: {
    bvid: string;
    cid: number | null;
    title: string | null;
    durationSeconds: number | null;
    currentPart: {
      page: number;
      title: string | null;
      total: number | null;
    };
    sourceAvailability: {
      metadata: string;
      description: string;
      pages: string;
      chapters: string;
      transcript: string;
      contentText: string;
    };
  };
  localEvidenceState: {
    transcriptSegmentCount: number;
    timedKnowledgeNodeCount: number;
    metadataHintAvailable: boolean;
    contextFresh: boolean;
  };
  candidates: CurrentVideoSegmentRerankAiPayloadCandidate[];
  safetyRules: string[];
}

export interface CurrentVideoSegmentRerankAiOutput {
  rankedCandidates?: unknown;
  overallConfidence?: unknown;
}

export interface CurrentVideoSegmentRerankAiRankedCandidate {
  candidateId?: unknown;
  explanation?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

export interface CurrentVideoSegmentRerankChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface RerankCurrentVideoSegmentCandidatesOptions {
  config: UserConfig;
  chat: (config: AiConfig, messages: CurrentVideoSegmentRerankChatMessage[]) => Promise<CurrentVideoSegmentRerankAiOutput>;
  now?: number;
  candidateLimit?: number;
  auditPayload?: (payload: CurrentVideoSegmentRerankAiPayload) => void;
}

interface PayloadBuildResult {
  payload: CurrentVideoSegmentRerankAiPayload;
  refs: Array<{
    payloadCandidateId: string;
    localCandidateId: string;
  }>;
}

type RerankGuardResult =
  | {
      ok: true;
      rankedPayloadCandidateIds: string[];
      explanations: Array<{
        payloadCandidateId: string;
        explanation: string;
        reason: string;
        confidence: number;
      }>;
      confidence: number;
    }
  | {
      ok: false;
      reason: string;
      error: string;
      confidence?: number;
    };

export async function rerankCurrentVideoSegmentCandidates(
  context: CurrentVideoContextResult,
  local: CurrentVideoSegmentRetrievalResult,
  options: RerankCurrentVideoSegmentCandidatesOptions,
): Promise<CurrentVideoSegmentRetrievalResult> {
  const now = options.now ?? Date.now();
  const model = options.config.ai.chatModel;

  if (context.kind !== 'video' || local.candidates.length === 0) {
    return withAiRerank(local, aiState({
      status: 'not_requested',
      model,
      note: '没有可重排的本地候选，因此没有请求 AI。',
      now,
    }));
  }

  return withAiRerank(local, aiState({
    status: 'disabled',
    model,
    note: '片段排序保持本地处理，本次没有请求 AI，候选顺序不变。',
    now,
  }));
}

export function buildCurrentVideoSegmentRerankAiPayload(
  context: CurrentVideoContext,
  local: CurrentVideoSegmentRetrievalResult,
  options: { candidateLimit?: number } = {},
): PayloadBuildResult {
  const limit = Math.max(1, Math.floor(options.candidateLimit ?? DEFAULT_RERANK_CANDIDATE_LIMIT));
  const refs: PayloadBuildResult['refs'] = [];
  const candidates = local.candidates.slice(0, limit).map((candidate, index) => {
    const candidateId = `candidate-${index + 1}`;
    refs.push({
      payloadCandidateId: candidateId,
      localCandidateId: candidate.id,
    });
    return toPayloadCandidate(candidate, candidateId, index + 1);
  });

  return {
    payload: {
      intent: 'current_video_segment_rerank_v1',
      query: limitText(local.query, PAYLOAD_QUERY_LIMIT),
      video: {
        bvid: limitText(context.bvid, 40),
        cid: context.cid,
        title: limitNullableText(context.title, PAYLOAD_TITLE_LIMIT),
        durationSeconds: context.durationSeconds,
        currentPart: {
          page: context.currentPart.page,
          title: limitNullableText(context.currentPart.title, PAYLOAD_PART_TITLE_LIMIT),
          total: context.currentPart.total,
        },
        sourceAvailability: {
          metadata: context.sources.metadata,
          description: context.sources.description,
          pages: context.sources.pages,
          chapters: context.sources.chapters,
          transcript: context.sources.transcript,
          contentText: context.sources.contentText,
        },
      },
      localEvidenceState: {
        transcriptSegmentCount: local.evidenceState.transcriptSegmentCount,
        timedKnowledgeNodeCount: local.evidenceState.timedKnowledgeNodeCount,
        metadataHintAvailable: local.evidenceState.metadataHintAvailable,
        contextFresh: local.evidenceState.contextFresh,
      },
      candidates,
      safetyRules: [
        'Only reorder or explain the provided candidates by candidateId.',
        'Do not create timestamps, titles, evidence, URLs, or source identifiers.',
        'Do not mention unavailable account ledgers, relationship lists, local secret files, browser state, raw source identifiers, comments, danmaku, audio, or visuals.',
        'Return JSON only with rankedCandidates and overallConfidence.',
      ],
    },
    refs,
  };
}

export function buildCurrentVideoSegmentRerankAiMessages(
  payload: CurrentVideoSegmentRerankAiPayload,
): CurrentVideoSegmentRerankChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are Bili-Bill current-video fuzzy timestamp candidate reranker. Return JSON only.',
        'Local retrieval already produced the only allowed candidates. You may only rank candidateId values that appear in the payload.',
        'Do not return or mention timestamps, seconds, time ranges, segment IDs, source hashes, URLs, new titles, or new evidence.',
        'Use only the query, minimal current-video metadata, source labels, confidence, local status, match reasons, and bounded evidence snippets in the payload.',
        'JSON schema: { "rankedCandidates": [{ "candidateId": string, "explanation": string, "confidence": number, "reason": string }], "overallConfidence": number }.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];
}

export function guardCurrentVideoSegmentRerankAiOutput(
  ai: CurrentVideoSegmentRerankAiOutput,
  payload: CurrentVideoSegmentRerankAiPayload,
): RerankGuardResult {
  const schemaError = findSchemaError(ai);
  if (schemaError) {
    return rejected('AI_SCHEMA_VIOLATION', `AI_SCHEMA_VIOLATION:${schemaError}`);
  }

  const unsafeReference = findUnsafeAiReference(ai, payload);
  if (unsafeReference) {
    return rejected(unsafeReference.reason, unsafeReference.error);
  }

  const ranked = normalizeRankedCandidates(ai.rankedCandidates);
  if (!ranked.ok) {
    return rejected(ranked.reason, ranked.error);
  }

  const allowedIds = new Set(payload.candidates.map(candidate => candidate.candidateId));
  const seen = new Set<string>();
  const explanations: Array<{
    payloadCandidateId: string;
    explanation: string;
    reason: string;
    confidence: number;
  }> = [];

  for (const item of ranked.items) {
    if (!allowedIds.has(item.candidateId)) {
      return rejected('AI_UNKNOWN_CANDIDATE_ID', `AI_UNKNOWN_CANDIDATE_ID:${item.candidateId}`);
    }
    if (seen.has(item.candidateId)) {
      return rejected('AI_DUPLICATE_CANDIDATE_ID', `AI_DUPLICATE_CANDIDATE_ID:${item.candidateId}`);
    }
    seen.add(item.candidateId);
    explanations.push({
      payloadCandidateId: item.candidateId,
      explanation: item.explanation,
      reason: item.reason,
      confidence: item.confidence,
    });
  }

  const overallConfidence = normalizeOptionalConfidence(ai.overallConfidence)
    ?? Math.min(...explanations.map(item => item.confidence));
  if (overallConfidence < LOW_AI_CONFIDENCE_THRESHOLD || explanations[0]?.confidence < LOW_AI_CONFIDENCE_THRESHOLD) {
    return {
      ok: false,
      reason: 'AI_LOW_CONFIDENCE',
      error: `AI_LOW_CONFIDENCE:${roundScore(overallConfidence)}`,
      confidence: overallConfidence,
    };
  }

  return {
    ok: true,
    rankedPayloadCandidateIds: explanations.map(item => item.payloadCandidateId),
    explanations,
    confidence: roundScore(overallConfidence),
  };
}

function applyGuardedRerank(
  local: CurrentVideoSegmentRetrievalResult,
  built: PayloadBuildResult,
  guarded: Extract<RerankGuardResult, { ok: true }>,
  model: string,
  now: number,
): CurrentVideoSegmentRetrievalResult {
  const localById = new Map(local.candidates.map(candidate => [candidate.id, candidate]));
  const localIdByPayloadId = new Map(built.refs.map(ref => [ref.payloadCandidateId, ref.localCandidateId]));
  const rankedLocalIds = guarded.rankedPayloadCandidateIds
    .map(payloadId => localIdByPayloadId.get(payloadId) ?? null)
    .filter((id): id is string => Boolean(id));
  const rankedSet = new Set(rankedLocalIds);
  const candidates = [
    ...rankedLocalIds.map(id => localById.get(id)).filter((candidate): candidate is CurrentVideoSegmentRetrievalCandidate => Boolean(candidate)),
    ...local.candidates.filter(candidate => !rankedSet.has(candidate.id)),
  ];
  const explanationByLocalId = new Map<string, CurrentVideoSegmentRerankExplanation>();
  for (const explanation of guarded.explanations) {
    const localCandidateId = localIdByPayloadId.get(explanation.payloadCandidateId);
    if (!localCandidateId) continue;
    explanationByLocalId.set(localCandidateId, {
      candidateId: localCandidateId,
      explanation: explanation.explanation,
      reason: explanation.reason,
      confidence: explanation.confidence,
    });
  }

  return withAiRerank({
    ...local,
    candidates,
    limitations: uniqueText([
      ...local.limitations,
      'AI 只改变候选展示顺序和解释，不生成新时间点、新标题或新证据。',
    ]),
  }, aiState({
    status: 'generated',
    model,
    note: 'AI 已基于受限候选调整展示顺序；时间点、证据和跳转入口仍来自本地候选，跳转前必须确认。',
    now,
    payloadCandidateCount: built.payload.candidates.length,
    appliedCandidateIds: candidates.map(candidate => candidate.id),
    explanations: candidates
      .map(candidate => explanationByLocalId.get(candidate.id) ?? null)
      .filter((item): item is CurrentVideoSegmentRerankExplanation => Boolean(item)),
  }));
}

function toPayloadCandidate(
  candidate: CurrentVideoSegmentRetrievalCandidate,
  candidateId: string,
  localRank: number,
): CurrentVideoSegmentRerankAiPayloadCandidate {
  return {
    candidateId,
    localRank,
    sourceLabel: limitText(candidate.sourceLabel, 40),
    confidence: roundScore(candidate.confidence),
    confidenceLabel: candidate.confidenceLabel,
    evidenceSnippet: limitText(candidate.evidenceText, PAYLOAD_EVIDENCE_LIMIT),
    matchReasons: candidate.matchReasons.slice(0, 4).map(reason => limitText(reason, PAYLOAD_REASON_LIMIT)),
    note: limitNullableText(candidate.note, PAYLOAD_REASON_LIMIT),
    localStatus: {
      hasTimedTarget: candidate.startSeconds !== null,
      canJumpAfterConfirmation: candidate.jumpPreview.canJump,
      hasEvidenceSnippet: Boolean(normalizeText(candidate.evidenceText)),
      confidenceLabel: candidate.confidenceLabel,
    },
  };
}

function findSchemaError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'AI 输出必须是 JSON 对象。';
  }
  const root = value as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (key !== 'rankedCandidates' && key !== 'overallConfidence') {
      return `AI 输出包含不允许的字段：${key}`;
    }
  }
  if (!Array.isArray(root.rankedCandidates)) {
    return 'AI 输出缺少 rankedCandidates 数组。';
  }
  for (const [index, item] of root.rankedCandidates.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return `rankedCandidates[${index}] 必须是对象。`;
    }
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (key !== 'candidateId' && key !== 'explanation' && key !== 'confidence' && key !== 'reason') {
        return `rankedCandidates[${index}] 包含不允许的字段：${key}`;
      }
    }
  }
  return null;
}

function findUnsafeAiReference(
  value: unknown,
  payload: CurrentVideoSegmentRerankAiPayload,
): { reason: string; error: string } | null {
  const strings = collectStrings(value);
  const allowedText = normalizeText([
    payload.query,
    payload.video.title,
    payload.video.currentPart.title,
    ...payload.candidates.flatMap(candidate => [
      candidate.sourceLabel,
      candidate.evidenceSnippet,
      ...candidate.matchReasons,
      candidate.note ?? '',
    ]),
  ].join(' '));

  for (const text of strings) {
    if (containsTimestampText(text)) {
      return { reason: 'AI_TIMESTAMP_OUT_OF_SCHEMA', error: `AI_TIMESTAMP_OUT_OF_SCHEMA:${limitText(text, 80)}` };
    }
    if (containsUnavailableSource(text)) {
      return { reason: 'AI_UNAVAILABLE_SOURCE_REFERENCE', error: `AI_UNAVAILABLE_SOURCE_REFERENCE:${limitText(text, 80)}` };
    }
    const outsideTitle = findOutsideBracketTitle(text, allowedText);
    if (outsideTitle) {
      return { reason: 'AI_OUTSIDE_TITLE_REFERENCE', error: `AI_OUTSIDE_TITLE_REFERENCE:${outsideTitle}` };
    }
  }

  return null;
}

function normalizeRankedCandidates(value: unknown): {
  ok: true;
  items: Array<{
    candidateId: string;
    explanation: string;
    reason: string;
    confidence: number;
  }>;
} | {
  ok: false;
  reason: string;
  error: string;
} {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: 'AI_EMPTY_RERANK', error: 'AI_EMPTY_RERANK' };
  }

  const items: Array<{
    candidateId: string;
    explanation: string;
    reason: string;
    confidence: number;
  }> = [];

  for (const raw of value) {
    const item = raw as CurrentVideoSegmentRerankAiRankedCandidate;
    const candidateId = typeof item.candidateId === 'string' ? item.candidateId.trim() : '';
    if (!candidateId) {
      return { ok: false, reason: 'AI_MISSING_CANDIDATE_ID', error: 'AI_MISSING_CANDIDATE_ID' };
    }

    const confidence = normalizeOptionalConfidence(item.confidence);
    if (confidence === null) {
      return { ok: false, reason: 'AI_INVALID_CONFIDENCE', error: `AI_INVALID_CONFIDENCE:${candidateId}` };
    }

    const explanation = limitText(typeof item.explanation === 'string' ? item.explanation : '', OUTPUT_TEXT_LIMIT);
    const reason = limitText(typeof item.reason === 'string' ? item.reason : '', OUTPUT_TEXT_LIMIT);
    if (!explanation || !reason) {
      return { ok: false, reason: 'AI_EMPTY_EXPLANATION', error: `AI_EMPTY_EXPLANATION:${candidateId}` };
    }

    items.push({
      candidateId,
      explanation,
      reason,
      confidence,
    });
  }

  return { ok: true, items };
}

function aiState(input: {
  status: CurrentVideoSegmentRerankAiState['status'];
  model: string | null;
  note: string;
  now: number;
  error?: string | null;
  payloadCandidateCount?: number;
  appliedCandidateIds?: string[];
  explanations?: CurrentVideoSegmentRerankExplanation[];
}): CurrentVideoSegmentRerankAiState {
  return {
    status: input.status,
    model: input.model,
    note: input.note,
    error: input.error ?? null,
    generatedAt: input.now,
    payloadCandidateCount: input.payloadCandidateCount ?? 0,
    appliedCandidateIds: input.appliedCandidateIds ?? [],
    explanations: input.explanations ?? [],
  };
}

function withAiRerank(
  local: CurrentVideoSegmentRetrievalResult,
  aiRerank: CurrentVideoSegmentRerankAiState,
): CurrentVideoSegmentRetrievalResult {
  return {
    ...local,
    aiRerank,
  };
}

function rejected(reason: string, error: string): RerankGuardResult {
  return {
    ok: false,
    reason,
    error,
  };
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

function containsTimestampText(value: string): boolean {
  return /(^|[^\d])\d{1,2}:\d{2}(?::\d{2})?($|[^\d])/.test(value)
    || /\d+(?:\.\d+)?\s*(秒|分钟|小時|小时|second|seconds|min|minute|minutes)\b/i.test(value);
}

function containsUnavailableSource(value: string): boolean {
  return /弹幕|评论|画面|音频|完整历史|完整收藏|完整关注|反馈记录|Cookie|登录态|sourceHash|segmentId|字幕全文|完整字幕|raw subtitle|profile|Key\.txt/i.test(value);
}

function findOutsideBracketTitle(value: string, allowedText: string): string | null {
  const pattern = /《([^》]{2,80})》/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const title = normalizeText(match[1]);
    if (title && !allowedText.includes(title)) return title;
  }
  return null;
}

function normalizeOptionalConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return roundScore(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueText(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function limitNullableText(value: string | null | undefined, maxLength: number): string | null {
  const text = limitText(value ?? '', maxLength);
  return text || null;
}

function limitText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
