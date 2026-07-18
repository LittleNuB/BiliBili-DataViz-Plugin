import {
  buildCurrentVideoTranscriptEvidenceState,
  buildTranscriptEvidenceStateFromCache,
  planTranscriptEvidenceUpsert,
} from '../../shared/current-video-transcript-cache';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptIdentity,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from '../../shared/types/current-video-transcript';
import {
  clearTemporaryCurrentVideoTranscriptCacheForOwner,
  getTemporaryCurrentVideoTranscriptEvidenceState,
  getTemporaryCurrentVideoTranscriptSegments,
  putTemporaryCurrentVideoTranscriptEvidence,
  type CurrentVideoTemporaryTranscriptOwner,
} from '../current-video-temporary-transcript-cache.ts';
import { db } from './db';

export interface UpsertCurrentVideoTranscriptEvidenceOptions {
  protectedSourceIdentityKeys?: Iterable<string>;
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner;
}

export async function upsertCurrentVideoTranscriptEvidence(
  evidence: CurrentVideoTranscriptEvidenceWrite,
  options: UpsertCurrentVideoTranscriptEvidenceOptions = {},
): Promise<CurrentVideoTranscriptEvidenceState> {
  let state: CurrentVideoTranscriptEvidenceState | null = null;
  let ownerToClearAfterCommit: CurrentVideoTemporaryTranscriptOwner | null = null;

  await db.transaction(
    'rw',
    db.currentVideoTranscriptSources,
    db.currentVideoTranscriptSegments,
    async () => {
      const [sources, segments] = await Promise.all([
        db.currentVideoTranscriptSources.toArray(),
        db.currentVideoTranscriptSegments.toArray(),
      ]);
      const plan = planTranscriptEvidenceUpsert(sources, segments, evidence, {
        protectedSourceIdentityKeys: options.protectedSourceIdentityKeys,
      });
      if (plan.skippedPersistentWrite) {
        const temporarilyStored = options.temporaryOwner
          ? putTemporaryCurrentVideoTranscriptEvidence(options.temporaryOwner, evidence)
          : false;
        if (!temporarilyStored) {
          state = buildCurrentVideoTranscriptEvidenceState({
            status: 'missing',
            target: {
              bvid: evidence.sourceRecord.bvid,
              cid: evidence.sourceRecord.cid,
              page: evidence.sourceRecord.page,
              language: evidence.sourceRecord.language,
            },
            now: Date.now(),
            sourceType: evidence.sourceRecord.sourceType,
            reason: 'temporary_transcript_owner_missing',
            message: '本次临时内容已失效，请重新检测字幕。',
            warnings: ['transcript_temporary_owner_missing'],
          });
        }
      } else if (!plan.skippedPersistentWrite && options.temporaryOwner) {
        ownerToClearAfterCommit = options.temporaryOwner;
      }

      if (plan.sourceIdsToDelete.length > 0) {
        await db.currentVideoTranscriptSources.bulkDelete(plan.sourceIdsToDelete);
      }
      if (plan.segmentIdsToDelete.length > 0) {
        await db.currentVideoTranscriptSegments.bulkDelete(plan.segmentIdsToDelete);
      }
      if (plan.sourcesToPut.length > 0) {
        await db.currentVideoTranscriptSources.bulkPut(plan.sourcesToPut);
      }
      if (!plan.skippedPersistentWrite && plan.segmentsToPut.length > 0) {
        await db.currentVideoTranscriptSegments.bulkPut(plan.segmentsToPut);
      }
      state ??= plan.state;
    },
  );

  if (ownerToClearAfterCommit) {
    clearTemporaryCurrentVideoTranscriptCacheForOwner(ownerToClearAfterCommit);
  }

  if (!state) {
    throw new Error('TRANSCRIPT_CACHE_WRITE_FAILED');
  }
  return state;
}

export async function getCurrentVideoTranscriptEvidenceState(
  identity: CurrentVideoTranscriptIdentity,
  now = Date.now(),
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner,
): Promise<CurrentVideoTranscriptEvidenceState> {
  const [sources, segments] = await Promise.all([
    db.currentVideoTranscriptSources.where('bvid').equals(identity.bvid).toArray(),
    db.currentVideoTranscriptSegments.where('bvid').equals(identity.bvid).toArray(),
  ]);

  const state = buildTranscriptEvidenceStateFromCache(identity, sources, segments, now);
  if (state.sourceIdentityKey && state.active) {
    await touchTranscriptSource(state.sourceIdentityKey, now);
    return state;
  }
  if (!temporaryOwner) return state;
  const temporaryState = getTemporaryCurrentVideoTranscriptEvidenceState(temporaryOwner, identity, now);
  return temporaryState.active ? temporaryState : state;
}

export async function getCurrentVideoTranscriptSegments(
  identity: CurrentVideoTranscriptIdentity & { sourceHash?: string | null },
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner,
): Promise<CurrentVideoTranscriptSegment[]> {
  const rows = await db.currentVideoTranscriptSegments
    .where('[bvid+cid+page]')
    .equals([identity.bvid, identity.cid, identity.page])
    .toArray();
  const expectedLanguage = languageKey(identity.language);
  const expectedSourceHash = identity.sourceHash ?? null;
  const expectedSourceIdentityKey = identity.sourceIdentityKey ?? null;

  const persistentSegments = rows
    .filter(segment =>
      !segment.stale
      && (!identity.language || languageKey(segment.language) === expectedLanguage)
      && (!expectedSourceHash || segment.sourceHash === expectedSourceHash),
    )
    .filter(segment =>
      !expectedSourceIdentityKey
      || segment.sourceIdentityKey === expectedSourceIdentityKey
      || legacySegmentSourceIdentity(segment) === expectedSourceIdentityKey,
    )
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  if (persistentSegments.length > 0) return persistentSegments;
  return temporaryOwner
    ? getTemporaryCurrentVideoTranscriptSegments(temporaryOwner, identity)
    : [];
}

async function touchTranscriptSource(sourceIdentityKey: string, now: number): Promise<void> {
  await db.currentVideoTranscriptSources
    .where('identityKey')
    .equals(sourceIdentityKey)
    .modify((source: CurrentVideoTranscriptSourceRecord) => {
      source.lastAccessedAt = now;
    });
}

function legacySegmentSourceIdentity(segment: CurrentVideoTranscriptSegment): string {
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

function languageKey(value: string | null | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase() || 'unknown';
}
