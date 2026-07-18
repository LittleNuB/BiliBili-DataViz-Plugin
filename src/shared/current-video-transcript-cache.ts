import type { CurrentVideoContext } from './types/current-video-context';
import {
  buildCurrentVideoTextSourceIdentity,
  type CurrentVideoTextLine,
  type CurrentVideoTextSourceIdentity,
} from './current-video-primary-text.ts';
import { stableDigestHex } from './stable-digest.ts';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceStatus,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptIdentity,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from './types/current-video-transcript';
import type { CurrentVideoSubtitleSourceType } from './types/current-video-context';

export const CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_SOURCE_IDENTITIES = 50;
export const CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_BYTES = 50 * 1024 * 1024;
const AUTO_INCREMENT_ID_CONSERVATIVE_VALUE = Number.MAX_SAFE_INTEGER;

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
  sourceIdsToDelete: number[];
  segmentIdsToDelete: number[];
  sourceIdentityKeysToDelete: string[];
  skippedPersistentWrite: boolean;
  finalRetainedBytes: number;
  finalRetainedSourceIdentityCount: number;
  state: CurrentVideoTranscriptEvidenceState;
}

export interface PlanTranscriptEvidenceUpsertOptions {
  maxSourceIdentities?: number;
  maxBytes?: number;
  protectedSourceIdentityKeys?: Iterable<string>;
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
    const identity = buildTranscriptSourceIdentity({
      bvid: options.bvid,
      cid: options.cid,
      page: options.page,
      language,
      sourceType: options.sourceType,
      rows: [],
      statusSalt: 'malformed',
    });
    return {
      sourceRecord: sourceRecord({
        ...base,
        sourceHash: identity.sourceHash,
        bodyHash: identity.bodyHash,
        timelineHash: identity.timelineHash,
        status: 'malformed',
        segmentCount: 0,
        coverageStartSeconds: null,
        coverageEndSeconds: null,
        reason: 'subtitle_body_not_array',
        message: '字幕正文返回结构异常，未写入可引用字幕片段；当前仍使用元数据和简介作为本地证据结果。',
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
  const identity = buildTranscriptSourceIdentity({
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
        sourceHash: identity.sourceHash,
        bodyHash: identity.bodyHash,
        timelineHash: identity.timelineHash,
        status: 'empty',
        segmentCount: 0,
        coverageStartSeconds: null,
        coverageEndSeconds: null,
        reason: 'subtitle_body_empty',
        message: '字幕轨道可读取，但没有返回正文片段；当前仍使用元数据和简介作为本地证据结果。',
        warnings: ['transcript_empty'],
      }),
      segments: [],
    };
  }

  if (normalized.length === 0) {
    const malformedIdentity = buildTranscriptSourceIdentity({
      bvid: options.bvid,
      cid: options.cid,
      page: options.page,
      language,
      sourceType: options.sourceType,
      rows: [],
      statusSalt: 'malformed_rows',
    });
    return {
      sourceRecord: sourceRecord({
        ...base,
        sourceHash: malformedIdentity.sourceHash,
        bodyHash: malformedIdentity.bodyHash,
        timelineHash: malformedIdentity.timelineHash,
        status: 'malformed',
        segmentCount: 0,
        coverageStartSeconds: null,
        coverageEndSeconds: null,
        reason: 'subtitle_segments_unusable',
        message: '字幕正文片段缺少有效时间轴或文本，未作为字幕正文证据缓存。',
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
      sourceHash: identity.sourceHash,
      index,
      startSeconds: row.startSeconds,
      endSeconds: row.endSeconds,
      text: row.text,
    }),
    sourceIdentityKey: identity.sourceIdentityKey,
    bvid: options.bvid,
    cid: options.cid,
    page: options.page,
    startSeconds: row.startSeconds,
    endSeconds: row.endSeconds,
    text: row.text,
    language,
    source: 'bilibili_subtitle' as const,
    sourceType: options.sourceType,
    sourceHash: identity.sourceHash,
    stale: false,
    fetchedAt: options.fetchedAt,
    updatedAt: options.fetchedAt,
  }));

