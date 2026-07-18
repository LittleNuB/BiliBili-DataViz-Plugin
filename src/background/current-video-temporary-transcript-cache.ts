import {
  buildCurrentVideoTranscriptEvidenceState,
  buildTranscriptEvidenceStateFromCache,
  buildTranscriptIdentityKey,
  measureTranscriptPersistentBytes,
} from '../shared/current-video-transcript-cache.ts';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptIdentity,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from '../shared/types/current-video-transcript.ts';

export const CURRENT_VIDEO_TEMPORARY_TRANSCRIPT_MAX_SOURCES = 4;
export const CURRENT_VIDEO_TEMPORARY_TRANSCRIPT_MAX_BYTES = 64 * 1024 * 1024;

export interface CurrentVideoTemporaryTranscriptOwner {
  ownerTabId: number;
  bvid: string;
  cid: number;
  page: number;
  navigationGeneration: number;
}

interface TemporaryTranscriptEntry {
  owner: CurrentVideoTemporaryTranscriptOwner;
  source: CurrentVideoTranscriptSourceRecord;
  segments: CurrentVideoTranscriptSegment[];
  savedAt: number;
}

type CurrentVideoTemporaryTranscriptCurrentSourceStatus =
  | 'temporary_cached'
  | 'persistent_cached'
  | 'source_too_large'
  | 'capacity_exceeded';

interface CurrentVideoTemporaryTranscriptCurrentSource {
  owner: CurrentVideoTemporaryTranscriptOwner;
  sourceIdentityKey: string;
  sourceHash: string | null;
  language: string | null;
  sourceType: CurrentVideoTranscriptSourceRecord['sourceType'];
  status: CurrentVideoTemporaryTranscriptCurrentSourceStatus;
  savedAt: number;
}

export type CurrentVideoTemporaryTranscriptOwnerReadResolution =
  | {
      kind: 'temporary';
      identity: CurrentVideoTranscriptIdentity;
    }
  | {
      kind: 'persistent';
      identity: CurrentVideoTranscriptIdentity;
    }
  | {
      kind: 'rejected';
      identity: CurrentVideoTranscriptIdentity;
      state: CurrentVideoTranscriptEvidenceState;
    }
  | {
      kind: 'mismatch';
      state: CurrentVideoTranscriptEvidenceState;
    };

export type CurrentVideoTemporaryTranscriptPutStatus =
  | 'stored'
  | 'invalid_owner'
  | 'capacity_exceeded'
  | 'source_too_large';

export interface CurrentVideoTemporaryTranscriptPutResult {
  status: CurrentVideoTemporaryTranscriptPutStatus;
  sourceIdentityKey?: string;
  sourceBytes?: number;
  retainedBytes: number;
  retainedSourceCount: number;
  maxBytes: number;
  maxSourceCount: number;
}

export interface CurrentVideoTemporaryTranscriptLimits {
  maxSourceCount: number;
  maxBytes: number;
}

const temporaryTranscriptSources = new Map<string, TemporaryTranscriptEntry>();
const temporaryTranscriptCurrentSources = new Map<string, CurrentVideoTemporaryTranscriptCurrentSource>();
const temporaryTranscriptTabGenerations = new Map<number, number>();
const temporaryTranscriptTabOwners = new Map<number, CurrentVideoTemporaryTranscriptOwner>();

type CurrentVideoTemporaryTranscriptOwnerInput = Omit<
  CurrentVideoTemporaryTranscriptOwner,
  'navigationGeneration'
>;

