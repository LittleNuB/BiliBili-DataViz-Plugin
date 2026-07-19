import type { CurrentVideoFullTextRequestEnvelope } from './current-video-primary-text.ts';
import type { AiConfig } from './types/config.ts';
import type { CurrentVideoFullTextQaCitation } from './types/current-video-full-text-qa.ts';
import {
  assertAssistantPayloadAudit,
  currentVideoFullTextQaPayloadContract,
} from './assistant-payload-audit.ts';

export interface CurrentVideoFullTextQaAiPayload {
  intent: 'current_video_full_text_qa_v1';
  outputRules: string[];
  source: {
    label: 'B站字幕' | '本地转录';
    language: string | null;
  };
  textLines: Array<{
    lineNo: number;
    startSeconds: number;
    endSeconds: number;
    text: string;
  }>;
  request: {
    requestId: string;
    turnId: string;
    operation: 'qa';
    submittedAt: number;
    model: string;
    lineCount: number;
    charCount: number;
    utf8Bytes: number;
  };
  question: string;
}

export interface CurrentVideoFullTextQaAiOutput {
  supported?: unknown;
  answerPoints?: unknown;
  citations?: unknown;
}

export interface CurrentVideoFullTextQaValidatedAnswerPoint {
  text: string;
  evidenceLineNumbers: number[];
}

export type CurrentVideoFullTextQaChat = (
  config: AiConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  options?: { signal?: AbortSignal },
) => Promise<CurrentVideoFullTextQaAiOutput>;

export type CurrentVideoFullTextQaValidationResult =
  | {
      ok: true;
      kind: 'answered';
      answerPoints: CurrentVideoFullTextQaValidatedAnswerPoint[];
      answer: string;
      answerEvidenceLineNumbers: number[];
      citations: Array<Omit<CurrentVideoFullTextQaCitation, 'sourceLabel' | 'binding'>>;
    }
  | {
      ok: true;
      kind: 'unsupported';
      answer: string;
      answerEvidenceLineNumbers: [];
      citations: [];
    }
  | { ok: false; reason: string };

const MAX_ANSWER_CHARS = 4_000;
const MAX_ANSWER_POINTS = 4;
const MAX_ANSWER_POINT_CHARS = 1_500;
const MAX_ANSWER_EVIDENCE_LINES = 36;
const MAX_CITATION_LINES = 12;
const UNSUPPORTED_ANSWER = '当前视频文本没有足够内容回答这个问题。';

export function buildCurrentVideoFullTextQaAiPayload(
  envelope: CurrentVideoFullTextRequestEnvelope,
  question: string,
): CurrentVideoFullTextQaAiPayload {
  if (envelope.operation !== 'qa' || !envelope.turnId?.trim()) {
    throw new Error('FULL_TEXT_QA_REQUEST_IDENTITY_INVALID');
  }
  const normalizedQuestion = question.replace(/\s+/g, ' ').trim();
  if (!normalizedQuestion) throw new Error('FULL_TEXT_QA_QUESTION_EMPTY');

  return {
    intent: 'current_video_full_text_qa_v1',
    outputRules: [
      '只返回 JSON 对象，不要 Markdown。',
      '只能依据 textLines 回答，不得使用标题、简介、通用知识或其他视频内容。',
      '有充分依据时返回 supported=true、1-4 条 answerPoints，以及 1-3 条 citations。',
      '每条 answerPoint 只包含 text 和 evidenceLineNumbers；text 是直接中文回答的一部分。',
      '每条 citation 只包含 evidenceLineNumbers，行号必须连续且来自 textLines。',
      '每条 answerPoint 的 evidenceLineNumbers 必须全部出现在 citations 引用的行号中。',
      '正文不足以支持回答时返回 supported=false，citations 为空；不要猜测或补全。',
      '不要返回视频身份、来源标识、时间戳或引用正文，系统会从本地行号生成引用。',
    ],
    source: {
      label: envelope.sourceLabel,
      language: envelope.language,
    },
    textLines: envelope.text.lines.map(line => ({
      lineNo: line.lineNo,
      startSeconds: line.startSeconds,
      endSeconds: line.endSeconds,
      text: line.text,
    })),
    request: {
      requestId: envelope.requestId,
      turnId: envelope.turnId,
      operation: 'qa',
      submittedAt: envelope.submittedAt,
      model: envelope.model,
      lineCount: envelope.text.lineCount,
      charCount: envelope.text.charCount,
      utf8Bytes: envelope.text.utf8Bytes,
    },
    question: normalizedQuestion,
  };
}

