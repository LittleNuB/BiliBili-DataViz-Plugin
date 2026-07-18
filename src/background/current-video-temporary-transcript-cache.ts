import {
  buildTranscriptEvidenceStateFromCache,
  buildTranscriptIdentityKey,
} from '../shared/current-video-transcript-cache.ts';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptIdentity,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from '../shared/types/current-video-transcript.ts';

const MAX_TEMPORARY_TRANSCRIPT_SOURCES = 4;

export interface CurrentVideoTemporaryTranscriptOwner {
  ownerTabId: number;
  bvid: string;
  cid: number;
  page: number;
}

interface TemporaryTranscriptEntry {
  owner: CurrentVideoTemporaryTranscriptOwner;
  source: CurrentVideoTranscriptSourceRecord;
  segments: CurrentVideoTranscriptSegment[];
  savedAt: number;
}

const temporaryTranscriptSources = new Map<string, TemporaryTranscriptEntry>();

export function putTemporaryCurrentVideoTranscriptEvidence(
  owner: CurrentVideoTemporaryTranscriptOwner,
  evidence: CurrentVideoTranscriptEvidenceWrite,
  now = Date.now(),
): boolean {
  if (!validOwner(owner) || !ownerMatchesIdentity(owner, evidence.sourceRecord)) return false;

  retainTemporaryCurrentVideoTranscriptOwner(owner);
  clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);

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

  temporaryTranscriptSources.set(entryKey(owner.ownerTabId, sourceIdentityKey), {
    owner: { ...owner },
    source,
    segments,
    savedAt: now,
  });
  trimTemporaryTranscriptSources();
  return true;
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

export function retainTemporaryCurrentVideoTranscriptOwner(
  owner: CurrentVideoTemporaryTranscriptOwner,
): void {
  for (const [key, entry] of temporaryTranscriptSources) {
    if (entry.owner.ownerTabId === owner.ownerTabId && !sameOwner(entry.owner, owner)) {
      temporaryTranscriptSources.delete(key);
    }
  }
}

export function clearTemporaryCurrentVideoTranscriptCacheForTab(ownerTabId: number): void {
  for (const [key, entry] of temporaryTranscriptSources) {
    if (entry.owner.ownerTabId === ownerTabId) {
      temporaryTranscriptSources.delete(key);
    }
  }
}

export function clearTemporaryCurrentVideoTranscriptCacheForOwner(
  owner: CurrentVideoTemporaryTranscriptOwner,
): void {
  clearTemporaryCurrentVideoTranscriptSourceReplacement(owner);
}

export function clearTemporaryCurrentVideoTranscriptCache(): void {
  temporaryTranscriptSources.clear();
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

function trimTemporaryTranscriptSources(): void {
  if (temporaryTranscriptSources.size <= MAX_TEMPORARY_TRANSCRIPT_SOURCES) return;
  const oldestKeys = Array.from(temporaryTranscriptSources.entries())
    .sort((a, b) => a[1].savedAt - b[1].savedAt)
    .slice(0, temporaryTranscriptSources.size - MAX_TEMPORARY_TRANSCRIPT_SOURCES)
    .map(([key]) => key);
  for (const key of oldestKeys) {
    temporaryTranscriptSources.delete(key);
  }
}

function entryKey(ownerTabId: number, sourceIdentityKey: string): string {
  return `${ownerTabId}:${sourceIdentityKey}`;
}

function validOwner(owner: CurrentVideoTemporaryTranscriptOwner): boolean {
  return Number.isInteger(owner.ownerTabId)
    && owner.ownerTabId > 0
    && Boolean(owner.bvid)
    && Number.isFinite(owner.cid)
    && Number.isFinite(owner.page);
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
    && left.page === right.page;
}

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}