export function putTemporaryCurrentVideoTranscriptEvidence(
  owner: CurrentVideoTemporaryTranscriptOwner,
  evidence: CurrentVideoTranscriptEvidenceWrite,
  now = Date.now(),
  limits: Partial<CurrentVideoTemporaryTranscriptLimits> = {},
): CurrentVideoTemporaryTranscriptPutResult {
  const normalizedLimits = normalizeTemporaryTranscriptLimits(limits);
  if (!validOwner(owner) || !ownerMatchesIdentity(owner, evidence.sourceRecord)) {
    return temporaryPutResult('invalid_owner', normalizedLimits);
  }
  const sourceIdentityKey = evidence.sourceRecord.sourceIdentityKey
    ?? evidence.sourceRecord.identityKey
    ?? buildTranscriptIdentityKey(evidence.sourceRecord);
  const source: CurrentVideoTranscriptSourceRecord = {
    ...evidence.sourceRecord,
    identityKey: sourceIdentityKey,
    sourceIdentityKey,
    partIdentityKey: evidence.sourceRecord.partIdentityKey,
    persistent: false,
    stale: false,
    lastAccessedAt: now,
  };
  const segments = evidence.segments.map(segment => ({
    ...segment,
    sourceIdentityKey,
    stale: false,
  }));
  const sourceBytes = measureTranscriptPersistentBytes(source, segments);
  const retainedEntries = Array.from(temporaryTranscriptSources.values())
    .filter(entry => !sameOwner(entry.owner, owner));
  const retainedBytes = retainedEntries.reduce(
    (sum, entry) => sum + measureTranscriptPersistentBytes(entry.source, entry.segments),
    0,
  );
  if (sourceBytes > normalizedLimits.maxBytes) {
    clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);
    setTemporaryCurrentVideoTranscriptCurrentSource(owner, source, 'source_too_large', now);
    return temporaryPutResult('source_too_large', normalizedLimits, {
      sourceIdentityKey,
      sourceBytes,
      retainedBytes,
      retainedSourceCount: retainedEntries.length,
    });
  }

  const projectedSourceCount = retainedEntries.length + 1;
  const projectedBytes = retainedBytes + sourceBytes;
  if (
    projectedSourceCount > normalizedLimits.maxSourceCount
    || projectedBytes > normalizedLimits.maxBytes
  ) {
    clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);
    setTemporaryCurrentVideoTranscriptCurrentSource(owner, source, 'capacity_exceeded', now);
    return temporaryPutResult('capacity_exceeded', normalizedLimits, {
      sourceIdentityKey,
      sourceBytes,
      retainedBytes,
      retainedSourceCount: retainedEntries.length,
    });
  }

  clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);
  setTemporaryCurrentVideoTranscriptCurrentSource(owner, source, 'temporary_cached', now);

  temporaryTranscriptSources.set(entryKey(owner.ownerTabId, sourceIdentityKey), {
    owner: { ...owner },
    source,
    segments,
    savedAt: now,
  });
  return temporaryPutResult('stored', normalizedLimits, {
    sourceIdentityKey,
    sourceBytes,
    retainedBytes: projectedBytes,
    retainedSourceCount: projectedSourceCount,
  });
}

export function markTemporaryCurrentVideoTranscriptPersistentSource(
  owner: CurrentVideoTemporaryTranscriptOwner,
  sourceRecord: CurrentVideoTranscriptSourceRecord,
  now = Date.now(),
): void {
  if (!validOwner(owner) || !ownerMatchesIdentity(owner, sourceRecord)) return;
  const sourceIdentityKey = sourceRecord.sourceIdentityKey
    ?? sourceRecord.identityKey
    ?? buildTranscriptIdentityKey(sourceRecord);
  clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);
  setTemporaryCurrentVideoTranscriptCurrentSource(owner, {
    ...sourceRecord,
    identityKey: sourceIdentityKey,
    sourceIdentityKey,
  }, 'persistent_cached', now);
}

export function getTemporaryCurrentVideoTranscriptEvidenceState(
  owner: CurrentVideoTemporaryTranscriptOwner,
  identity: CurrentVideoTranscriptIdentity,
  now = Date.now(),
): CurrentVideoTranscriptEvidenceState {
  const entries = matchingTemporaryEntries(owner, identity, now);
  return buildTranscriptEvidenceStateFromCache(
    identity,
    entries.map(entry => entry.source),
    entries.flatMap(entry => entry.segments),
    now,
  );
}

export function getTemporaryCurrentVideoTranscriptSegments(
  owner: CurrentVideoTemporaryTranscriptOwner,
  identity: CurrentVideoTranscriptIdentity & { sourceHash?: string | null },
  now = Date.now(),
): CurrentVideoTranscriptSegment[] {
  const state = getTemporaryCurrentVideoTranscriptEvidenceState(owner, identity, now);
  if (!state.active || !state.sourceIdentityKey) return [];
  const entry = temporaryTranscriptSources.get(entryKey(owner.ownerTabId, state.sourceIdentityKey));
  if (!entry || !sameOwner(entry.owner, owner)) return [];
  entry.source.lastAccessedAt = now;
  entry.savedAt = now;
  return entry.segments
    .filter(segment =>
      !segment.stale
      && segment.bvid === identity.bvid
      && segment.cid === identity.cid
      && segment.page === identity.page
      && (!identity.language || languageKey(segment.language) === languageKey(identity.language))
      && (!identity.sourceHash || segment.sourceHash === identity.sourceHash)
      && (!identity.sourceIdentityKey || segment.sourceIdentityKey === identity.sourceIdentityKey),
    )
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
}

