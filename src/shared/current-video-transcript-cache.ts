import type { CurrentVideoContext } from './types/current-video-context';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceStatus,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptIdentity,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from './types/current-video-transcript';
import type { CurrentVideoSubtitleSourceType } from './types/current-video-context';

export interface NormalizeBilibiliTranscriptEvidenceOptions {
  bvid: string;
  cid: number;
  page: number;
  language: string | null;
  sourceType: CurrentVideoSubtitleSourceType;
  trackId?: string | null;
  trackUrlHost?: string | null;
  fetchedAt: number;
}

export interface TranscriptEvidenceUpsertPlan {
  sourcesToPut: CurrentVideoTranscriptSourceRecord[];
  segmentsToPut: CurrentVideoTranscriptSegment[];
  state: CurrentVideoTranscriptEvidenceState;
}

export function normalizeBilibiliTranscriptEvidence(
  data: unknown,
  options: NormalizeBilibiliTranscriptEvidenceOptions,
): CurrentVideoTranscriptEvidenceWrite {
  const root = asRecord(data);
  const nestedData = asRecord(root?.data);
  const body: unknown[] | null = Array.isArray(data)
    ? data
    : Array.isArray(root?.body)
      ? root.body
      : Array.isArray(nestedData?.body)
        ? nestedData.body
        : null;
  const language = normalizeNullableText(options.language);
  const base = {
    bvid: options.bvid,
    cid: options.cid,
    page: options.page,
    language,
    source: 'bilibili_subtitle' as const,
    sourceType: options.sourceType,
    trackId: normalizeNullableText(options.trackId),
    trackUrlHost: normalizeNullableText(options.trackUrlHost),
    fetchedAt: options.fetchedAt,
    updatedAt: options.fetchedAt,
  };

  if (!body) {
    const sourceHash = hashText([
      options.bvid,
      options.cid,
      options.page,
      language ?? '',
      options.sourceType,
      'malformed',
    ].join('|'));
    return {
      sourceRecord: sourceRecord({
        ...base,
        sourceHash,
        status: 'malformed',
        segmentCount: 0,
        coverageStartSeconds: null,
        coverageEndSeconds: null,
        reason: 'subtitle_body_not_array',
        message: '字幕正文返回结构异常，未写入可引用 transcript 片段；当前仍使用元数据/简介 fallback。',
        warnings: ['transcript_malformed'],
      }),
      segments: [],
    };
  }

  const normalized = body
    .map((row, index) => normalizeSegmentRow(row, index))
    .filter((row): row is NormalizedSegmentRow => Boolean(row))
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds || a.index - b.index);

  const malformedCount = body.length - normalized.length;
  const sourceHash = hashTranscriptSource({
    bvid: options.bvid,
    cid: options.cid,
    page: options.page,
    language,
    sourceType: options.sourceType,
    rows: normalized,
  });

  if (body.length === 0) {
    return {
      sourceRecord: sourceRecord({
        ...base,
        sourceHash,
        status: 'empty',
        segmentCount: 0,
        coverageStartSeconds: null,
        coverageEndSeconds: null,
        reason: 'subtitle_body_empty',
        message: '字幕 track 可读取，但没有返回正文片段；当前仍使用元数据/简介 fallback。',
        warnings: ['transcript_empty'],
      }),
      segments: [],
    };
  }

  if (normalized.length === 0) {
    return {
      sourceRecord: sourceRecord({
        ...base,
        sourceHash,
        status: 'malformed',
        segmentCount: 0,
        coverageStartSeconds: null,
        coverageEndSeconds: null,
        reason: 'subtitle_segments_unusable',
        message: '字幕正文片段缺少有效时间轴或文本，未作为 transcript 证据缓存。',
        warnings: ['transcript_malformed'],
      }),
      segments: [],
    };
  }

  const warnings = malformedCount > 0
    ? ['transcript_segments_filtered']
    : [];
  const segments = normalized.map((row, index) => ({
    segmentId: transcriptSegmentId({
      bvid: options.bvid,
      cid: options.cid,
      page: options.page,
      language,
      sourceHash,
      index,
      startSeconds: row.startSeconds,
      endSeconds: row.endSeconds,
      text: row.text,
    }),
    bvid: options.bvid,
    cid: options.cid,
    page: options.page,
    startSeconds: row.startSeconds,
    endSeconds: row.endSeconds,
    text: row.text,
    language,
    source: 'bilibili_subtitle' as const,
    sourceType: options.sourceType,
    sourceHash,
    stale: false,
    fetchedAt: options.fetchedAt,
    updatedAt: options.fetchedAt,
  }));

  return {
    sourceRecord: sourceRecord({
      ...base,
      sourceHash,
      status: 'cached',
      segmentCount: segments.length,
      coverageStartSeconds: segments[0]?.startSeconds ?? null,
      coverageEndSeconds: segments.reduce(
        (max, segment) => Math.max(max, segment.endSeconds),
        0,
      ),
      reason: 'transcript_segments_cached',
      message: `已缓存字幕正文证据 ${segments.length} 段${language ? `（${language}）` : ''}；本版本仅作为本地证据，不会默认发送给 AI 或生成完整视频总结。`,
      warnings,
    }),
    segments,
  };
}

