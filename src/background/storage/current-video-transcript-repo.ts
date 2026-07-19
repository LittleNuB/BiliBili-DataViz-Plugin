import {
  buildCurrentVideoTranscriptEvidenceState,
  buildTranscriptEvidenceStateFromCache,
  planTranscriptEvidenceUpsert,
} from '../../shared/current-video-transcript-cache.ts';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptIdentity,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from '../../shared/types/current-video-transcript.ts';
import {
  buildTemporaryCurrentVideoTranscriptUnavailableState,
  buildTemporaryCurrentVideoTranscriptWriteFailureState,
  getTemporaryCurrentVideoTranscriptEvidenceState,
  getTemporaryCurrentVideoTranscriptCurrentSourceIdentity,
  getTemporaryCurrentVideoTranscriptSegments,
  getTemporaryCurrentVideoTranscriptOwnerReadResolution,
  isTemporaryCurrentVideoTranscriptOwnerValidForIdentity,
  markTemporaryCurrentVideoTranscriptPersistentSource,
  putTemporaryCurrentVideoTranscriptEvidence,
  type CurrentVideoTemporaryTranscriptOwner,
} from '../current-video-temporary-transcript-cache.ts';
import {
  canUseCurrentVideoTranscriptClearGeneration,
  getCurrentVideoTranscriptClearState,
} from '../current-video-transcript-clear-epoch.ts';
import { db } from './db.ts';

export interface UpsertCurrentVideoTranscriptEvidenceOptions {
  protectedSourceIdentityKeys?: Iterable<string>;
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner;
  expectedClearGeneration?: number;
}