export function getTemporaryCurrentVideoTranscriptOwnerReadResolution(
  owner: CurrentVideoTemporaryTranscriptOwner,
  identity: CurrentVideoTranscriptIdentity,
  now = Date.now(),
): CurrentVideoTemporaryTranscriptOwnerReadResolution | null {
  if (!validOwner(owner) || !ownerMatchesIdentity(owner, identity)) return null;
  const marker = temporaryTranscriptCurrentSources.get(currentSourceKey(owner));
  if (!marker || !sameOwner(marker.owner, owner)) return null;
  const currentIdentity = currentSourceIdentity(marker);
  const requestedMatchesCurrentSource = requestedIdentityMatchesCurrentSource(marker, identity);
  if (
    (marker.status === 'source_too_large' || marker.status === 'capacity_exceeded')
    && !requestedMatchesCurrentSource
  ) {
    return {
      kind: 'mismatch',
      state: buildTemporaryCurrentVideoTranscriptFailureState(
        currentIdentity,
        marker.sourceType,
        marker.status,
        now,
      ),
    };
  }
  if (!requestedMatchesCurrentSource) {
    return {
      kind: 'mismatch',
      state: buildTemporaryCurrentVideoTranscriptCurrentSourceMismatchState(identity, now),
    };
  }

  if (marker.status === 'temporary_cached') {
    return { kind: 'temporary', identity: currentIdentity };
  }
  if (marker.status === 'persistent_cached') {
    return { kind: 'persistent', identity: currentIdentity };
  }
  return {
    kind: 'rejected',
    identity: currentIdentity,
    state: buildTemporaryCurrentVideoTranscriptFailureState(
      currentIdentity,
      marker.sourceType,
      marker.status,
      now,
    ),
  };
}

export function buildTemporaryCurrentVideoTranscriptUnavailableState(
  identity: CurrentVideoTranscriptIdentity,
  now = Date.now(),
): CurrentVideoTranscriptEvidenceState {
  return buildCurrentVideoTranscriptEvidenceState({
    status: 'missing',
    target: identity,
    now,
    sourceType: identity.sourceType ?? 'none',
    sourceIdentityKey: identity.sourceIdentityKey ?? null,
    sourceHash: identity.sourceHash ?? null,
    reason: 'temporary_transcript_current_source_unavailable',
    message: '当前页面刚检测到的字幕正文已不在临时内存中；不会自动回退到旧正文，请重新检测字幕。',
    warnings: ['transcript_temporary_current_source_unavailable'],
  });
}

export function buildTemporaryCurrentVideoTranscriptWriteFailureState(
  evidence: CurrentVideoTranscriptEvidenceWrite,
  result: CurrentVideoTemporaryTranscriptPutResult | null,
): CurrentVideoTranscriptEvidenceState {
  const status = result?.status ?? 'invalid_owner';
  const copy = temporaryTranscriptFailureCopy(status);
  return buildCurrentVideoTranscriptEvidenceState({
    status: 'missing',
    target: {
      bvid: evidence.sourceRecord.bvid,
      cid: evidence.sourceRecord.cid,
      page: evidence.sourceRecord.page,
      language: evidence.sourceRecord.language,
    },
    now: Date.now(),
    sourceType: evidence.sourceRecord.sourceType,
    reason: copy.reason,
    message: copy.message,
    warnings: [copy.warning],
  });
}

export function isTemporaryCurrentVideoTranscriptOwnerValidForIdentity(
  owner: CurrentVideoTemporaryTranscriptOwner,
  identity: Pick<CurrentVideoTranscriptIdentity, 'bvid' | 'cid' | 'page'>,
): boolean {
  return validOwner(owner) && ownerMatchesIdentity(owner, identity);
}

