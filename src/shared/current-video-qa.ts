import type { AiConfig, UserConfig } from './types/config.ts';
import type { CurrentVideoContext, CurrentVideoContextResult } from './types/current-video-context.ts';
import type {
  CurrentVideoQaAiState,
  CurrentVideoQaCitedSegment,
  CurrentVideoQaResult,
  CurrentVideoQaStatus,
  CurrentVideoSegmentRetrievalCandidate,
  CurrentVideoSegmentRetrievalCandidateSource,
  CurrentVideoSegmentRetrievalConfidenceLabel,
  CurrentVideoSegmentRetrievalResult,
} from './types/current-video-segment-retrieval.ts';
import {
  assertAssistantPayloadAudit,
  currentVideoQaPayloadContract,
} from './assistant-payload-audit.ts';

const DEFAULT_QA_CANDIDATE_LIMIT = 5;
const PAYLOAD_QUESTION_LIMIT = 180;
const PAYLOAD_TITLE_LIMIT = 160;
const PAYLOAD_PART_TITLE_LIMIT = 120;
const PAYLOAD_EVIDENCE_LIMIT = 180;
const PAYLOAD_REASON_LIMIT = 90;
const OUTPUT_ANSWER_LIMIT = 260;
const LOW_AI_CONFIDENCE_THRESHOLD = 0.45;
const HIGH_CONFIDENCE_THRESHOLD = 0.78;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.62;

const CITABLE_SOURCES = new Set<CurrentVideoSegmentRetrievalCandidateSource>([
  'transcript_segment',
  'transcript_node',
  'chapter_node',
  'page_node',
]);

