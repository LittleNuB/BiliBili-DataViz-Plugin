import type {
  CurrentVideoFullTextRequestEnvelope,
} from './current-video-primary-text.ts';
import type {
  CurrentVideoSummaryHighlight,
  CurrentVideoSummaryHighlightsAiState,
  CurrentVideoSummaryHighlightsRequestSnapshot,
  CurrentVideoSummaryHighlightsResult,
  CurrentVideoSummaryHighlightsTextSize,
  CurrentVideoSummaryKeyPoint,
  CurrentVideoSummarySentence,
} from './types/current-video-summary.ts';

export interface CurrentVideoSummaryHighlightsAiPayload {
  intent: 'current_video_summary_highlights_v1';
  request: {
    requestId: string;
    operation: 'summary_highlights';
    submittedAt: number;
    model: string;
    lineCount: number;
    charCount: number;
    utf8Bytes: number;
  };
  video: {
    title: string | null;
    partTitle: string | null;
    durationSeconds: number | null;
  };
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
  outputRules: string[];
}

export interface CurrentVideoSummaryHighlightsAiOutput {
  summarySentences?: unknown;
  keyPoints?: unknown;
  highlights?: unknown;
}

export type CurrentVideoSummaryHighlightsValidationResult =
  | {
      ok: true;
      result: Pick<CurrentVideoSummaryHighlightsResult, 'summarySentences' | 'keyPoints' | 'highlights'>;
    }
  | {
      ok: false;
      reason: string;
    };

interface TextItemRecord {
  text: string;
  evidenceLineNumbers: number[];
}

interface HighlightRecord extends TextItemRecord {
  title: string;
  description: string;
  startSeconds: number;
  endSeconds: number;
}

export function buildCurrentVideoSummaryHighlightsAiPayload(
  envelope: CurrentVideoFullTextRequestEnvelope,
): CurrentVideoSummaryHighlightsAiPayload {
  return {
    intent: 'current_video_summary_highlights_v1',
    request: {
      requestId: envelope.requestId,
      operation: 'summary_highlights',
      submittedAt: envelope.submittedAt,
      model: envelope.model,
      lineCount: envelope.text.lineCount,
      charCount: envelope.text.charCount,
      utf8Bytes: envelope.text.utf8Bytes,
    },
    video: {
      title: envelope.video.title,
      partTitle: envelope.video.partTitle,
      durationSeconds: envelope.video.durationSeconds,
    },
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
    outputRules: [
      '只返回 JSON 对象，不要 Markdown。',
      'summarySentences 必须是 2-4 条中文句子，每条包含 text 和 evidenceLineNumbers。',
      'keyPoints 必须是 3-5 条有序中文要点，每条包含 text 和 evidenceLineNumbers。',
      'highlights 必须是 4-8 条，按出现时间排序；每条包含 title、description、startSeconds、endSeconds、evidenceLineNumbers。',
      '所有 evidenceLineNumbers 必须引用 textLines 中存在的 lineNo。',
      '每个 highlight 的 startSeconds/endSeconds 必须来自引用行附近，且时间范围要与至少一条引用行重叠。',
      '不要返回视频身份、分 P 身份、版本号或来源标识。',
    ],
  };
}

export function buildCurrentVideoSummaryHighlightsMessages(
  payload: CurrentVideoSummaryHighlightsAiPayload,
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        '你是当前视频正文摘要助手。你只能依据用户提供的带编号时间行生成内容。',
        '禁止补充未出现在正文中的事实，禁止编造时间戳，禁止返回视频身份或来源标识。',
        '返回 JSON 对象，字段为 summarySentences、keyPoints、highlights。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];
}