export async function upsertCurrentVideoTranscriptEvidence(
  evidence: CurrentVideoTranscriptEvidenceWrite,
  options: UpsertCurrentVideoTranscriptEvidenceOptions = {},
): Promise<CurrentVideoTranscriptEvidenceState> {
  let state: CurrentVideoTranscriptEvidenceState | null = null;
  const persistentSourcesToMarkAfterCommit: Array<{
    owner: CurrentVideoTemporaryTranscriptOwner;
    source: CurrentVideoTranscriptSourceRecord;
  }> = [];
  const expectedClearGeneration = options.expectedClearGeneration
    ?? getCurrentVideoTranscriptClearState().generation;

  await db.transaction(
    'rw',
    db.currentVideoTranscriptSources,
    db.currentVideoTranscriptSegments,
    async () => {
      if (!currentVideoTranscriptGenerationStillWritable(expectedClearGeneration)) {
        state = transcriptClearedBeforeWriteState(evidence);
        return;
      }
      if (
        options.temporaryOwner
        && !isTemporaryCurrentVideoTranscriptOwnerValidForIdentity(options.temporaryOwner, evidence.sourceRecord)
      ) {
        state = buildTemporaryCurrentVideoTranscriptWriteFailureState(evidence, null);
        return;
      }
      const [sources, segments] = await Promise.all([
        db.currentVideoTranscriptSources.toArray(),
        db.currentVideoTranscriptSegments.toArray(),
      ]);
      const plan = planTranscriptEvidenceUpsert(sources, segments, evidence, {
        protectedSourceIdentityKeys: options.protectedSourceIdentityKeys,
      });
      if (plan.skippedPersistentWrite) {
        if (!currentVideoTranscriptGenerationStillWritable(expectedClearGeneration)) {
          state = transcriptClearedBeforeWriteState(evidence);
          return;
        }
        const temporaryResult = options.temporaryOwner
          ? putTemporaryCurrentVideoTranscriptEvidence(options.temporaryOwner, evidence)
          : null;
        if (temporaryResult?.status !== 'stored') {
          state = buildTemporaryCurrentVideoTranscriptWriteFailureState(evidence, temporaryResult);
        }
      }

      if (!currentVideoTranscriptGenerationStillWritable(expectedClearGeneration)) {
        state = transcriptClearedBeforeWriteState(evidence);
        return;
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
      if (!plan.skippedPersistentWrite && options.temporaryOwner) {
        persistentSourcesToMarkAfterCommit.push({
          owner: options.temporaryOwner,
          source: plan.sourcesToPut[0] ?? evidence.sourceRecord,
        });
      }
    },
  );

  if (!currentVideoTranscriptGenerationStillWritable(expectedClearGeneration)) {
    state = transcriptClearedBeforeWriteState(evidence);
  } else if (
    options.temporaryOwner
    && !isTemporaryCurrentVideoTranscriptOwnerValidForIdentity(options.temporaryOwner, evidence.sourceRecord)
  ) {
    state = buildTemporaryCurrentVideoTranscriptWriteFailureState(evidence, null);
  } else {
    for (const ownerSource of persistentSourcesToMarkAfterCommit) {
      markTemporaryCurrentVideoTranscriptPersistentSource(
        ownerSource.owner,
        ownerSource.source,
      );
    }
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
  const ownerStillValid = () => !temporaryOwnerInvalidForIdentity(temporaryOwner, identity);
  if (!ownerStillValid()) {
    return buildTemporaryCurrentVideoTranscriptUnavailableState(identity, now);
  }

  const [sources, segments] = await Promise.all([
    db.currentVideoTranscriptSources.where('bvid').equals(identity.bvid).toArray(),
    db.currentVideoTranscriptSegments.where('bvid').equals(identity.bvid).toArray(),
  ]);

  if (!ownerStillValid()) {
    return buildTemporaryCurrentVideoTranscriptUnavailableState(identity, now);
  }

  if (temporaryOwner) {
    const ownerRead = getTemporaryCurrentVideoTranscriptOwnerReadResolution(
      temporaryOwner,
      identity,
      now,
    );
    if (ownerRead) {
      if (ownerRead.kind === 'mismatch') {
        return ownerRead.state;
      }

      if (ownerRead.kind === 'temporary') {
        const temporaryState = getTemporaryCurrentVideoTranscriptEvidenceState(
          temporaryOwner,
          ownerRead.identity,
          now,
        );
        if (temporaryState.active) return temporaryState;
      }

      const persistentCurrentState = buildTranscriptEvidenceStateFromCache(
        ownerRead.identity,
        sources,
        segments,
        now,
      );
      if (persistentCurrentState.sourceIdentityKey && persistentCurrentState.active) {
        await touchTranscriptSource(persistentCurrentState.sourceIdentityKey, now, ownerStillValid);
        if (!ownerStillValid()) {
          return buildTemporaryCurrentVideoTranscriptUnavailableState(identity, now);
        }
        return persistentCurrentState;
      }

      if (ownerRead.kind === 'rejected') {
        return ownerRead.state;
      }
      return buildTemporaryCurrentVideoTranscriptUnavailableState(ownerRead.identity, now);
    }
  }

  const state = buildTranscriptEvidenceStateFromCache(identity, sources, segments, now);
  if (state.sourceIdentityKey && state.active) {
    await touchTranscriptSource(state.sourceIdentityKey, now, ownerStillValid);
    if (!ownerStillValid()) {
      return buildTemporaryCurrentVideoTranscriptUnavailableState(identity, now);
    }
    return state;
  }
  if (!temporaryOwner) return state;
  const temporaryState = getTemporaryCurrentVideoTranscriptEvidenceState(temporaryOwner, identity, now);
  return temporaryState.active ? temporaryState : state;
}

export async function getCurrentVideoActiveTranscriptSourceIdentityKeys(
  identity: Pick<CurrentVideoTranscriptIdentity, 'bvid' | 'cid' | 'page'>,
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner,
): Promise<string[]> {
  if (temporaryOwnerInvalidForIdentity(temporaryOwner, identity)) return [];

  const temporaryIdentity = temporaryOwner
    ? getTemporaryCurrentVideoTranscriptCurrentSourceIdentity(temporaryOwner)
    : null;
  if (
    temporaryIdentity?.sourceIdentityKey
    && temporaryIdentity.bvid === identity.bvid
    && temporaryIdentity.cid === identity.cid
    && temporaryIdentity.page === identity.page
  ) {
    return [temporaryIdentity.sourceIdentityKey];
  }

  const sources = await db.currentVideoTranscriptSources
    .where('[bvid+cid+page]')
    .equals([identity.bvid, identity.cid, identity.page])
    .toArray();
  if (temporaryOwnerInvalidForIdentity(temporaryOwner, identity)) return [];

  const sourceIdentityKeys = Array.from(new Set(
    sources
      .filter(source => !source.stale && source.status === 'cached' && source.segmentCount > 0)
      .map(source => (source.sourceIdentityKey ?? source.identityKey).trim())
      .filter(Boolean),
  ));
  return sourceIdentityKeys;
}

export async function getCurrentVideoTranscriptSegments(
  identity: CurrentVideoTranscriptIdentity & { sourceHash?: string | null },
  temporaryOwner?: CurrentVideoTemporaryTranscriptOwner,
): Promise<CurrentVideoTranscriptSegment[]> {
  if (temporaryOwnerInvalidForIdentity(temporaryOwner, identity)) {
    return [];
  }

  const rows = await db.currentVideoTranscriptSegments
    .where('[bvid+cid+page]')
    .equals([identity.bvid, identity.cid, identity.page])
    .toArray();

  if (temporaryOwnerInvalidForIdentity(temporaryOwner, identity)) {
    return [];
  }

  if (temporaryOwner) {
    const ownerRead = getTemporaryCurrentVideoTranscriptOwnerReadResolution(temporaryOwner, identity);
    if (ownerRead) {
      if (ownerRead.kind === 'mismatch') return [];
      if (ownerRead.kind === 'temporary') {
        const temporarySegments = getTemporaryCurrentVideoTranscriptSegments(
          temporaryOwner,
          ownerRead.identity,
        );
        if (temporarySegments.length > 0) return temporarySegments;
      }

      const persistentCurrentSegments = persistentTranscriptSegmentsForIdentity(
        rows,
        ownerRead.identity,
      );
      if (persistentCurrentSegments.length > 0) return persistentCurrentSegments;
      return [];
    }
  }

  const persistentSegments = persistentTranscriptSegmentsForIdentity(rows, identity);
  if (persistentSegments.length > 0) return persistentSegments;
  return temporaryOwner
    ? getTemporaryCurrentVideoTranscriptSegments(temporaryOwner, identity)
    : [];
}

function persistentTranscriptSegmentsForIdentity(
  rows: CurrentVideoTranscriptSegment[],
  identity: CurrentVideoTranscriptIdentity & { sourceHash?: string | null },
): CurrentVideoTranscriptSegment[] {
  const expectedLanguage = languageKey(identity.language);
  const expectedSourceHash = identity.sourceHash ?? null;
  const expectedSourceIdentityKey = identity.sourceIdentityKey ?? null;

  return rows
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
}

async function touchTranscriptSource(
  sourceIdentityKey: string,
  now: number,
  shouldTouch = () => true,
): Promise<void> {
  if (!shouldTouch()) return;
  await db.currentVideoTranscriptSources
    .where('identityKey')
    .equals(sourceIdentityKey)
    .modify((source: CurrentVideoTranscriptSourceRecord) => {
      if (!shouldTouch()) return;
      source.lastAccessedAt = now;
    });
}

function temporaryOwnerInvalidForIdentity(
  temporaryOwner: CurrentVideoTemporaryTranscriptOwner | undefined,
  identity: Pick<CurrentVideoTranscriptIdentity, 'bvid' | 'cid' | 'page'>,
): boolean {
  return Boolean(
    temporaryOwner
    && !isTemporaryCurrentVideoTranscriptOwnerValidForIdentity(temporaryOwner, identity),
  );
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

function currentVideoTranscriptGenerationStillWritable(generation: number): boolean {
  return canUseCurrentVideoTranscriptClearGeneration(generation);
}

function transcriptClearedBeforeWriteState(
  evidence: CurrentVideoTranscriptEvidenceWrite,
): CurrentVideoTranscriptEvidenceState {
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
    reason: 'transcript_cache_cleared_during_request',
    message: '字幕缓存已在本次检测过程中被清理；请重新检测当前视频字幕正文。',
    warnings: ['transcript_cache_cleared_during_request'],
  });
}