export function retainTemporaryCurrentVideoTranscriptOwner(
  owner: CurrentVideoTemporaryTranscriptOwnerInput,
): CurrentVideoTemporaryTranscriptOwner | null {
  if (!validOwnerInput(owner)) return null;
  const previousOwner = temporaryTranscriptTabOwners.get(owner.ownerTabId);
  let navigationGeneration = temporaryTranscriptTabGenerations.get(owner.ownerTabId) ?? 0;
  if (previousOwner && !sameOwnerIdentity(previousOwner, owner)) {
    navigationGeneration += 1;
  }
  const retained = {
    ...owner,
    navigationGeneration,
  };
  temporaryTranscriptTabGenerations.set(owner.ownerTabId, navigationGeneration);
  temporaryTranscriptTabOwners.set(owner.ownerTabId, retained);

  for (const [key, entry] of temporaryTranscriptSources) {
    if (entry.owner.ownerTabId === retained.ownerTabId && !sameOwner(entry.owner, retained)) {
      temporaryTranscriptSources.delete(key);
    }
  }
  for (const [key, marker] of temporaryTranscriptCurrentSources) {
    if (marker.owner.ownerTabId === retained.ownerTabId && !sameOwner(marker.owner, retained)) {
      temporaryTranscriptCurrentSources.delete(key);
    }
  }
  return retained;
}

export function clearTemporaryCurrentVideoTranscriptCacheForTab(ownerTabId: number): void {
  for (const [key, entry] of temporaryTranscriptSources) {
    if (entry.owner.ownerTabId === ownerTabId) {
      temporaryTranscriptSources.delete(key);
    }
  }
  for (const [key, marker] of temporaryTranscriptCurrentSources) {
    if (marker.owner.ownerTabId === ownerTabId) {
      temporaryTranscriptCurrentSources.delete(key);
    }
  }
  invalidateTemporaryCurrentVideoTranscriptTab(ownerTabId);
}

export function clearTemporaryCurrentVideoTranscriptCacheForOwner(
  owner: CurrentVideoTemporaryTranscriptOwner,
): void {
  if (!validOwner(owner)) return;
  clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);
  temporaryTranscriptCurrentSources.delete(currentSourceKey(owner));
}

export function clearTemporaryCurrentVideoTranscriptCache(): void {
  const ownerTabIds = new Set<number>([
    ...temporaryTranscriptTabGenerations.keys(),
    ...temporaryTranscriptTabOwners.keys(),
    ...Array.from(temporaryTranscriptSources.values()).map(entry => entry.owner.ownerTabId),
    ...Array.from(temporaryTranscriptCurrentSources.values()).map(marker => marker.owner.ownerTabId),
  ]);
  temporaryTranscriptSources.clear();
  temporaryTranscriptCurrentSources.clear();
  temporaryTranscriptTabOwners.clear();
  for (const ownerTabId of ownerTabIds) {
    invalidateTemporaryCurrentVideoTranscriptTab(ownerTabId);
  }
}

function matchingTemporaryEntries(
  owner: CurrentVideoTemporaryTranscriptOwner,
  identity: CurrentVideoTranscriptIdentity,
  now: number,
): TemporaryTranscriptEntry[] {
  if (!validOwner(owner) || !ownerMatchesIdentity(owner, identity)) return [];
  const entries: TemporaryTranscriptEntry[] = [];
  for (const entry of temporaryTranscriptSources.values()) {
    if (!sameOwner(entry.owner, owner)) continue;
    if (identity.sourceIdentityKey && entry.source.sourceIdentityKey !== identity.sourceIdentityKey) {
      continue;
    }
    if (identity.language && languageKey(entry.source.language) !== languageKey(identity.language)) {
      continue;
    }
    if (identity.sourceHash && entry.source.sourceHash !== identity.sourceHash) {
      continue;
    }
    entry.source.lastAccessedAt = now;
    entry.savedAt = now;
    entries.push(entry);
  }
  return entries;
}

function clearTemporaryCurrentVideoTranscriptSourceReplacement(
  owner: CurrentVideoTemporaryTranscriptOwner,
): void {
  for (const [key, entry] of temporaryTranscriptSources) {
    if (sameOwner(entry.owner, owner)) {
      temporaryTranscriptSources.delete(key);
    }
  }
}