export function planTranscriptEvidenceUpsert(
  existingSources: CurrentVideoTranscriptSourceRecord[],
  existingSegments: CurrentVideoTranscriptSegment[],
  evidence: CurrentVideoTranscriptEvidenceWrite,
): TranscriptEvidenceUpsertPlan {
  const source = evidence.sourceRecord;
  const sameIdentity = (segment: CurrentVideoTranscriptSegment) =>
    segment.bvid === source.bvid
    && segment.cid === source.cid
    && segment.page === source.page
    && languageKey(segment.language) === languageKey(source.language);
  const existingSource = existingSources.find(item => item.identityKey === source.identityKey);
  const existingSegmentsById = new Map(existingSegments.map(segment => [segment.segmentId, segment]));
  const staleSegments = existingSegments
    .filter(segment =>
      sameIdentity(segment)
      && !segment.stale
      && source.sourceHash !== null
      && segment.sourceHash !== source.sourceHash,
    )
    .map(segment => ({
      ...segment,
      stale: true,
      updatedAt: source.updatedAt,
    }));
  const nextSegments = evidence.segments.map(segment => ({
    ...segment,
    id: existingSegmentsById.get(segment.segmentId)?.id,
    stale: false,
  }));
  const sourceToPut = {
    ...source,
    id: existingSource?.id,
    stale: false,
  };
  const mergedSources = [
    ...existingSources.filter(item => item.identityKey !== source.identityKey),
    sourceToPut,
  ];
  const touchedSegmentIds = new Set([
    ...staleSegments.map(segment => segment.segmentId),
    ...nextSegments.map(segment => segment.segmentId),
  ]);
  const mergedSegments = [
    ...existingSegments.filter(segment => !touchedSegmentIds.has(segment.segmentId)),
    ...staleSegments,
    ...nextSegments,
  ];

  return {
    sourcesToPut: [sourceToPut],
    segmentsToPut: [...staleSegments, ...nextSegments],
    state: buildTranscriptEvidenceStateFromCache(
      {
        bvid: source.bvid,
        cid: source.cid,
        page: source.page,
        language: source.language,
      },
      mergedSources,
      mergedSegments,
      source.updatedAt,
    ),
  };
}

