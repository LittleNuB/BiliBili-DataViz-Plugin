import {
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
  if (sourceBytes > normalizedLimits.maxBytes) {
    return temporaryPutResult('source_too_large', normalizedLimits, {
      sourceIdentityKey,
      sourceBytes,
    });
  }

  const retainedEntries = Array.from(temporaryTranscriptSources.values())
    .filter(entry => !sameOwner(entry.owner, owner));
  const retainedBytes = retainedEntries.reduce(
    (sum, entry) => sum + measureTranscriptPersistentBytes(entry.source, entry.segments),
    0,
  );
  const projectedSourceCount = retainedEntries.length + 1;
  const projectedBytes = retainedBytes + sourceBytes;
  if (
    projectedSourceCount > normalizedLimits.maxSourceCount
    || projectedBytes > normalizedLimits.maxBytes
  ) {
    return temporaryPutResult('capacity_exceeded', normalizedLimits, {
      sourceIdentityKey,
      sourceBytes,
      retainedBytes,
      retainedSourceCount: retainedEntries.length,
    });
  }

  clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);

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
  return retained;
}

export function clearTemporaryCurrentVideoTranscriptCacheForTab(ownerTabId: number): void {
  for (const [key, entry] of temporaryTranscriptSources) {
    if (entry.owner.ownerTabId === ownerTabId) {
      temporaryTranscriptSources.delete(key);
    }
  }
  invalidateTemporaryCurrentVideoTranscriptTab(ownerTabId);
}

export function clearTemporaryCurrentVideoTranscriptCacheForOwner(
  owner: CurrentVideoTemporaryTranscriptOwner,
): void {
  clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);
}

export function clearTemporaryCurrentVideoTranscriptCache(): void {
  const ownerTabIds = new Set<number>([
    ...temporaryTranscriptTabGenerations.keys(),
    ...temporaryTranscriptTabOwners.keys(),
    ...Array.from(temporaryTranscriptSources.values()).map(entry => entry.owner.ownerTabId),
  ]);
  temporaryTranscriptSources.clear();
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

function entryKey(ownerTabId: number, sourceIdentityKey: string): string {
  return `${ownerTabId}:${sourceIdentityKey}`;
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