function setTemporaryCurrentVideoTranscriptCurrentSource(
  owner: CurrentVideoTemporaryTranscriptOwner,
  source: CurrentVideoTranscriptSourceRecord,
  status: CurrentVideoTemporaryTranscriptCurrentSourceStatus,
  now: number,
): void {
  const sourceIdentityKey = source.sourceIdentityKey
    ?? source.identityKey
    ?? buildTranscriptIdentityKey(source);
  temporaryTranscriptCurrentSources.set(currentSourceKey(owner), {
    owner: { ...owner },
    sourceIdentityKey,
    sourceHash: source.sourceHash ?? null,
    language: source.language,
    sourceType: source.sourceType,
    status,
    savedAt: now,
  });
}

function currentSourceIdentity(
  marker: CurrentVideoTemporaryTranscriptCurrentSource,
): CurrentVideoTranscriptIdentity {
  return {
    bvid: marker.owner.bvid,
    cid: marker.owner.cid,
    page: marker.owner.page,
    language: marker.language,
    sourceIdentityKey: marker.sourceIdentityKey,
    sourceHash: marker.sourceHash,
    sourceType: marker.sourceType,
  };
}

function requestedIdentityMatchesCurrentSource(
  marker: CurrentVideoTemporaryTranscriptCurrentSource,
  identity: CurrentVideoTranscriptIdentity,
): boolean {
  if (identity.language && languageKey(identity.language) !== languageKey(marker.language)) {
    return false;
  }
  if (identity.sourceIdentityKey && identity.sourceIdentityKey !== marker.sourceIdentityKey) {
    return false;
  }
  if (identity.sourceHash && identity.sourceHash !== marker.sourceHash) {
    return false;
  }
  return true;
}

function buildTemporaryCurrentVideoTranscriptCurrentSourceMismatchState(
  identity: CurrentVideoTranscriptIdentity,
  now: number,
): CurrentVideoTranscriptEvidenceState {
  return buildCurrentVideoTranscriptEvidenceState({
    status: 'stale',
    target: identity,
    now,
    sourceType: identity.sourceType ?? 'none',
    sourceIdentityKey: identity.sourceIdentityKey ?? null,
    sourceHash: identity.sourceHash ?? null,
    reason: 'requested_transcript_identity_not_current',
    message: '此前选择的字幕正文已不是当前页面刚检测到的正文；不会自动回退到旧正文，请重新检测或重新选择主要文本来源。',
    warnings: ['transcript_current_source_mismatch'],
  });
}

function buildTemporaryCurrentVideoTranscriptFailureState(
  identity: CurrentVideoTranscriptIdentity,
  sourceType: CurrentVideoTranscriptSourceRecord['sourceType'],
  status: Extract<
    CurrentVideoTemporaryTranscriptCurrentSourceStatus,
    'source_too_large' | 'capacity_exceeded'
  >,
  now: number,
): CurrentVideoTranscriptEvidenceState {
  const copy = temporaryTranscriptFailureCopy(status);
  return buildCurrentVideoTranscriptEvidenceState({
    status: 'missing',
    target: identity,
    now,
    sourceType,
    sourceIdentityKey: identity.sourceIdentityKey ?? null,
    sourceHash: identity.sourceHash ?? null,
    reason: copy.reason,
    message: copy.message,
    warnings: [copy.warning],
  });
}

function entryKey(ownerTabId: number, sourceIdentityKey: string): string {
  return `${ownerTabId}:${sourceIdentityKey}`;
}

function currentSourceKey(owner: CurrentVideoTemporaryTranscriptOwner): string {
  return [
    owner.ownerTabId,
    owner.navigationGeneration,
    owner.bvid,
    owner.cid,
    owner.page,
  ].join(':');
}

function temporaryPutResult(
  status: CurrentVideoTemporaryTranscriptPutStatus,
  limits: CurrentVideoTemporaryTranscriptLimits,
  details: Partial<Pick<
    CurrentVideoTemporaryTranscriptPutResult,
    'sourceIdentityKey' | 'sourceBytes' | 'retainedBytes' | 'retainedSourceCount'
  >> = {},
): CurrentVideoTemporaryTranscriptPutResult {
  return {
    status,
    sourceIdentityKey: details.sourceIdentityKey,
    sourceBytes: details.sourceBytes,
    retainedBytes: details.retainedBytes ?? temporaryTranscriptRetainedBytes(),
    retainedSourceCount: details.retainedSourceCount ?? temporaryTranscriptSources.size,
    maxBytes: limits.maxBytes,
    maxSourceCount: limits.maxSourceCount,
  };
}