export function buildCurrentVideoFullTextQaMessages(
  payload: CurrentVideoFullTextQaAiPayload,
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        '你是当前视频正文问答助手，只能依据用户提供的带编号时间行回答。',
        '先形成直接、自然的中文答案，再给出支撑答案的行号；证据不足时必须拒答。',
        '禁止使用标题、简介、常识或其他视频内容补全，禁止编造引用、正文或时间。',
        '返回 JSON 对象，字段为 supported、answerPoints、citations。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

export async function requestCurrentVideoFullTextQaAi(
  config: AiConfig,
  payload: CurrentVideoFullTextQaAiPayload,
  envelope: CurrentVideoFullTextRequestEnvelope,
  chat: CurrentVideoFullTextQaChat,
  options: { signal?: AbortSignal } = {},
): Promise<CurrentVideoFullTextQaAiOutput> {
  assertAssistantPayloadAudit(payload, currentVideoFullTextQaPayloadContract);
  assertCompleteFullTextQaPayload(payload, envelope);
  return await chat(config, buildCurrentVideoFullTextQaMessages(payload), options);
}

export function validateCurrentVideoFullTextQaAiOutput(
  output: unknown,
  envelope: CurrentVideoFullTextRequestEnvelope,
): CurrentVideoFullTextQaValidationResult {
  if (!output || typeof output !== 'object') return invalid('output_not_object');
  const record = output as CurrentVideoFullTextQaAiOutput;
  if (typeof record.supported !== 'boolean') return invalid('supported_invalid');

  if (!record.supported) {
    if (
      record.answerPoints !== undefined
      && (!Array.isArray(record.answerPoints) || record.answerPoints.length > 0)
    ) {
      return invalid('unsupported_has_answer_points');
    }
    if (record.citations !== undefined && (!Array.isArray(record.citations) || record.citations.length > 0)) {
      return invalid('unsupported_has_citations');
    }
    return {
      ok: true,
      kind: 'unsupported',
      answer: UNSUPPORTED_ANSWER,
      answerEvidenceLineNumbers: [],
      citations: [],
    };
  }

  if (!Array.isArray(record.answerPoints) || record.answerPoints.length < 1 || record.answerPoints.length > MAX_ANSWER_POINTS) {
    return invalid('answer_point_count');
  }

  if (!Array.isArray(record.citations) || record.citations.length < 1 || record.citations.length > 3) {
    return invalid('citation_count');
  }

  const lineMap = new Map(envelope.text.lines.map(line => [line.lineNo, line]));
  const answerPoints: CurrentVideoFullTextQaValidatedAnswerPoint[] = [];
  const answerEvidenceLineNumbers = new Set<number>();
  for (const item of record.answerPoints) {
    if (!item || typeof item !== 'object') return invalid('answer_point_invalid');
    const point = item as { text?: unknown; evidenceLineNumbers?: unknown };
    const text = typeof point.text === 'string' ? point.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > MAX_ANSWER_POINT_CHARS || !/[\u3400-\u9fff]/u.test(text)) {
      return invalid('answer_point_text_invalid');
    }
    const evidence = normalizeLineNumbers(point.evidenceLineNumbers, MAX_ANSWER_EVIDENCE_LINES);
    if (!evidence.ok) return invalid(`answer_point_${evidence.reason}`);
    if (!evidence.lineNumbers.every(lineNo => lineMap.has(lineNo))) {
      return invalid('answer_point_evidence_line_missing');
    }
    evidence.lineNumbers.forEach(lineNo => answerEvidenceLineNumbers.add(lineNo));
    answerPoints.push({ text, evidenceLineNumbers: evidence.lineNumbers });
  }
  const answer = answerPoints.map(point => point.text).join('\n\n');
  if (answer.length > MAX_ANSWER_CHARS) return invalid('answer_too_long');

  const citations: Array<Omit<CurrentVideoFullTextQaCitation, 'sourceLabel' | 'binding'>> = [];
  const citedLineNumbers = new Set<number>();
  for (const [index, item] of record.citations.entries()) {
    if (!item || typeof item !== 'object') return invalid('citation_invalid');
    const normalized = normalizeLineNumbers(
      (item as { evidenceLineNumbers?: unknown }).evidenceLineNumbers,
      MAX_CITATION_LINES,
    );
    if (!normalized.ok) return invalid(`citation_${normalized.reason}`);
    if (!normalized.lineNumbers.every(lineNo => lineMap.has(lineNo))) {
      return invalid('citation_line_missing');
    }
    if (!linesAreContiguous(normalized.lineNumbers)) {
      return invalid('citation_lines_not_contiguous');
    }
    normalized.lineNumbers.forEach(lineNo => citedLineNumbers.add(lineNo));
    const lines = normalized.lineNumbers.map(lineNo => lineMap.get(lineNo)!);
    const startSeconds = lines[0]!.startSeconds;
    const endSeconds = lines[lines.length - 1]!.endSeconds;
    citations.push({
      id: `citation-${index + 1}`,
      evidenceLineNumbers: normalized.lineNumbers,
      evidenceText: lines.map(line => line.text).join(' '),
      startSeconds,
      endSeconds,
      timeRangeLabel: formatTimeRange(startSeconds, endSeconds),
    });
  }

  if (!Array.from(answerEvidenceLineNumbers).every(lineNo => citedLineNumbers.has(lineNo))) {
    return invalid('answer_point_evidence_not_cited');
  }

  return {
    ok: true,
    kind: 'answered',
    answerPoints,
    answer,
    answerEvidenceLineNumbers: Array.from(answerEvidenceLineNumbers).sort((a, b) => a - b),
    citations,
  };
}