export function buildTranscriptEvidenceStateFromCache(
  identity: CurrentVideoTranscriptIdentity,
  sources: CurrentVideoTranscriptSourceRecord[],
  segments: CurrentVideoTranscriptSegment[],
  now = Date.now(),
): CurrentVideoTranscriptEvidenceState {
  const exactSources = sources
    .filter(sourceMatchesIdentity(identity))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeSource = exactSources.find(source => !source.stale);

  if (activeSource) {
    const exactSegments = segments.filter(segment =>
      segment.bvid === activeSource.bvid
      && segment.cid === activeSource.cid
      && segment.page === activeSource.page
      && languageKey(segment.language) === languageKey(activeSource.language),
    );
    const activeSegments = activeSource.sourceHash
      ? exactSegments.filter(segment => !segment.stale && segment.sourceHash === activeSource.sourceHash)
      : [];
    const staleSegmentCount = exactSegments.filter(segment => segment.stale).length;
    const warnings = new Set(activeSource.warnings);

    if (activeSource.status === 'cached' && activeSegments.length !== activeSource.segmentCount) {
      warnings.add('transcript_cache_segment_count_mismatch');
    }

    return {
      status: activeSource.status,
      active: activeSource.status === 'cached' && activeSegments.length > 0,
      checkedAt: now,
      bvid: activeSource.bvid,
      cid: activeSource.cid,
      page: activeSource.page,
      language: activeSource.language,
      source: activeSource.source,
      sourceType: activeSource.sourceType,
      sourceHash: activeSource.sourceHash,
      segmentCount: activeSource.status === 'cached'
        ? activeSegments.length
        : activeSource.segmentCount,
      staleSegmentCount,
      coverageStartSeconds: activeSource.coverageStartSeconds,
      coverageEndSeconds: activeSource.coverageEndSeconds,
      fetchedAt: activeSource.fetchedAt,
      updatedAt: activeSource.updatedAt,
      reason: activeSource.reason,
      message: activeSource.message,
      warnings: Array.from(warnings),
    };
  }

  const sameVideoSources = sources.filter(source => source.bvid === identity.bvid);
  const samePartSources = sameVideoSources.filter(source =>
    source.cid === identity.cid && source.page === identity.page,
  );

  if (identity.language && samePartSources.length > 0) {
    return buildCurrentVideoTranscriptEvidenceState({
      status: 'language_mismatch',
      target: identity,
      now,
      reason: 'language_not_cached',
      message: '本地 transcript 证据没有匹配当前请求的字幕语言；不会把其他语言当作 active 证据。',
      warnings: ['transcript_language_mismatch'],
    });
  }

  if (sameVideoSources.length > 0) {
    const staleSegmentCount = segments.filter(segment => segment.bvid === identity.bvid).length;
    return buildCurrentVideoTranscriptEvidenceState({
      status: 'stale',
      target: identity,
      now,
      staleSegmentCount,
      reason: 'current_video_identity_changed',
      message: '本地 transcript 证据与当前 CID、分 P 或语言不匹配；不会作为当前视频 active 证据。',
      warnings: ['transcript_cache_stale'],
    });
  }

  return buildCurrentVideoTranscriptEvidenceState({
    status: 'missing',
    target: identity,
    now,
    reason: 'transcript_not_cached',
    message: '尚未缓存当前视频的字幕正文证据；当前仍使用元数据/简介 fallback。',
    warnings: ['transcript_not_cached'],
  });
}

export function buildCurrentVideoTranscriptEvidenceState(input: {
  status: CurrentVideoTranscriptEvidenceStatus;
  target: {
    bvid: string | null;
    cid: number | null;
    page: number | null;
    language?: string | null;
  };
  now: number;
  sourceType?: CurrentVideoSubtitleSourceType;
  sourceHash?: string | null;
  segmentCount?: number;
  staleSegmentCount?: number;
  coverageStartSeconds?: number | null;
  coverageEndSeconds?: number | null;
  fetchedAt?: number | null;
  updatedAt?: number | null;
  reason: string;
  message: string;
  warnings: string[];
}): CurrentVideoTranscriptEvidenceState {
  return {
    status: input.status,
    active: input.status === 'cached' && (input.segmentCount ?? 0) > 0,
    checkedAt: input.now,
    bvid: input.target.bvid,
    cid: input.target.cid,
    page: input.target.page,
    language: normalizeNullableText(input.target.language),
    source: input.status === 'cached' ? 'bilibili_subtitle' : null,
    sourceType: input.sourceType ?? 'none',
    sourceHash: input.sourceHash ?? null,
    segmentCount: input.segmentCount ?? 0,
    staleSegmentCount: input.staleSegmentCount ?? 0,
    coverageStartSeconds: input.coverageStartSeconds ?? null,
    coverageEndSeconds: input.coverageEndSeconds ?? null,
    fetchedAt: input.fetchedAt ?? null,
    updatedAt: input.updatedAt ?? null,
    reason: input.reason,
    message: input.message,
    warnings: input.warnings,
  };
}