export function validateCurrentVideoSummaryHighlightsAiOutput(
  output: unknown,
  envelope: CurrentVideoFullTextRequestEnvelope,
): CurrentVideoSummaryHighlightsValidationResult {
  if (!output || typeof output !== 'object') {
    return invalid('output_not_object');
  }
  const record = output as CurrentVideoSummaryHighlightsAiOutput;
  const summaryItems = normalizeTextRecords(record.summarySentences, 'summary_sentences');
  if (!summaryItems.ok) return invalid(summaryItems.reason);
  if (summaryItems.items.length < 2 || summaryItems.items.length > 4) {
    return invalid('summary_sentence_count');
  }

  const keyPointItems = normalizeTextRecords(record.keyPoints, 'key_points');
  if (!keyPointItems.ok) return invalid(keyPointItems.reason);
  if (keyPointItems.items.length < 3 || keyPointItems.items.length > 5) {
    return invalid('key_point_count');
  }

  const highlightItems = normalizeHighlightRecords(record.highlights);
  if (!highlightItems.ok) return invalid(highlightItems.reason);
  if (highlightItems.items.length < 4 || highlightItems.items.length > 8) {
    return invalid('highlight_count');
  }

  const lineMap = new Map(envelope.text.lines.map(line => [line.lineNo, line]));
  const allTextItems = [...summaryItems.items, ...keyPointItems.items];
  for (const item of allTextItems) {
    if (!hasChineseText(item.text)) return invalid('non_chinese_text');
    if (!evidenceLinesExist(item.evidenceLineNumbers, lineMap)) {
      return invalid('evidence_line_missing');
    }
  }

  let lastHighlightStart = -1;
  for (const item of highlightItems.items) {
    if (!hasChineseText(item.title) || !hasChineseText(item.description)) {
      return invalid('non_chinese_highlight');
    }
    if (!evidenceLinesExist(item.evidenceLineNumbers, lineMap)) {
      return invalid('highlight_evidence_line_missing');
    }
    if (!validHighlightBounds(item, envelope.video.durationSeconds)) {
      return invalid('highlight_bounds_invalid');
    }
    if (item.startSeconds < lastHighlightStart) {
      return invalid('highlight_order_invalid');
    }
    if (!highlightOverlapsEvidence(item, lineMap)) {
      return invalid('highlight_evidence_time_mismatch');
    }
    lastHighlightStart = item.startSeconds;
  }

  return {
    ok: true,
    result: {
      summarySentences: summaryItems.items.map((item, index): CurrentVideoSummarySentence => ({
        id: `summary-${index + 1}`,
        text: item.text,
        evidenceLineNumbers: item.evidenceLineNumbers,
      })),
      keyPoints: keyPointItems.items.map((item, index): CurrentVideoSummaryKeyPoint => ({
        id: `key-point-${index + 1}`,
        text: item.text,
        evidenceLineNumbers: item.evidenceLineNumbers,
      })),
      highlights: highlightItems.items.map((item, index): CurrentVideoSummaryHighlight => ({
        id: `highlight-${index + 1}`,
        title: item.title,
        description: item.description,
        startSeconds: item.startSeconds,
        endSeconds: item.endSeconds,
        timeRangeLabel: formatTimeRange(item.startSeconds, item.endSeconds),
        evidenceLineNumbers: item.evidenceLineNumbers,
      })),
    },
  };
}

export function requestSnapshotFromEnvelope(
  envelope: CurrentVideoFullTextRequestEnvelope,
): CurrentVideoSummaryHighlightsRequestSnapshot {
  return {
    requestId: envelope.requestId,
    operation: 'summary_highlights',
    submittedAt: envelope.submittedAt,
    model: envelope.model,
    primaryTextIdentity: {
      bvid: envelope.primaryTextIdentity.bvid,
      cid: envelope.primaryTextIdentity.cid,
      page: envelope.primaryTextIdentity.page,
      source: envelope.primaryTextIdentity.source,
      sourceType: envelope.primaryTextIdentity.sourceType,
      language: envelope.primaryTextIdentity.language,
      bodyHash: envelope.primaryTextIdentity.bodyHash,
      timelineHash: envelope.primaryTextIdentity.timelineHash,
      sourceHash: envelope.primaryTextIdentity.sourceHash,
      sourceIdentityKey: envelope.primaryTextIdentity.sourceIdentityKey,
      lineCount: envelope.primaryTextIdentity.lineCount,
    },
    text: {
      lineCount: envelope.text.lineCount,
      charCount: envelope.text.charCount,
      utf8Bytes: envelope.text.utf8Bytes,
      lines: envelope.text.lines.map(line => ({
        lineNo: line.lineNo,
        startSeconds: line.startSeconds,
        endSeconds: line.endSeconds,
        text: line.text,
      })),
    },
  };
}