function assertCompleteFullTextQaPayload(
  payload: CurrentVideoFullTextQaAiPayload,
  envelope: CurrentVideoFullTextRequestEnvelope,
): void {
  const complete = envelope.operation === 'qa'
    && Boolean(envelope.turnId)
    && payload.request.requestId === envelope.requestId
    && payload.request.turnId === envelope.turnId
    && payload.request.operation === envelope.operation
    && payload.request.lineCount === envelope.text.lineCount
    && payload.request.charCount === envelope.text.charCount
    && payload.request.utf8Bytes === envelope.text.utf8Bytes
    && payload.textLines.length === envelope.text.lines.length
    && payload.textLines.every((line, index) => {
      const captured = envelope.text.lines[index];
      return Boolean(captured)
        && line.lineNo === captured!.lineNo
        && line.startSeconds === captured!.startSeconds
        && line.endSeconds === captured!.endSeconds
        && line.text === captured!.text;
    });
  if (!complete) {
    throw new Error('完整文本问答请求未包含本次捕获的全部正文。');
  }
}

function normalizeLineNumbers(
  value: unknown,
  maxCount: number,
): { ok: true; lineNumbers: number[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || value.length < 1) return { ok: false, reason: 'evidence_missing' };
  if (value.length > maxCount) return { ok: false, reason: 'evidence_too_many' };
  if (!value.every(item => Number.isInteger(item) && Number(item) > 0)) {
    return { ok: false, reason: 'evidence_invalid' };
  }
  const lineNumbers = Array.from(new Set(value.map(Number))).sort((a, b) => a - b);
  if (lineNumbers.length !== value.length) return { ok: false, reason: 'evidence_duplicate' };
  return { ok: true, lineNumbers };
}

function linesAreContiguous(lineNumbers: number[]): boolean {
  return lineNumbers.every((lineNo, index) => index === 0 || lineNo === lineNumbers[index - 1]! + 1);
}

function formatTimeRange(startSeconds: number, endSeconds: number): string {
  return `${formatSeconds(startSeconds)}-${formatSeconds(endSeconds)}`;
}

function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function invalid(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