  return {
    sourceRecord: sourceRecord(
      {
        ...base,
        sourceHash: identity.sourceHash,
        bodyHash: identity.bodyHash,
        timelineHash: identity.timelineHash,
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
      },
      segments,
    ),
    segments,
  };
}

export function planTranscriptEvidenceUpsert(
  existingSources: CurrentVideoTranscriptSourceRecord[],
  existingSegments: CurrentVideoTranscriptSegment[],
  evidence: CurrentVideoTranscriptEvidenceWrite,
  options: PlanTranscriptEvidenceUpsertOptions = {},
): TranscriptEvidenceUpsertPlan {
  const maxSourceIdentities = options.maxSourceIdentities ?? CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_SOURCE_IDENTITIES;
  const maxBytes = options.maxBytes ?? CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_BYTES;
  const normalizedSource = normalizeSourceRecordIdentity(evidence.sourceRecord);
  const source = {
    ...normalizedSource,
    serializedBytes: measureTranscriptPersistentBytes(normalizedSource, evidence.segments),
  };
  const sourceIdentityKey = sourceIdentity(source);
  const protectedKeys = new Set(options.protectedSourceIdentityKeys ?? []);
  protectedKeys.add(sourceIdentityKey);
  const existingRetention = measureRetainedTranscriptCache(existingSources, existingSegments);

  if (source.status === 'cached' && (source.serializedBytes ?? 0) > maxBytes) {
    return {
      sourcesToPut: [],
      segmentsToPut: [],
      sourceIdsToDelete: [],
      segmentIdsToDelete: [],
      sourceIdentityKeysToDelete: [],
      skippedPersistentWrite: true,
      finalRetainedBytes: existingRetention.bytes,
      finalRetainedSourceIdentityCount: existingRetention.sourceIdentityCount,
      state: {
        ...buildTranscriptEvidenceStateFromCache(
          {
            bvid: source.bvid,
            cid: source.cid,
            page: source.page,
            language: source.language,
            sourceIdentityKey,
            sourceHash: source.sourceHash,
          },
          [source],
          evidence.segments.map(segment => ({ ...segment, sourceIdentityKey })),
          source.updatedAt,
        ),
        persistent: false,
        temporary: true,
        warnings: Array.from(new Set([
          ...source.warnings,
          'transcript_source_temporary_oversize',
        ])),
        message: '字幕内容较大，本次仅临时使用，离开页面后需要重新检测。',
      },
    };
  }

  const existingSource = existingSources.find(item => sourceIdentity(item) === sourceIdentityKey);
  const existingSegmentsById = new Map(existingSegments.map(segment => [segment.segmentId, segment]));
  const nextSegments = evidence.segments.map(segment => ({
    ...segment,
    sourceIdentityKey,
    id: existingSegmentsById.get(segment.segmentId)?.id,
    stale: false,
  }));
  const sourceToPut = {
    ...source,
    id: existingSource?.id,
    identityKey: sourceIdentityKey,
    sourceIdentityKey,
    partIdentityKey: buildTranscriptPartIdentityKey(source),
    stale: false,
    persistent: true,
    lastAccessedAt: source.updatedAt,
  };
  const mergedSources = [
    ...existingSources
      .map(normalizeSourceRecordIdentity)
      .filter(item => sourceIdentity(item) !== sourceIdentityKey),
    sourceToPut,
  ];
  const touchedSegmentIds = new Set(nextSegments.map(segment => segment.segmentId));
  const mergedSegments = [
    ...existingSegments
      .map(segment => ({
        ...segment,
        sourceIdentityKey: segment.sourceIdentityKey ?? sourceIdentityFromSegment(segment),
      }))
      .filter(segment => !touchedSegmentIds.has(segment.segmentId)),
    ...nextSegments,
  ];
  const eviction = planTranscriptCacheEviction(
    mergedSources,
    mergedSegments,
    {
      maxSourceIdentities,
      maxBytes,
      protectedSourceIdentityKeys: protectedKeys,
    },
  );
  if (
    eviction.finalRetainedSourceIdentityCount > maxSourceIdentities
    || eviction.finalRetainedBytes > maxBytes
  ) {
    return {
      sourcesToPut: [],
      segmentsToPut: [],
      sourceIdsToDelete: [],
      segmentIdsToDelete: [],
      sourceIdentityKeysToDelete: [],
      skippedPersistentWrite: true,
      finalRetainedBytes: existingRetention.bytes,
      finalRetainedSourceIdentityCount: existingRetention.sourceIdentityCount,
      state: {
        ...buildTranscriptEvidenceStateFromCache(
          {
            bvid: source.bvid,
            cid: source.cid,
            page: source.page,
            language: source.language,
            sourceIdentityKey,
            sourceHash: source.sourceHash,
          },
          [source],
          nextSegments,
          source.updatedAt,
        ),
        persistent: false,
        temporary: true,
        warnings: Array.from(new Set([
          ...source.warnings,
          'transcript_source_temporary_budget_protected',
        ])),
        message: '字幕内容较大，本次仅临时使用，离开页面后需要重新检测。',
      },
    };
  }
  const deletedSourceKeys = new Set(eviction.sourceIdentityKeysToDelete);
  const keptSources = mergedSources.filter(item => !deletedSourceKeys.has(sourceIdentity(item)));
  const keptSegments = mergedSegments.filter(segment =>
    !deletedSourceKeys.has(segment.sourceIdentityKey ?? sourceIdentityFromSegment(segment)),
  );

  const plan: TranscriptEvidenceUpsertPlan = {
    sourcesToPut: [sourceToPut],
    segmentsToPut: nextSegments,
    sourceIdsToDelete: eviction.sourceIdsToDelete,
    segmentIdsToDelete: eviction.segmentIdsToDelete,
    sourceIdentityKeysToDelete: eviction.sourceIdentityKeysToDelete,
    skippedPersistentWrite: false,
    finalRetainedBytes: eviction.finalRetainedBytes,
    finalRetainedSourceIdentityCount: eviction.finalRetainedSourceIdentityCount,
    state: buildTranscriptEvidenceStateFromCache(
      {
        bvid: source.bvid,
        cid: source.cid,
        page: source.page,
        language: source.language,
        sourceIdentityKey,
        sourceHash: source.sourceHash,
      },
      keptSources,
      keptSegments,
      source.updatedAt,
    ),
  };
  assertTranscriptWritePlanWithinBudget(plan, maxBytes, maxSourceIdentities);
  return plan;
}