export interface CurrentVideoQaAiPayloadCandidate {
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

export interface CurrentVideoQaAiPayload {
  intent: 'current_video_qa_v1';
  question: string;
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
  candidates: CurrentVideoQaAiPayloadCandidate[];
  safetyRules: string[];
}

export interface CurrentVideoQaAiOutput {
  answer?: unknown;
  status?: unknown;
  confidence?: unknown;
  citedCandidateIds?: unknown;
}

export interface CurrentVideoQaChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AnswerCurrentVideoQuestionOptions {
  config: UserConfig;
  chat: (config: AiConfig, messages: CurrentVideoQaChatMessage[]) => Promise<CurrentVideoQaAiOutput>;
  now?: number;
  candidateLimit?: number;
  auditPayload?: (payload: CurrentVideoQaAiPayload) => void;
}

interface PayloadBuildResult {
  payload: CurrentVideoQaAiPayload;
  refs: Array<{
    payloadCandidateId: string;
    localCandidateId: string;
  }>;
}

type QaGuardResult =
  | {
      ok: true;
      answer: string;
      status: CurrentVideoQaStatus;
      confidence: number;
      citedPayloadCandidateIds: string[];
    }
  | {
      ok: false;
      reason: string;
      error: string;
      confidence?: number;
    };

type RetrievalForQa = Omit<CurrentVideoSegmentRetrievalResult, 'qa'> & {
  qa?: CurrentVideoQaResult;
};

export function buildLocalCurrentVideoQaResult(
  context: CurrentVideoContextResult,
  local: RetrievalForQa,
  options: { now?: number } = {},
): CurrentVideoQaResult {
  const now = options.now ?? local.generatedAt ?? Date.now();
  const citableSegments = buildCitedSegments(local.candidates);
  const topConfidence = citableSegments[0]?.confidence ?? 0;
  const status = localQaStatus(context, local, citableSegments);
  const confidence = localQaConfidence(status, topConfidence);

  return {
    status,
    answer: localQaAnswer(status, local, citableSegments),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    citedSegments: citableSegments,
    sourceState: {
      transcriptSegmentCount: local.evidenceState.transcriptSegmentCount,
      timedKnowledgeNodeCount: local.evidenceState.timedKnowledgeNodeCount,
      metadataHintAvailable: local.evidenceState.metadataHintAvailable,
      contextFresh: local.evidenceState.contextFresh,
      hasCitableEvidence: citableSegments.length > 0,
      hasOnlyMetadataHints: citableSegments.length === 0 && local.candidates.length > 0,
    },
    aiState: aiState({
      status: 'not_requested',
      model: null,
      note: '当前显示本地证据回答；本次没有请求 AI 整理回答。',
      now,
    }),
    limitations: localQaLimitations(status, local),
  };
}

export async function answerCurrentVideoQuestion(
  context: CurrentVideoContextResult,
  local: CurrentVideoSegmentRetrievalResult,
  options: AnswerCurrentVideoQuestionOptions,
): Promise<CurrentVideoSegmentRetrievalResult> {
  const now = options.now ?? Date.now();
  const model = options.config.ai.chatModel;
  const localQa = local.qa ?? buildLocalCurrentVideoQaResult(context, local, { now });

  if (context.kind !== 'video' || localQa.citedSegments.length === 0) {
    return withQa(local, {
      ...localQa,
      aiState: aiState({
        status: 'not_requested',
        model,
        note: '没有可发送给 AI 的当前视频字幕或节点引用片段，因此保留本地证据回答。',
        now,
      }),
    });
  }

  if (!options.config.assistant.currentVideoQaAiEnabled) {
    return withQa(local, {
      ...localQa,
      aiState: aiState({
        status: 'disabled',
        model,
        note: '当前视频问答 AI 未在设置中启用，因此显示本地证据回答。',
        now,
      }),
    });
  }

  if (!options.config.ai.apiKey.trim()) {
    return withQa(local, {
      ...localQa,
      aiState: aiState({
        status: 'not_configured',
        model,
        note: '当前视频问答 AI 已启用但尚未配置 API Key，因此显示本地证据回答。',
        now,
      }),
    });
  }

  try {
    const built = buildCurrentVideoQaAiPayload(context, local, {
      candidateLimit: options.candidateLimit,
    });
    (options.auditPayload ?? defaultAuditPayload)(built.payload);
    const ai = await options.chat(options.config.ai, buildCurrentVideoQaAiMessages(built.payload));
    const guarded = guardCurrentVideoQaAiOutput(ai, built.payload);
    if (!guarded.ok) {
      const status = guarded.reason === 'AI_LOW_CONFIDENCE' ? 'low_confidence' : 'rejected';
      return withQa(local, {
        ...localQa,
        aiState: aiState({
          status,
          model,
          note: status === 'low_confidence'
            ? 'AI 回答置信度较低，因此显示本地证据回答。'
            : 'AI 回答没有通过引用边界检查，因此显示本地证据回答。',
          error: guarded.error,
          now,
          payloadCandidateCount: built.payload.candidates.length,
        }),
      });
    }

    const localIdByPayloadId = new Map(built.refs.map(ref => [ref.payloadCandidateId, ref.localCandidateId]));
    const citedLocalIds = guarded.citedPayloadCandidateIds
      .map(id => localIdByPayloadId.get(id) ?? null)
      .filter((id): id is string => Boolean(id));
    const citedByLocalId = new Map(localQa.citedSegments.map(segment => [segment.candidateId, segment]));
    const citedSegments = citedLocalIds
      .map(id => citedByLocalId.get(id) ?? null)
      .filter((segment): segment is CurrentVideoQaCitedSegment => Boolean(segment));

    return withQa(local, {
      ...localQa,
      status: guarded.status,
      answer: guarded.answer,
      confidence: guarded.confidence,
      confidenceLabel: confidenceLabel(guarded.confidence),
      citedSegments,
      aiState: aiState({
        status: 'generated',
        model,
        note: 'AI 只基于本次 top-N 本地引用片段整理回答；时间点和跳转入口仍来自本地候选。',
        now,
        payloadCandidateCount: built.payload.candidates.length,
        citedCandidateIds: citedLocalIds,
      }),
      limitations: uniqueText([
        ...localQa.limitations,
        'AI 只整理本次提供的当前视频引用片段，不会生成新的时间点、证据或外部来源。',
      ]),
    });
  } catch (error) {
    return withQa(local, {
      ...localQa,
      aiState: aiState({
        status: 'failed',
        model,
        note: 'AI 回答请求失败，因此显示本地证据回答。',
        error: errorMessage(error),
        now,
      }),
    });
  }
}

export function buildCurrentVideoQaAiPayload(
  context: CurrentVideoContext,
  local: CurrentVideoSegmentRetrievalResult,
  options: { candidateLimit?: number } = {},
): PayloadBuildResult {
  const limit = Math.max(1, Math.floor(options.candidateLimit ?? DEFAULT_QA_CANDIDATE_LIMIT));
  const refs: PayloadBuildResult['refs'] = [];
  const candidates = local.candidates
    .filter(isCitableCandidate)
    .slice(0, limit)
    .map((candidate, index) => {
      const candidateId = `candidate-${index + 1}`;
      refs.push({
        payloadCandidateId: candidateId,
        localCandidateId: candidate.id,
      });
      return toPayloadCandidate(candidate, candidateId, index + 1);
    });

  return {
    payload: {
      intent: 'current_video_qa_v1',
      question: limitText(local.query, PAYLOAD_QUESTION_LIMIT),
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
        'Answer only from the provided current-video candidates.',
        'Use citedCandidateIds from the payload; do not create candidate IDs.',
        'Do not output timestamps, seconds, time ranges, raw IDs, source hashes, URLs, or new evidence.',
        'Do not mention comments, danmaku, audio, visuals, account ledgers, saved lists, creator relationship lists, browser state, session secrets, or local secret files.',
        'Return JSON only with answer, status, confidence, and citedCandidateIds.',
      ],
    },
    refs,
  };
}

