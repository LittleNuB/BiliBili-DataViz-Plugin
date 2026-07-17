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

interface TemporaryTranscriptEntry {
  source: CurrentVideoTranscriptSourceRecord;
  segments: CurrentVideoTranscriptSegment[];
  savedAt: number;
}

const temporaryTranscriptSources = new Map<string, TemporaryTranscriptEntry>();

export function putTemporaryCurrentVideoTranscriptEvidence(
  evidence: CurrentVideoTranscriptEvidenceWrite,
  now = Date.now(),
): void {
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

  temporaryTranscriptSources.set(sourceIdentityKey, {
    source,
    segments,
    savedAt: now,
  });
  trimTemporaryTranscriptSources();
}

export function getTemporaryCurrentVideoTranscriptEvidenceState(
  identity: CurrentVideoTranscriptIdentity,
  now = Date.now(),
): CurrentVideoTranscriptEvidenceState {
  const entries = matchingTemporaryEntries(identity, now);
  return buildTranscriptEvidenceStateFromCache(
    identity,
    entries.map(entry => entry.source),
    entries.flatMap(entry => entry.segments),
    now,
  );
}

export function getTemporaryCurrentVideoTranscriptSegments(
  identity: CurrentVideoTranscriptIdentity & { sourceHash?: string | null },
  now = Date.now(),
): CurrentVideoTranscriptSegment[] {
  const state = getTemporaryCurrentVideoTranscriptEvidenceState(identity, now);
  if (!state.active || !state.sourceIdentityKey) return [];
  const entry = temporaryTranscriptSources.get(state.sourceIdentityKey);
  if (!entry) return [];
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

export function clearTemporaryCurrentVideoTranscriptCache(): void {
  temporaryTranscriptSources.clear();
}

function matchingTemporaryEntries(
  identity: CurrentVideoTranscriptIdentity,
  now: number,
): TemporaryTranscriptEntry[] {
  const entries: TemporaryTranscriptEntry[] = [];
  for (const entry of temporaryTranscriptSources.values()) {
    if (identity.sourceIdentityKey && entry.source.sourceIdentityKey !== identity.sourceIdentityKey) {
      continue;
    }
    if (entry.source.bvid !== identity.bvid) continue;
    if (entry.source.cid !== identity.cid) continue;
    if (entry.source.page !== identity.page) continue;
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

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}