export function notRequestedCurrentVideoSummaryHighlights(
  title = '当前视频',
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'not_requested',
    title,
    message: '可在这里手动生成摘要与亮点；打开面板不会自动发送正文。',
    ai: aiState('not_requested', null, '尚未请求生成。'),
    now,
  });
}

export function loadingCurrentVideoSummaryHighlights(now = Date.now()): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'loading',
    title: '当前视频',
    message: '正在准备当前正文快照...',
    ai: aiState('not_requested', null, '正在本地准备请求，尚未收到生成结果。'),
    now,
  });
}

export function generatingCurrentVideoSummaryHighlights(
  textSize: CurrentVideoSummaryHighlightsTextSize,
  model: string | null,
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'generating',
    title: '当前视频',
    message: `正在生成摘要与亮点，已提交 ${formatTextSize(textSize)}。生成会消耗一次完整正文请求，请稍等。`,
    textSize,
    model,
    ai: aiState('not_requested', model, '已由用户手动触发，等待模型返回。'),
    now,
  });
}

export function disabledCurrentVideoSummaryHighlights(
  title: string,
  model: string | null,
  textSize: CurrentVideoSummaryHighlightsTextSize,
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'error',
    title,
    message: '当前视频 AI 助手未开启，本次没有发送正文。',
    textSize,
    model,
    ai: aiState('disabled', model, '请在设置中开启“当前视频 AI 助手”后，再手动生成。'),
    limitations: ['开启开关本身不会发送正文，仍需再次点击生成。'],
    now,
  });
}

export function notConfiguredCurrentVideoSummaryHighlights(
  title: string,
  model: string | null,
  textSize: CurrentVideoSummaryHighlightsTextSize,
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'error',
    title,
    message: 'AI 服务尚未配置完整，本次没有发送正文。',
    textSize,
    model,
    ai: aiState('not_configured', model, '请先配置服务地址、模型和 API Key。'),
    limitations: ['配置完成后需要再次点击生成；不会自动补发。'],
    now,
  });
}

export function noTextCurrentVideoSummaryHighlights(
  title: string,
  model: string | null,
  textSize: CurrentVideoSummaryHighlightsTextSize,
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'no_text',
    title,
    message: '当前没有可用的主要正文，无法生成摘要与亮点。',
    textSize,
    model,
    ai: aiState('not_requested', model, '没有读取到用户授权的当前正文，因此没有请求 AI。'),
    limitations: ['请先在视频页检测字幕，并明确选择主要文本来源。'],
    now,
  });
}

export function invalidCurrentVideoSummaryHighlights(
  title: string,
  model: string | null,
  reason: string,
  textSize: CurrentVideoSummaryHighlightsTextSize,
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'invalid_output',
    title,
    message: '模型返回的摘要与亮点没有通过校验，旧结果不会被替换。',
    textSize,
    model,
    ai: aiState('invalid_output', model, '已拒绝本次结果。', reason),
    limitations: ['请稍后重试；系统不会采用缺少证据行或时间不匹配的内容。'],
    now,
  });
}

export function failedCurrentVideoSummaryHighlights(
  title: string,
  model: string | null,
  error: string,
  textSize: CurrentVideoSummaryHighlightsTextSize,
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  const contextTooLong = /AI_REQUEST_FAILED_(400|413)|context|length|token/i.test(error);
  return baseResult({
    status: 'error',
    title,
    message: contextTooLong
      ? '当前正文过长，模型没有接受本次完整请求；系统不会截断或分段发送。'
      : '摘要与亮点生成失败，旧结果不会被替换。',
    textSize,
    model,
    ai: aiState(contextTooLong ? 'context_too_long' : 'failed', model, contextTooLong
      ? '请换用支持更长上下文的模型，或等待后续版本提供明确的长文本处理方案。'
      : '请确认 AI 设置可用后再重试。', error),
    limitations: ['本次失败不会写入缓存，也不会生成推测时间戳。'],
    now,
  });
}