export function buildCurrentVideoQaAiMessages(
  payload: CurrentVideoQaAiPayload,
): CurrentVideoQaChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are Bili-Bill current-video question answerer. Return JSON only.',
        'Local retrieval already produced the only allowed current-video evidence.',
        'Answer in Chinese, briefly, and start with whether the evidence says yes, no, or insufficient evidence.',
        'Use only candidateId values from the payload in citedCandidateIds.',
        'Do not output timestamps, seconds, time ranges, raw IDs, source hashes, URLs, new evidence, or outside sources.',
        'JSON schema: { "answer": string, "status": "answered"|"not_found"|"insufficient_evidence"|"low_confidence", "confidence": number, "citedCandidateIds": string[] }.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];
}

export function guardCurrentVideoQaAiOutput(
  ai: CurrentVideoQaAiOutput,
  payload: CurrentVideoQaAiPayload,
): QaGuardResult {
  const schemaError = findSchemaError(ai);
  if (schemaError) {
    return rejected('AI_SCHEMA_VIOLATION', `AI_SCHEMA_VIOLATION:${schemaError}`);
  }

  const root = ai as {
    answer: string;
    status: CurrentVideoQaStatus;
    confidence: number;
    citedCandidateIds: string[];
  };
  const answer = limitText(root.answer, OUTPUT_ANSWER_LIMIT);
  if (!answer) {
    return rejected('AI_EMPTY_ANSWER', 'AI_EMPTY_ANSWER');
  }

  const unsafeReference = findUnsafeAnswerReference(answer, payload);
  if (unsafeReference) {
    return rejected(unsafeReference.reason, unsafeReference.error);
  }

  const confidence = normalizeOptionalConfidence(root.confidence);
  if (confidence === null) {
    return rejected('AI_INVALID_CONFIDENCE', 'AI_INVALID_CONFIDENCE');
  }

  const cited = normalizeCitedCandidateIds(root.citedCandidateIds, payload);
  if (!cited.ok) {
    return rejected(cited.reason, cited.error);
  }

  if (confidence < LOW_AI_CONFIDENCE_THRESHOLD) {
    return {
      ok: false,
      reason: 'AI_LOW_CONFIDENCE',
      error: `AI_LOW_CONFIDENCE:${roundScore(confidence)}`,
      confidence,
    };
  }

  return {
    ok: true,
    answer,
    status: root.status,
    confidence,
    citedPayloadCandidateIds: cited.ids,
  };
}

function buildCitedSegments(
  candidates: CurrentVideoSegmentRetrievalCandidate[],
): CurrentVideoQaCitedSegment[] {
  return candidates
    .filter(isCitableCandidate)
    .slice(0, DEFAULT_QA_CANDIDATE_LIMIT)
    .map(candidate => ({
      candidateId: candidate.id,
      source: candidate.source,
      sourceLabel: candidate.sourceLabel,
      timeRangeLabel: candidate.timeRangeLabel,
      evidenceText: candidate.evidenceText,
      confidence: candidate.confidence,
      confidenceLabel: candidate.confidenceLabel,
      startSeconds: candidate.startSeconds,
      endSeconds: candidate.endSeconds,
    }));
}