export function buildTranscriptEvidenceStateFromCache(
  identity: CurrentVideoTranscriptIdentity,
  sources: CurrentVideoTranscriptSourceRecord[],
  segments: CurrentVideoTranscriptSegment[],
  now = Date.now(),
): CurrentVideoTranscriptEvidenceState {
  const exactSources = sources
    .map(normalizeSourceRecordIdentity)
    .filter(sourceMatchesIdentity(identity))
    .sort((a, b) => (b.lastAccessedAt ?? b.updatedAt) - (a.lastAccessedAt ?? a.updatedAt));
  const activeSource = exactSources.find(source => !source.stale);

  if (activeSource) {
    const activeSourceIdentityKey = sourceIdentity(activeSource);
    const exactSegments = segments.filter(segment =>
      segment.bvid === activeSource.bvid
      && segment.cid === activeSource.cid
      && segment.page === activeSource.page
      && languageKey(segment.language) === languageKey(activeSource.language)
      && (segment.sourceIdentityKey ?? sourceIdentityFromSegment(segment)) === activeSourceIdentityKey,
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
      sourceIdentityKey: activeSourceIdentityKey,
      sourceHash: activeSource.sourceHash,
      bodyHash: activeSource.bodyHash ?? null,
      timelineHash: activeSource.timelineHash ?? null,
      segmentCount: activeSource.status === 'cached'
        ? activeSegments.length
        : activeSource.segmentCount,
      staleSegmentCount,
      serializedBytes: activeSource.serializedBytes ?? measureTranscriptPersistentBytes(activeSource, activeSegments),
      coverageStartSeconds: activeSource.coverageStartSeconds,
      coverageEndSeconds: activeSource.coverageEndSeconds,
      fetchedAt: activeSource.fetchedAt,
      updatedAt: activeSource.updatedAt,
      lastAccessedAt: now,
      persistent: activeSource.persistent !== false,
      temporary: activeSource.persistent === false,
      reason: activeSource.reason,
      message: activeSource.message,
      warnings: Array.from(warnings),
    };
  }

  const sameVideoSources = sources.filter(source => source.bvid === identity.bvid);
  const samePartSources = sameVideoSources.filter(source =>
    source.cid === identity.cid && source.page === identity.page,
  );

  if ((identity.sourceIdentityKey || identity.sourceHash) && samePartSources.length > 0) {
    const staleSegmentCount = segments.filter(segment => segment.bvid === identity.bvid).length;
    return buildCurrentVideoTranscriptEvidenceState({
      status: 'stale',
      target: identity,
      now,
      sourceIdentityKey: identity.sourceIdentityKey ?? null,
      sourceHash: identity.sourceHash ?? null,
      staleSegmentCount,
      reason: 'requested_transcript_identity_not_cached',
      message: '此前选择的字幕正文身份已不可用；不会自动切换到其他来源，请重新检测或重新选择主要文本来源。',
      warnings: ['transcript_identity_mismatch'],
    });
  }

  if (identity.language && samePartSources.length > 0) {
    return buildCurrentVideoTranscriptEvidenceState({
      status: 'language_mismatch',
      target: identity,
      now,
      reason: 'language_not_cached',
      message: '本地字幕正文证据没有匹配当前请求的字幕语言；不会把其他语言当作当前有效证据。',
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
      message: '本地字幕正文证据与当前 CID、分 P 或语言不匹配；不会作为当前视频的当前有效证据。',
      warnings: ['transcript_cache_stale'],
    });
  }

  return buildCurrentVideoTranscriptEvidenceState({
    status: 'missing',
    target: identity,
    now,
    reason: 'transcript_not_cached',
    message: '尚未缓存当前视频的字幕正文证据；当前仍使用元数据和简介作为本地证据结果。',
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
  sourceIdentityKey?: string | null;
  sourceHash?: string | null;
  bodyHash?: string | null;
  timelineHash?: string | null;
  segmentCount?: number;
  staleSegmentCount?: number;
  serializedBytes?: number;
  coverageStartSeconds?: number | null;
  coverageEndSeconds?: number | null;
  fetchedAt?: number | null;
  updatedAt?: number | null;
  lastAccessedAt?: number | null;
  persistent?: boolean;
  temporary?: boolean;
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
    sourceIdentityKey: input.sourceIdentityKey ?? null,
    sourceHash: input.sourceHash ?? null,
    bodyHash: input.bodyHash ?? null,
    timelineHash: input.timelineHash ?? null,
    segmentCount: input.segmentCount ?? 0,
    staleSegmentCount: input.staleSegmentCount ?? 0,
    serializedBytes: input.serializedBytes ?? 0,
    coverageStartSeconds: input.coverageStartSeconds ?? null,
    coverageEndSeconds: input.coverageEndSeconds ?? null,
    fetchedAt: input.fetchedAt ?? null,
    updatedAt: input.updatedAt ?? null,
    lastAccessedAt: input.lastAccessedAt ?? null,
    persistent: input.persistent ?? input.temporary !== true,
    temporary: input.temporary === true,
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
  } else if (transcriptEvidence.status !== 'missing') {
    warnings.add(`transcript_evidence_${transcriptEvidence.status}`);
  }

  return {
    ...context,
    sources: {
      ...context.sources,
      contentText: transcriptEvidence.active ? 'available' : 'unavailable',
    },
    transcriptEvidence,
    warnings: Array.from(warnings),
  };
}

export function buildTranscriptIdentityKey(identity: CurrentVideoTranscriptIdentity): string {
  if (identity.sourceIdentityKey) return identity.sourceIdentityKey;
  if (identity.sourceHash) {
    return [
      'primary-text',
      identity.source ?? 'bilibili_subtitle',
      identity.bvid,
      identity.cid,
      identity.page,
      languageKey(identity.language ?? null),
      identity.sourceHash,
    ].join(':');
  }
  return buildTranscriptPartIdentityKey(identity);
}

export function buildTranscriptPartIdentityKey(identity: Pick<CurrentVideoTranscriptIdentity, 'bvid' | 'cid' | 'page' | 'language'>): string {
  return [
    'subtitle-part',
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

function sourceRecord(
  input: Omit<CurrentVideoTranscriptSourceRecord, 'identityKey' | 'stale' | 'serializedBytes'> & { serializedBytes?: number },
  segments: CurrentVideoTranscriptSegment[] = [],
): CurrentVideoTranscriptSourceRecord {
  const identityKey = buildTranscriptIdentityKey(input);
  const record = {
    ...input,
    identityKey,
    sourceIdentityKey: identityKey,
    partIdentityKey: buildTranscriptPartIdentityKey(input),
    stale: false,
    persistent: input.persistent ?? true,
    lastAccessedAt: input.lastAccessedAt ?? input.updatedAt,
  };
  return {
    ...record,
    serializedBytes: input.serializedBytes ?? measureTranscriptPersistentBytes(record, segments),
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

function buildTranscriptSourceIdentity(input: {
  bvid: string;
  cid: number;
  page: number;
  language: string | null;
  sourceType: CurrentVideoSubtitleSourceType;
  rows: NormalizedSegmentRow[];
  statusSalt?: string;
}) {
  const lines: CurrentVideoTextLine[] = input.rows.length > 0
    ? input.rows.map(row => ({
        startSeconds: row.startSeconds,
        endSeconds: row.endSeconds,
        text: row.text,
      }))
    : [{
        startSeconds: 0,
        endSeconds: 0.001,
        text: input.statusSalt ?? 'no-subtitle-body',
      }];
  return buildCurrentVideoTextSourceIdentity({
    bvid: input.bvid,
    cid: input.cid,
    page: input.page,
    source: 'bilibili_subtitle',
    sourceType: input.sourceType,
    language: input.language,
    lines,
  });
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
    stableDigestHex(input.text).slice(0, 16),
  ].join(':');
}

function sourceMatchesIdentity(identity: CurrentVideoTranscriptIdentity) {
  const expectedSourceIdentityKey = identity.sourceIdentityKey ?? null;
  const expectedSourceHash = identity.sourceHash ?? null;
  return (source: CurrentVideoTranscriptSourceRecord) => {
    const normalized = normalizeSourceRecordIdentity(source);
    if (expectedSourceIdentityKey) {
      return sourceIdentity(normalized) === expectedSourceIdentityKey;
    }
    if (expectedSourceHash) {
      return normalized.bvid === identity.bvid
        && normalized.cid === identity.cid
        && normalized.page === identity.page
        && normalized.sourceHash === expectedSourceHash
        && (!identity.language || languageKey(normalized.language) === languageKey(identity.language));
    }
    return normalized.bvid === identity.bvid
      && normalized.cid === identity.cid
      && normalized.page === identity.page
      && (!identity.language || languageKey(normalized.language) === languageKey(identity.language));
  };
}

function normalizeSourceRecordIdentity(source: CurrentVideoTranscriptSourceRecord): CurrentVideoTranscriptSourceRecord {
  const sourceIdentityKey = source.sourceIdentityKey ?? (
    source.sourceHash
      ? buildTranscriptIdentityKey(source)
      : source.identityKey
  );
  return {
    ...source,
    identityKey: sourceIdentityKey,
    sourceIdentityKey,
    partIdentityKey: source.partIdentityKey ?? buildTranscriptPartIdentityKey(source),
    persistent: source.persistent ?? true,
    lastAccessedAt: source.lastAccessedAt ?? source.updatedAt,
  };
}

function sourceIdentity(source: CurrentVideoTranscriptSourceRecord): string {
  return source.sourceIdentityKey ?? source.identityKey;
}

function sourceIdentityFromSegment(segment: CurrentVideoTranscriptSegment): string {
  return [
    'primary-text',
    segment.source,
    segment.bvid,
    segment.cid,
    segment.page,
    languageKey(segment.language),
    segment.sourceHash,
  ].join(':');
}

function planTranscriptCacheEviction(
  sources: CurrentVideoTranscriptSourceRecord[],
  segments: CurrentVideoTranscriptSegment[],
  options: {
    maxSourceIdentities: number;
    maxBytes: number;
    protectedSourceIdentityKeys: Set<string>;
  },
): {
  sourceIdsToDelete: number[];
  segmentIdsToDelete: number[];
  sourceIdentityKeysToDelete: string[];
  finalRetainedBytes: number;
  finalRetainedSourceIdentityCount: number;
} {
  const sourceByIdentity = new Map<string, CurrentVideoTranscriptSourceRecord>();
  for (const source of sources.map(normalizeSourceRecordIdentity)) {
    sourceByIdentity.set(sourceIdentity(source), source);
  }
  const segmentsByIdentity = new Map<string, CurrentVideoTranscriptSegment[]>();
  for (const segment of segments) {
    const key = segment.sourceIdentityKey ?? sourceIdentityFromSegment(segment);
    const bucket = segmentsByIdentity.get(key) ?? [];
    bucket.push(segment);
    segmentsByIdentity.set(key, bucket);
  }

  const retained = new Set(sourceByIdentity.keys());
  let totalBytes = Array.from(retained).reduce(
    (sum, key) => sum + sourceBytes(sourceByIdentity.get(key), segmentsByIdentity.get(key) ?? []),
    0,
  );
  const candidates = Array.from(sourceByIdentity.values())
    .filter(source => !options.protectedSourceIdentityKeys.has(sourceIdentity(source)))
    .sort((a, b) =>
      (a.lastAccessedAt ?? a.updatedAt) - (b.lastAccessedAt ?? b.updatedAt)
      || a.updatedAt - b.updatedAt
      || sourceIdentity(a).localeCompare(sourceIdentity(b)),
    );
  const toDelete: string[] = [];

  for (const candidate of candidates) {
    if (retained.size <= options.maxSourceIdentities && totalBytes <= options.maxBytes) break;
    const key = sourceIdentity(candidate);
    retained.delete(key);
    toDelete.push(key);
    totalBytes -= sourceBytes(candidate, segmentsByIdentity.get(key) ?? []);
  }

  const sourceIdsToDelete = toDelete
    .map(key => sourceByIdentity.get(key)?.id)
    .filter((id): id is number => typeof id === 'number');
  const segmentIdsToDelete = toDelete
    .flatMap(key => segmentsByIdentity.get(key) ?? [])
    .map(segment => segment.id)
    .filter((id): id is number => typeof id === 'number');

  return {
    sourceIdsToDelete,
    segmentIdsToDelete,
    sourceIdentityKeysToDelete: toDelete,
    finalRetainedBytes: Math.max(0, totalBytes),
    finalRetainedSourceIdentityCount: retained.size,
  };
}

function measureRetainedTranscriptCache(
  sources: CurrentVideoTranscriptSourceRecord[],
  segments: CurrentVideoTranscriptSegment[],
): { bytes: number; sourceIdentityCount: number } {
  const sourceByIdentity = new Map<string, CurrentVideoTranscriptSourceRecord>();
  for (const source of sources.map(normalizeSourceRecordIdentity)) {
    sourceByIdentity.set(sourceIdentity(source), source);
  }
  const segmentsByIdentity = new Map<string, CurrentVideoTranscriptSegment[]>();
  for (const segment of segments) {
    const key = segment.sourceIdentityKey ?? sourceIdentityFromSegment(segment);
    const bucket = segmentsByIdentity.get(key) ?? [];
    bucket.push(segment);
    segmentsByIdentity.set(key, bucket);
  }
  return {
    bytes: Array.from(sourceByIdentity.entries()).reduce(
      (sum, [key, source]) => sum + sourceBytes(source, segmentsByIdentity.get(key) ?? []),
      0,
    ),
    sourceIdentityCount: sourceByIdentity.size,
  };
}

function assertTranscriptWritePlanWithinBudget(
  plan: TranscriptEvidenceUpsertPlan,
  maxBytes: number,
  maxSourceIdentities: number,
): void {
  if (plan.skippedPersistentWrite) return;
  if (
    plan.finalRetainedBytes > maxBytes
    || plan.finalRetainedSourceIdentityCount > maxSourceIdentities
  ) {
    throw new Error('TRANSCRIPT_CACHE_WRITE_PLAN_EXCEEDS_BUDGET');
  }
}

function sourceBytes(
  source: CurrentVideoTranscriptSourceRecord | undefined,
  segments: CurrentVideoTranscriptSegment[],
): number {
  if (!source) return 0;
  if (
    typeof source.id === 'number'
    && segments.every(segment => typeof segment.id === 'number')
  ) {
    return measureTranscriptRecordBytes(source, segments);
  }
  return measureTranscriptPersistentBytes(source, segments);
}

export function measureTranscriptPersistentBytes(
  source: CurrentVideoTranscriptSourceRecord,
  segments: CurrentVideoTranscriptSegment[],
): number {
  let serializedBytes = Number.isFinite(source.serializedBytes)
    ? Math.max(0, Math.floor(source.serializedBytes ?? 0))
    : 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const measured = measureTranscriptRecordBytes(
      { ...source, serializedBytes },
      segments,
    );
    if (measured === serializedBytes) return measured;
    serializedBytes = measured;
  }

  return measureTranscriptRecordBytes(
    { ...source, serializedBytes },
    segments,
  );
}

function persistedSourceRecord(source: CurrentVideoTranscriptSourceRecord): CurrentVideoTranscriptSourceRecord {
  const normalized = normalizeSourceRecordIdentity(source);
  return {
    ...normalized,
    id: typeof normalized.id === 'number'
      ? normalized.id
      : AUTO_INCREMENT_ID_CONSERVATIVE_VALUE,
  };
}

function persistedSegmentRecord(segment: CurrentVideoTranscriptSegment): CurrentVideoTranscriptSegment {
  return {
    ...segment,
    id: typeof segment.id === 'number'
      ? segment.id
      : AUTO_INCREMENT_ID_CONSERVATIVE_VALUE,
  };
}

function measureTranscriptRecordBytes(
  source: CurrentVideoTranscriptSourceRecord,
  segments: CurrentVideoTranscriptSegment[],
): number {
  return serializedSize(persistedSourceRecord(source))
    + segments.reduce(
      (sum, segment) => sum + serializedSize(persistedSegmentRecord(segment)),
      0,
    );
}

function serializedSize(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
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