export function cancelledCurrentVideoSummaryHighlights(
  title: string,
  model: string | null,
  textSize: CurrentVideoSummaryHighlightsTextSize,
  note = '本次生成已取消，旧结果不会被替换。',
  now = Date.now(),
): CurrentVideoSummaryHighlightsResult {
  return baseResult({
    status: 'cancelled',
    title,
    message: note,
    textSize,
    model,
    ai: aiState('cancelled', model, note),
    limitations: ['如需更新，请重新点击生成。'],
    now,
  });
}

export function readyCurrentVideoSummaryHighlights(input: {
  title: string;
  sourceLabel: 'B站字幕' | '本地转录';
  textSize: CurrentVideoSummaryHighlightsTextSize;
  summarySentences: CurrentVideoSummarySentence[];
  keyPoints: CurrentVideoSummaryKeyPoint[];
  highlights: CurrentVideoSummaryHighlight[];
  model: string;
  cacheKey: string;
  cacheHit: boolean;
  current: boolean;
  requestId: string;
  generatedAt: number;
}): CurrentVideoSummaryHighlightsResult {
  return {
    status: 'ready',
    title: input.title,
    message: input.current
      ? `已生成 ${input.summarySentences.length} 条摘要、${input.keyPoints.length} 个要点和 ${input.highlights.length} 个亮点。`
      : '结果已写入对应视频缓存；当前页面已变化，因此没有覆盖当前视图。',
    sourceLabel: input.sourceLabel,
    textSize: input.textSize,
    summarySentences: input.summarySentences,
    keyPoints: input.keyPoints,
    highlights: input.highlights,
    limitations: ['摘要区不展示正文摘录；亮点时间只来自已校验的当前正文行。'],
    ai: aiState('generated', input.model, input.cacheHit ? '已从本地缓存读取。' : '已完成模型生成并通过本地校验。'),
    generatedAt: input.generatedAt,
    model: input.model,
    cacheKey: input.cacheKey,
    cacheHit: input.cacheHit,
    current: input.current,
    requestId: input.requestId,
  };
}

export function textSizeFromEnvelope(envelope: CurrentVideoFullTextRequestEnvelope): CurrentVideoSummaryHighlightsTextSize {
  return {
    lineCount: envelope.text.lineCount,
    charCount: envelope.text.charCount,
    utf8Bytes: envelope.text.utf8Bytes,
  };
}

export function approximateTextSize(lineCount: number, utf8Bytes?: number | null): CurrentVideoSummaryHighlightsTextSize {
  return {
    lineCount: Math.max(0, Math.floor(lineCount)),
    charCount: null,
    utf8Bytes: Math.max(0, Math.floor(utf8Bytes ?? 0)),
  };
}

export function formatTextSize(size: CurrentVideoSummaryHighlightsTextSize): string {
  const bytes = formatBytes(size.utf8Bytes);
  if (size.charCount === null) {
    return `${size.lineCount} 行，约 ${bytes}`;
  }
  return `${size.lineCount} 行，${size.charCount} 字符，${bytes}`;
}

export function formatTimeRange(startSeconds: number, endSeconds: number): string {
  return `${formatDuration(startSeconds)}-${formatDuration(endSeconds)}`;
}

function normalizeTextRecords(
  value: unknown,
  label: string,
): { ok: true; items: TextItemRecord[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: `${label}_not_array` };
  const items: TextItemRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return { ok: false, reason: `${label}_item_not_object` };
    const record = item as Record<string, unknown>;
    const text = normalizeText(record.text);
    const evidenceLineNumbers = normalizeEvidenceLines(record);
    if (!text) return { ok: false, reason: `${label}_text_missing` };
    if (!evidenceLineNumbers.length) return { ok: false, reason: `${label}_evidence_missing` };
    items.push({ text, evidenceLineNumbers });
  }
  return { ok: true, items };
}