function localQaStatus(
  context: CurrentVideoContextResult,
  local: RetrievalForQa,
  citableSegments: CurrentVideoQaCitedSegment[],
): CurrentVideoQaStatus {
  if (context.kind !== 'video' || local.status === 'no_context') return 'no_context';
  if (local.status === 'ready' && citableSegments.length > 0) return 'answered';
  if (local.status === 'low_confidence' && citableSegments.length > 0) return 'low_confidence';
  if (local.status === 'metadata_only') return 'no_transcript';
  if (local.status === 'no_evidence') {
    return local.evidenceState.transcriptSegmentCount > 0 || local.evidenceState.timedKnowledgeNodeCount > 0
      ? 'not_found'
      : 'no_transcript';
  }
  if (local.status === 'empty_query' || local.status === 'stale_context') return 'insufficient_evidence';
  return 'insufficient_evidence';
}

function localQaAnswer(
  status: CurrentVideoQaStatus,
  local: RetrievalForQa,
  citableSegments: CurrentVideoQaCitedSegment[],
): string {
  const citedCount = citableSegments.length;
  switch (status) {
    case 'answered':
      return `有。当前视频证据里找到 ${citedCount} 个可引用片段，下面的字幕或本地节点可用于核对答案。`;
    case 'not_found':
      return '没有。在当前已缓存的字幕正文或本地节点里，没有找到能回答这个问题的证据。';
    case 'low_confidence':
      return '证据不足。当前只找到弱相关片段，建议把问题改得更接近字幕原文后再试。';
    case 'no_transcript':
      return local.candidates.length > 0
        ? '证据不足。当前只看到标题、简介等弱提示，没有可引用的字幕正文或本地节点，不能完整回答这个问题。'
        : '证据不足。当前没有可引用的字幕正文或本地节点，不能生成完整视频回答。';
    case 'no_context':
      return '证据不足。当前没有识别到 B 站视频页，不能回答当前视频问题。';
    case 'insufficient_evidence':
    default:
      return '证据不足。当前视频证据还不足以回答这个问题。';
  }
}

function localQaConfidence(status: CurrentVideoQaStatus, topConfidence: number): number {
  switch (status) {
    case 'answered':
      return roundScore(Math.max(0.62, topConfidence));
    case 'not_found':
      return 0.55;
    case 'low_confidence':
      return Math.min(0.44, Math.max(0.25, topConfidence));
    case 'no_transcript':
      return 0.2;
    case 'no_context':
      return 0.1;
    case 'insufficient_evidence':
    default:
      return 0.3;
  }
}

function localQaLimitations(
  status: CurrentVideoQaStatus,
  local: RetrievalForQa,
): string[] {
  const base = [
    '回答只基于当前视频字幕正文或当前视频本地节点，不使用收藏、历史、关注或外部资料。',
    '引用片段和跳转时间只来自本地候选，跳转前仍需要预览并确认。',
  ];
  if (status === 'no_transcript') {
    return uniqueText([
      ...base,
      '没有字幕正文或本地节点时，只能提示证据不足，不能生成完整视频回答。',
    ]);
  }
  if (status === 'not_found') {
    return uniqueText([
      ...base,
      '没有命中时表示当前已缓存证据内未找到，不代表整站或未缓存内容不存在。',
    ]);
  }
  if (status === 'low_confidence') {
    return uniqueText([
      ...base,
      '低置信片段只作为核对线索，不会直接建议跳转。',
    ]);
  }
  return uniqueText([...base, ...local.limitations.slice(0, 1)]);
}

function toPayloadCandidate(
  candidate: CurrentVideoSegmentRetrievalCandidate,
  candidateId: string,
  localRank: number,
): CurrentVideoQaAiPayloadCandidate {
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
    if (key !== 'answer' && key !== 'status' && key !== 'confidence' && key !== 'citedCandidateIds') {
      return `AI 输出包含不允许的字段：${key}`;
    }
  }
  if (typeof root.answer !== 'string') return 'AI 输出缺少 answer 字符串。';
  if (
    root.status !== 'answered'
    && root.status !== 'not_found'
    && root.status !== 'insufficient_evidence'
    && root.status !== 'low_confidence'
  ) {
    return 'AI 输出 status 不在允许范围内。';
  }
  if (typeof root.confidence !== 'number' || !Number.isFinite(root.confidence)) {
    return 'AI 输出 confidence 必须是数字。';
  }
  if (!Array.isArray(root.citedCandidateIds)) {
    return 'AI 输出缺少 citedCandidateIds 数组。';
  }
  return null;
}

