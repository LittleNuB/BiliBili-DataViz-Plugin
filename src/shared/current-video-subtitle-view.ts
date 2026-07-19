import type { CurrentVideoContext, CurrentVideoSubtitleSourceType } from './types/current-video-context';
import type { CurrentVideoTranscriptSegment } from './types/current-video-transcript';
import {
  buildCurrentVideoTextSourceIdentity,
  type CurrentVideoPrimaryTextSourceKind,
  type CurrentVideoTextSourceIdentity,
} from './current-video-primary-text.ts';
import { stableDigestHex } from './stable-digest.ts';

export type CurrentVideoSubtitleViewingSourceKind = CurrentVideoPrimaryTextSourceKind;
export type CurrentVideoSubtitleViewingSourceLabel = 'B站字幕' | '本地转录';
export type CurrentVideoSubtitleViewingSourceStatus =
  | 'available'
  | 'temporary'
  | 'empty'
  | 'malformed'
  | 'missing';

export type CurrentVideoSubtitleViewSourcesStatus =
  | 'ready'
  | 'no_context'
  | 'detecting'
  | 'requires_user_subtitle'
  | 'unavailable'
  | 'empty'
  | 'malformed'
  | 'local_absent';

export interface CurrentVideoSubtitleLine {
  lineId: string;
  lineBindingKey: string;
  sourceIdentityKey: string;
  bvid: string;
  cid: number;
  page: number;
  source: CurrentVideoSubtitleViewingSourceKind;
  sourceLabel: CurrentVideoSubtitleViewingSourceLabel;
  language: string | null;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface CurrentVideoSubtitleViewingSource {
  identity: CurrentVideoTextSourceIdentity;
  sourceLabel: CurrentVideoSubtitleViewingSourceLabel;
  status: CurrentVideoSubtitleViewingSourceStatus;
  lineCount: number;
  byteSize: number;
  temporary: boolean;
  lines: CurrentVideoSubtitleLine[];
}

export interface CurrentVideoSubtitleViewSourcesResult {
  status: CurrentVideoSubtitleViewSourcesStatus;
  message: string;
  checkedAt: number;
  contextKey: string | null;
  title: string | null;
  partTitle: string | null;
  durationSeconds: number | null;
  sources: CurrentVideoSubtitleViewingSource[];
}

export interface CurrentVideoSubtitleSearchResult {
  resultId: string;
  lineId: string;
  sourceIdentityKey: string;
  startSeconds: number;
  endSeconds: number;
  timeRangeLabel: string;
  text: string;
  matchStart: number;
  matchEnd: number;
}

export interface CurrentVideoSubtitleSearchState {
  query: string;
  results: CurrentVideoSubtitleSearchResult[];
  activeIndex: number;
  message: string;
}

export type CurrentVideoSubtitleFollowMode = 'following' | 'paused';
export type CurrentVideoSubtitleFollowPausedReason =
  | 'manual_scroll'
  | 'search_navigation'
  | 'source_changed'
  | null;

export interface CurrentVideoSubtitleFollowState {
  mode: CurrentVideoSubtitleFollowMode;
  activeLineId: string | null;
  pausedReason: CurrentVideoSubtitleFollowPausedReason;
}

export type CurrentVideoSubtitleFollowEvent =
  | { type: 'playback_tick'; currentSeconds: number }
  | { type: 'manual_scroll' }
  | { type: 'search_navigation'; lineId?: string | null }
  | { type: 'resume_follow'; currentSeconds: number }
  | { type: 'source_changed' };

export interface CurrentVideoSubtitleJumpPreview {
  canJump: boolean;
  requiresConfirmation: true;
  message: string;
  lineId: string;
  lineBindingKey: string;
  sourceIdentityKey: string;
  sourceLabel: CurrentVideoSubtitleViewingSourceLabel;
  targetSeconds: number | null;
  targetTimeLabel: string | null;
  timeRangeLabel: string;
  sourceText: string;
}

export interface BuildCurrentVideoSubtitleSourceInput {
  bvid: string;
  cid: number;
  page: number;
  source: CurrentVideoSubtitleViewingSourceKind;
  sourceType: CurrentVideoSubtitleSourceType | 'local_transcript';
  language?: string | null;
  temporary?: boolean;
  lines: Array<{
    lineId?: string | null;
    startSeconds: number;
    endSeconds: number;
    text: string;
  }>;
}

export interface BuildCurrentVideoSubtitleFilenameInput {
  title?: string | null;
  partTitle?: string | null;
  sourceLabel: CurrentVideoSubtitleViewingSourceLabel;
  extension: 'txt' | 'srt';
}

export function buildBilibiliSubtitleViewingSource(input: {
  bvid: string;
  cid: number;
  page: number;
  language?: string | null;
  sourceType: CurrentVideoSubtitleSourceType;
  temporary?: boolean;
  segments: CurrentVideoTranscriptSegment[];
}): CurrentVideoSubtitleViewingSource | null {
  const lines = input.segments
    .filter(segment =>
      segment.bvid === input.bvid
      && segment.cid === input.cid
      && segment.page === input.page
      && !segment.stale
      && segment.source === 'bilibili_subtitle',
    )
    .map(segment => ({
      lineId: segment.segmentId,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    }));

  return buildCurrentVideoSubtitleViewingSource({
    bvid: input.bvid,
    cid: input.cid,
    page: input.page,
    source: 'bilibili_subtitle',
    sourceType: input.sourceType,
    language: input.language ?? input.segments[0]?.language ?? null,
    temporary: input.temporary,
    lines,
  });
}

export function buildCurrentVideoSubtitleViewingSource(
  input: BuildCurrentVideoSubtitleSourceInput,
): CurrentVideoSubtitleViewingSource | null {
  const normalized = normalizeSubtitleLines(input.lines);
  if (normalized.length === 0) return null;

  const identity = buildCurrentVideoTextSourceIdentity({
    bvid: input.bvid,
    cid: input.cid,
    page: input.page,
    source: input.source,
    sourceType: input.sourceType,
    language: input.language ?? null,
    lines: normalized,
  });
  const sourceLabel = subtitleSourceLabel(input.source);
  const lines = normalized.map((line, index): CurrentVideoSubtitleLine => ({
    lineId: safeLineId(line.lineId, index),
    lineBindingKey: buildSubtitleLineBindingKey(identity.sourceIdentityKey, index, line.startSeconds, line.endSeconds, line.text),
    sourceIdentityKey: identity.sourceIdentityKey,
    bvid: identity.bvid,
    cid: identity.cid,
    page: identity.page,
    source: input.source,
    sourceLabel,
    language: identity.language,
    startSeconds: line.startSeconds,
    endSeconds: line.endSeconds,
    text: line.text,
  }));
  const plain = lines.map(line => line.text).join('\n');

  return {
    identity,
    sourceLabel,
    status: input.temporary ? 'temporary' : 'available',
    lineCount: lines.length,
    byteSize: utf8ByteLength(plain),
    temporary: input.temporary === true,
    lines,
  };
}

export function selectDefaultSubtitleViewingSource(
  sources: CurrentVideoSubtitleViewingSource[],
  requestedSourceIdentityKey?: string | null,
): CurrentVideoSubtitleViewingSource | null {
  const available = currentVideoUsableSubtitleSources(sources);
  if (requestedSourceIdentityKey) {
    const selected = available.find(source => source.identity.sourceIdentityKey === requestedSourceIdentityKey);
    if (selected) return selected;
  }
  return available[0] ?? null;
}

export function shouldShowSubtitleViewingSourceSwitcher(
  sources: CurrentVideoSubtitleViewingSource[],
): boolean {
  return currentVideoUsableSubtitleSources(sources).length > 1;
}

export function searchCurrentVideoSubtitleLines(
  source: CurrentVideoSubtitleViewingSource | null,
  query: string,
): CurrentVideoSubtitleSearchState {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim();
  if (!source || normalizedQuery.length === 0) {
    return {
      query: normalizedQuery,
      results: [],
      activeIndex: -1,
      message: '请输入要查找的字幕内容。',
    };
  }

  const queryHasAsciiLetters = /[A-Za-z]/.test(normalizedQuery);
  const needle = queryHasAsciiLetters ? normalizedQuery.toLocaleLowerCase() : normalizedQuery;
  const results: CurrentVideoSubtitleSearchResult[] = [];
  for (const line of source.lines) {
    const haystack = queryHasAsciiLetters ? line.text.toLocaleLowerCase() : line.text;
    const matchStart = haystack.indexOf(needle);
    if (matchStart < 0) continue;
    results.push({
      resultId: `${line.lineId}:${results.length}`,
      lineId: line.lineId,
      sourceIdentityKey: line.sourceIdentityKey,
      startSeconds: line.startSeconds,
      endSeconds: line.endSeconds,
      timeRangeLabel: formatSubtitleTimeRange(line.startSeconds, line.endSeconds),
      text: line.text,
      matchStart,
      matchEnd: matchStart + normalizedQuery.length,
    });
  }

  return {
    query: normalizedQuery,
    results,
    activeIndex: results.length > 0 ? 0 : -1,
    message: results.length > 0
      ? `找到 ${results.length} 处匹配。`
      : '当前字幕来源里没有匹配结果。',
  };
}

export function navigateCurrentVideoSubtitleSearchResult(
  state: CurrentVideoSubtitleSearchState,
  direction: 'previous' | 'next',
): CurrentVideoSubtitleSearchState {
  if (state.results.length === 0) {
    return { ...state, activeIndex: -1 };
  }
  const delta = direction === 'next' ? 1 : -1;
  const current = state.activeIndex >= 0 ? state.activeIndex : 0;
  return {
    ...state,
    activeIndex: (current + delta + state.results.length) % state.results.length,
  };
}

export function activeSubtitleLineAtTime(
  lines: CurrentVideoSubtitleLine[],
  currentSeconds: number,
): CurrentVideoSubtitleLine | null {
  if (lines.length === 0) return null;
  const seconds = normalizeSeconds(currentSeconds);
  const containing = lines.find(line => seconds >= line.startSeconds && seconds < line.endSeconds);
  if (containing) return containing;

  let previous: CurrentVideoSubtitleLine | null = null;
  for (const line of lines) {
    if (line.startSeconds <= seconds) {
      previous = line;
    } else {
      break;
    }
  }
  return previous ?? lines[0];
}

export function reduceCurrentVideoSubtitleFollowState(
  state: CurrentVideoSubtitleFollowState,
  event: CurrentVideoSubtitleFollowEvent,
  lines: CurrentVideoSubtitleLine[],
): CurrentVideoSubtitleFollowState {
  switch (event.type) {
    case 'manual_scroll':
      return {
        ...state,
        mode: 'paused',
        pausedReason: 'manual_scroll',
      };
    case 'search_navigation':
      return {
        mode: 'paused',
        pausedReason: 'search_navigation',
        activeLineId: event.lineId ?? state.activeLineId,
      };
    case 'source_changed':
      return {
        mode: 'paused',
        pausedReason: 'source_changed',
        activeLineId: null,
      };
    case 'resume_follow': {
      const active = activeSubtitleLineAtTime(lines, event.currentSeconds);
      return {
        mode: 'following',
        pausedReason: null,
        activeLineId: active?.lineId ?? null,
      };
    }
    case 'playback_tick':
    default:
      if (state.mode !== 'following') return state;
      return {
        ...state,
        activeLineId: activeSubtitleLineAtTime(lines, event.currentSeconds)?.lineId ?? null,
      };
  }
}

export function buildCurrentVideoSubtitleJumpPreview(
  source: CurrentVideoSubtitleViewingSource,
  line: CurrentVideoSubtitleLine,
): CurrentVideoSubtitleJumpPreview {
  const timeRangeLabel = formatSubtitleTimeRange(line.startSeconds, line.endSeconds);
  const base = {
    requiresConfirmation: true as const,
    lineId: line.lineId,
    lineBindingKey: line.lineBindingKey,
    sourceIdentityKey: source.identity.sourceIdentityKey,
    sourceLabel: source.sourceLabel,
    timeRangeLabel,
    sourceText: line.text,
  };
  if (
    line.sourceIdentityKey !== source.identity.sourceIdentityKey
    || !Number.isFinite(line.startSeconds)
    || line.startSeconds < 0
    || !Number.isFinite(line.endSeconds)
    || line.endSeconds <= line.startSeconds
  ) {
    return {
      ...base,
      canJump: false,
      message: '这条字幕的时间范围不可用，不能跳转。',
      targetSeconds: null,
      targetTimeLabel: null,
    };
  }

  const targetTimeLabel = formatSubtitleDuration(line.startSeconds);
  return {
    ...base,
    canJump: true,
    message: `确认后会跳到 ${targetTimeLabel}，并记录当前播放位置用于返回。`,
    targetSeconds: line.startSeconds,
    targetTimeLabel,
  };
}

export function validateSubtitleViewingIdentity(
  context: CurrentVideoContext,
  source: CurrentVideoSubtitleViewingSource | null,
): boolean {
  return Boolean(
    source
    && context.cid
    && source.identity.bvid === context.bvid
    && source.identity.cid === context.cid
    && source.identity.page === context.currentPart.page,
  );
}

export function formatSubtitleTxt(
  source: CurrentVideoSubtitleViewingSource,
  input: { title?: string | null; partTitle?: string | null } = {},
): string {
  const heading = [
    sanitizeSubtitleVisibleMetadata(input.title),
    sanitizeSubtitleVisibleMetadata(input.partTitle),
  ]
    .filter(Boolean)
    .join(' - ') || '当前视频';
  const lines = [
    `${heading} 字幕全文（${source.sourceLabel}）`,
    `共 ${source.lineCount} 条`,
    '',
    ...source.lines.map(line => `[${formatSubtitleTimeRange(line.startSeconds, line.endSeconds)}] ${normalizeSubtitleText(line.text)}`),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatSubtitleSrt(source: CurrentVideoSubtitleViewingSource): string {
  return `${source.lines
    .slice()
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds)
    .map((line, index) => [
      String(index + 1),
      `${formatSrtTimestamp(line.startSeconds)} --> ${formatSrtTimestamp(line.endSeconds)}`,
      normalizeSrtText(line.text),
    ].join('\n'))
    .join('\n\n')}\n`;
}

export function buildSubtitleExportFilename(input: BuildCurrentVideoSubtitleFilenameInput): string {
  const base = sanitizeChineseFilenamePart(input.title) || '当前视频';
  const part = sanitizeChineseFilenamePart(input.partTitle);
  const source = sanitizeChineseFilenamePart(input.sourceLabel) || '字幕';
  const name = [base, part, source, '字幕全文'].filter(Boolean).join('-');
  return `${name}.${input.extension}`;
}

export function subtitleSourceLabel(
  source: CurrentVideoSubtitleViewingSourceKind,
): CurrentVideoSubtitleViewingSourceLabel {
  return source === 'local_transcript' ? '本地转录' : 'B站字幕';
}

export function currentVideoSubtitleContextKey(context: CurrentVideoContext): string {
  return [
    context.bvid,
    context.cid ?? 'cid-unknown',
    context.currentPart.page,
    context.transcriptEvidence?.sourceIdentityKey ?? 'no-source',
    context.transcriptEvidence?.updatedAt ?? 0,
  ].join(':');
}

function currentVideoUsableSubtitleSources(
  sources: CurrentVideoSubtitleViewingSource[],
): CurrentVideoSubtitleViewingSource[] {
  return sources.filter(source =>
    (source.status === 'available' || source.status === 'temporary')
    && source.lines.length > 0,
  );
}

function normalizeSubtitleLines(
  lines: BuildCurrentVideoSubtitleSourceInput['lines'],
): Array<{
  lineId: string | null;
  startSeconds: number;
  endSeconds: number;
  text: string;
}> {
  return lines
    .filter(line =>
      Number.isFinite(line.startSeconds)
      && line.startSeconds >= 0
      && Number.isFinite(line.endSeconds)
      && line.endSeconds > line.startSeconds,
    )
    .map(line => ({
      lineId: line.lineId?.trim() || null,
      startSeconds: normalizeSeconds(line.startSeconds),
      endSeconds: normalizeSeconds(line.endSeconds),
      text: normalizeSubtitleText(line.text),
    }))
    .filter(line => line.text && line.endSeconds > line.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
}

function safeLineId(lineId: string | null, index: number): string {
  if (lineId && /^[A-Za-z0-9._:-]{1,80}$/.test(lineId)) return lineId;
  return `line-${index + 1}`;
}

function buildSubtitleLineBindingKey(
  sourceIdentityKey: string,
  index: number,
  startSeconds: number,
  endSeconds: number,
  text: string,
): string {
  return stableDigestHex(JSON.stringify({
    sourceIdentityKey,
    index,
    startMs: Math.round(startSeconds * 1000),
    endMs: Math.round(endSeconds * 1000),
    text,
  }));
}

function sanitizeChineseFilenamePart(value: string | null | undefined): string {
  return sanitizeSubtitleVisibleMetadata(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/^[. ]+/g, '')
    .trim()
    .slice(0, 60);
}

function sanitizeSubtitleVisibleMetadata(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\b(?:fallback|transcript|confidence|sourceHash|segmentId|subtitle_url|BVID|CID)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：._-]+|[\s:：._-]+$/g, '')
    .trim()
    .slice(0, 160);
}

function normalizeSubtitleText(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSrtText(value: string): string {
  return normalizeSubtitleText(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeSeconds(value: number): number {
  return Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1000) / 1000;
}

function formatSubtitleTimeRange(startSeconds: number, endSeconds: number): string {
  return `${formatSubtitleDuration(startSeconds)}-${formatSubtitleDuration(endSeconds)}`;
}

function formatSubtitleDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatSrtTimestamp(seconds: number): string {
  const safeMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const secs = Math.floor((safeMs % 60_000) / 1000);
  const ms = safeMs % 1000;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(secs).padStart(2, '0'),
  ].join(':') + `,${String(ms).padStart(3, '0')}`;
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length;
}