function normalizeHighlightRecords(
  value: unknown,
): { ok: true; items: HighlightRecord[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: 'highlights_not_array' };
  const items: HighlightRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return { ok: false, reason: 'highlight_item_not_object' };
    const record = item as Record<string, unknown>;
    const title = normalizeText(record.title);
    const description = normalizeText(record.description);
    const startSeconds = normalizeSeconds(record.startSeconds);
    const endSeconds = normalizeSeconds(record.endSeconds);
    const evidenceLineNumbers = normalizeEvidenceLines(record);
    if (!title) return { ok: false, reason: 'highlight_title_missing' };
    if (!description) return { ok: false, reason: 'highlight_description_missing' };
    if (startSeconds === null || endSeconds === null) return { ok: false, reason: 'highlight_time_missing' };
    if (!evidenceLineNumbers.length) return { ok: false, reason: 'highlight_evidence_missing' };
    items.push({
      text: description,
      title,
      description,
      startSeconds,
      endSeconds,
      evidenceLineNumbers,
    });
  }
  return { ok: true, items };
}

function normalizeEvidenceLines(record: Record<string, unknown>): number[] {
  const raw = record.evidenceLineNumbers ?? record.evidenceLines ?? record.lineNumbers;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const item of raw) {
    const lineNo = Math.floor(Number(item));
    if (Number.isInteger(lineNo) && lineNo > 0) {
      seen.add(lineNo);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function normalizeSeconds(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(Math.max(0, numeric) * 1000) / 1000;
}

function evidenceLinesExist(
  lineNumbers: number[],
  lineMap: Map<number, CurrentVideoFullTextRequestEnvelope['text']['lines'][number]>,
): boolean {
  return lineNumbers.length > 0 && lineNumbers.every(lineNo => lineMap.has(lineNo));
}

function validHighlightBounds(item: HighlightRecord, durationSeconds: number | null): boolean {
  if (!Number.isFinite(item.startSeconds) || !Number.isFinite(item.endSeconds)) return false;
  if (item.startSeconds < 0 || item.endSeconds <= item.startSeconds) return false;
  if (durationSeconds !== null && item.endSeconds > durationSeconds + 1) return false;
  return true;
}

function highlightOverlapsEvidence(
  item: HighlightRecord,
  lineMap: Map<number, CurrentVideoFullTextRequestEnvelope['text']['lines'][number]>,
): boolean {
  return item.evidenceLineNumbers.some((lineNo) => {
    const line = lineMap.get(lineNo);
    if (!line) return false;
    return Math.max(item.startSeconds, line.startSeconds) < Math.min(item.endSeconds, line.endSeconds);
  });
}

function hasChineseText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function invalid(reason: string): CurrentVideoSummaryHighlightsValidationResult {
  return { ok: false, reason };
}

function baseResult(input: {
  status: CurrentVideoSummaryHighlightsResult['status'];
  title: string;
  message: string;
  textSize?: CurrentVideoSummaryHighlightsTextSize;
  sourceLabel?: 'B站字幕' | '本地转录' | null;
  model?: string | null;
  ai: CurrentVideoSummaryHighlightsAiState;
  limitations?: string[];
  now: number;
}): CurrentVideoSummaryHighlightsResult {
  return {
    status: input.status,
    title: input.title,
    message: input.message,
    sourceLabel: input.sourceLabel ?? null,
    textSize: input.textSize ?? approximateTextSize(0, 0),
    summarySentences: [],
    keyPoints: [],
    highlights: [],
    limitations: input.limitations ?? [],
    ai: input.ai,
    generatedAt: input.now,
    model: input.model ?? input.ai.model,
    cacheKey: null,
    cacheHit: false,
    current: true,
    requestId: null,
  };
}

function aiState(
  status: CurrentVideoSummaryHighlightsAiState['status'],
  model: string | null,
  note: string,
  error: string | null = null,
): CurrentVideoSummaryHighlightsAiState {
  return {
    status,
    model,
    error,
    note,
  };
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBytes(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
  return `${(safe / 1024 / 1024).toFixed(1)} MB`;
}