function normalizeCitedCandidateIds(
  value: unknown[],
  payload: CurrentVideoQaAiPayload,
): { ok: true; ids: string[] } | { ok: false; reason: string; error: string } {
  if (value.length === 0) {
    return { ok: false, reason: 'AI_MISSING_CITED_CANDIDATES', error: 'AI_MISSING_CITED_CANDIDATES' };
  }

  const allowedIds = new Set(payload.candidates.map(candidate => candidate.candidateId));
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of value) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id) {
      return { ok: false, reason: 'AI_INVALID_CITED_CANDIDATE_ID', error: 'AI_INVALID_CITED_CANDIDATE_ID' };
    }
    if (!allowedIds.has(id)) {
      return { ok: false, reason: 'AI_UNKNOWN_CANDIDATE_ID', error: `AI_UNKNOWN_CANDIDATE_ID:${id}` };
    }
    if (seen.has(id)) {
      return { ok: false, reason: 'AI_DUPLICATE_CANDIDATE_ID', error: `AI_DUPLICATE_CANDIDATE_ID:${id}` };
    }
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}

function findUnsafeAnswerReference(
  answer: string,
  payload: CurrentVideoQaAiPayload,
): { reason: string; error: string } | null {
  if (containsTimestampText(answer)) {
    return { reason: 'AI_TIMESTAMP_OUT_OF_SCHEMA', error: `AI_TIMESTAMP_OUT_OF_SCHEMA:${limitText(answer, 80)}` };
  }
  if (containsUnavailableSource(answer)) {
    return { reason: 'AI_UNAVAILABLE_SOURCE_REFERENCE', error: `AI_UNAVAILABLE_SOURCE_REFERENCE:${limitText(answer, 80)}` };
  }
  if (containsRawInternalReference(answer)) {
    return { reason: 'AI_RAW_REFERENCE_LEAK', error: `AI_RAW_REFERENCE_LEAK:${limitText(answer, 80)}` };
  }
  const allowedText = normalizeText([
    payload.question,
    payload.video.title,
    payload.video.currentPart.title,
    ...payload.candidates.flatMap(candidate => [
      candidate.sourceLabel,
      candidate.evidenceSnippet,
      ...candidate.matchReasons,
      candidate.note ?? '',
    ]),
  ].join(' '));
  const outsideTitle = findOutsideBracketTitle(answer, allowedText);
  if (outsideTitle) {
    return { reason: 'AI_OUTSIDE_TITLE_REFERENCE', error: `AI_OUTSIDE_TITLE_REFERENCE:${outsideTitle}` };
  }
  return null;
}

function aiState(input: {
  status: CurrentVideoQaAiState['status'];
  model: string | null;
  note: string;
  now: number;
  error?: string | null;
  payloadCandidateCount?: number;
  citedCandidateIds?: string[];
}): CurrentVideoQaAiState {
  return {
    status: input.status,
    model: input.model,
    note: input.note,
    error: input.error ?? null,
    generatedAt: input.now,
    payloadCandidateCount: input.payloadCandidateCount ?? 0,
    citedCandidateIds: input.citedCandidateIds ?? [],
  };
}

function withQa(
  local: CurrentVideoSegmentRetrievalResult,
  qa: CurrentVideoQaResult,
): CurrentVideoSegmentRetrievalResult {
  return {
    ...local,
    qa,
  };
}

function rejected(reason: string, error: string): QaGuardResult {
  return {
    ok: false,
    reason,
    error,
  };
}

function defaultAuditPayload(payload: CurrentVideoQaAiPayload): void {
  assertAssistantPayloadAudit(payload, currentVideoQaPayloadContract);
}

function isCitableCandidate(candidate: CurrentVideoSegmentRetrievalCandidate): boolean {
  return CITABLE_SOURCES.has(candidate.source);
}

function confidenceLabel(confidence: number): CurrentVideoSegmentRetrievalConfidenceLabel {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return '高';
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return '中';
  return '低';
}

function containsTimestampText(value: string): boolean {
  return /(^|[^\d])\d{1,2}:\d{2}(?::\d{2})?($|[^\d])/.test(value);
}

function containsUnavailableSource(value: string): boolean {
  return /弹幕|评论|画面|音频|完整历史|完整收藏|完整关注|反馈记录|Cookie|登录态|sourceHash|segmentId|字幕全文|完整字幕|raw subtitle|profile|Key\.txt/i.test(value);
}

function containsRawInternalReference(value: string): boolean {
  return /\bcandidate-\d+\b|candidate:|transcript:|node:|sourceHash|segmentId|subtitle_url|token/i.test(value);
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