export function withTranscriptEvidenceState(
  context: CurrentVideoContext,
  transcriptEvidence: CurrentVideoTranscriptEvidenceState,
): CurrentVideoContext {
  const warnings = new Set(context.warnings);
  if (transcriptEvidence.active) {
    warnings.delete('transcript_text_not_cached');
    warnings.add('transcript_evidence_cached');
    warnings.add('transcript_summary_not_generated');
  } else if (transcriptEvidence.status !== 'missing') {
    warnings.add(`transcript_evidence_${transcriptEvidence.status}`);
  }

  return {
    ...context,
    transcriptEvidence,
    warnings: Array.from(warnings),
  };
}

export function buildTranscriptIdentityKey(identity: CurrentVideoTranscriptIdentity): string {
  return [
    identity.bvid,
    identity.cid,
    identity.page,
    languageKey(identity.language ?? null),
  ].join(':');
}

interface NormalizedSegmentRow {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

function sourceRecord(input: Omit<CurrentVideoTranscriptSourceRecord, 'identityKey' | 'stale'>): CurrentVideoTranscriptSourceRecord {
  return {
    ...input,
    identityKey: buildTranscriptIdentityKey(input),
    stale: false,
  };
}

function normalizeSegmentRow(row: unknown, index: number): NormalizedSegmentRow | null {
  const record = asRecord(row);
  if (!record) return null;

  const startSeconds = normalizeTimestamp(
    record.from ?? record.start ?? record.start_time ?? record.startSeconds,
  );
  const endSeconds = normalizeTimestamp(
    record.to ?? record.end ?? record.end_time ?? record.endSeconds,
  );
  const text = normalizeNullableText(
    record.content ?? record.text ?? record.subtitle ?? record.line,
  );

  if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) {
    return null;
  }

  return {
    index,
    startSeconds,
    endSeconds,
    text,
  };
}

function hashTranscriptSource(input: {
  bvid: string;
  cid: number;
  page: number;
  language: string | null;
  sourceType: CurrentVideoSubtitleSourceType;
  rows: NormalizedSegmentRow[];
}): string {
  return hashText([
    input.bvid,
    String(input.cid),
    String(input.page),
    input.language ?? '',
    input.sourceType,
    ...input.rows.map(row => `${row.startSeconds}:${row.endSeconds}:${row.text}`),
  ].join('\n'));
}

function transcriptSegmentId(input: {
  bvid: string;
  cid: number;
  page: number;
  language: string | null;
  sourceHash: string;
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}): string {
  return [
    'transcript',
    input.bvid,
    input.cid,
    input.page,
    languageKey(input.language),
    input.sourceHash,
    input.index,
    Math.round(input.startSeconds * 1000),
    Math.round(input.endSeconds * 1000),
    hashText(input.text).slice(0, 8),
  ].join(':');
}

function sourceMatchesIdentity(identity: CurrentVideoTranscriptIdentity) {
  return (source: CurrentVideoTranscriptSourceRecord) =>
    source.bvid === identity.bvid
    && source.cid === identity.cid
    && source.page === identity.page
    && (!identity.language || languageKey(source.language) === languageKey(identity.language));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeTimestamp(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 1000) / 1000;
}

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