function temporaryTranscriptFailureCopy(
  status: CurrentVideoTemporaryTranscriptPutResult['status'],
): { reason: string; message: string; warning: string } {
  switch (status) {
    case 'source_too_large':
      return {
        reason: 'temporary_transcript_source_too_large',
        message: '这份字幕正文过大，本次未保留。你仍可使用播放器字幕；如内容发生变化，可稍后重新检测。',
        warning: 'transcript_temporary_source_too_large',
      };
    case 'capacity_exceeded':
      return {
        reason: 'temporary_transcript_capacity_exceeded',
        message: '当前临时字幕缓存已达到上限，未替换其他仍有效的视频页面；请关闭不需要的页面后重新检测。',
        warning: 'transcript_temporary_capacity_exceeded',
      };
    case 'invalid_owner':
    case 'stored':
    default:
      return {
        reason: 'temporary_transcript_owner_missing',
        message: '本次临时内容已失效，请重新检测字幕。',
        warning: 'transcript_temporary_owner_missing',
      };
  }
}

function normalizeTemporaryTranscriptLimits(
  limits: Partial<CurrentVideoTemporaryTranscriptLimits>,
): CurrentVideoTemporaryTranscriptLimits {
  const maxSourceCount = Number.isFinite(limits.maxSourceCount)
    ? Math.max(1, Math.floor(limits.maxSourceCount as number))
    : CURRENT_VIDEO_TEMPORARY_TRANSCRIPT_MAX_SOURCES;
  const maxBytes = Number.isFinite(limits.maxBytes)
    ? Math.max(1, Math.floor(limits.maxBytes as number))
    : CURRENT_VIDEO_TEMPORARY_TRANSCRIPT_MAX_BYTES;
  return { maxSourceCount, maxBytes };
}

function temporaryTranscriptRetainedBytes(): number {
  return Array.from(temporaryTranscriptSources.values())
    .reduce((sum, entry) => sum + measureTranscriptPersistentBytes(entry.source, entry.segments), 0);
}

function validOwnerInput(owner: CurrentVideoTemporaryTranscriptOwnerInput): boolean {
  return Number.isInteger(owner.ownerTabId)
    && owner.ownerTabId > 0
    && Boolean(owner.bvid)
    && Number.isFinite(owner.cid)
    && Number.isFinite(owner.page);
}

function validOwner(owner: CurrentVideoTemporaryTranscriptOwner): boolean {
  if (!validOwnerInput(owner)) return false;
  if (!Number.isInteger(owner.navigationGeneration) || owner.navigationGeneration < 0) return false;
  if ((temporaryTranscriptTabGenerations.get(owner.ownerTabId) ?? 0) !== owner.navigationGeneration) {
    return false;
  }
  const retained = temporaryTranscriptTabOwners.get(owner.ownerTabId);
  return Boolean(retained && sameOwner(retained, owner));
}

function ownerMatchesIdentity(
  owner: CurrentVideoTemporaryTranscriptOwner,
  identity: Pick<CurrentVideoTranscriptIdentity, 'bvid' | 'cid' | 'page'>,
): boolean {
  return owner.bvid === identity.bvid
    && owner.cid === identity.cid
    && owner.page === identity.page;
}

function sameOwner(
  left: CurrentVideoTemporaryTranscriptOwner,
  right: CurrentVideoTemporaryTranscriptOwner,
): boolean {
  return left.ownerTabId === right.ownerTabId
    && left.bvid === right.bvid
    && left.cid === right.cid
    && left.page === right.page
    && left.navigationGeneration === right.navigationGeneration;
}

function sameOwnerIdentity(
  left: CurrentVideoTemporaryTranscriptOwnerInput,
  right: CurrentVideoTemporaryTranscriptOwnerInput,
): boolean {
  return left.ownerTabId === right.ownerTabId
    && left.bvid === right.bvid
    && left.cid === right.cid
    && left.page === right.page;
}

function invalidateTemporaryCurrentVideoTranscriptTab(ownerTabId: number): void {
  if (!Number.isInteger(ownerTabId) || ownerTabId <= 0) return;
  const generation = (temporaryTranscriptTabGenerations.get(ownerTabId) ?? 0) + 1;
  temporaryTranscriptTabGenerations.set(ownerTabId, generation);
  temporaryTranscriptTabOwners.delete(ownerTabId);
}

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}
