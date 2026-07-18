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
  clearTemporaryCurrentVideoTranscriptCacheForOwner,
  getTemporaryCurrentVideoTranscriptEvidenceState,
  getTemporaryCurrentVideoTranscriptSegments,
  isTemporaryCurrentVideoTranscriptOwnerValidForIdentity,
  putTemporaryCurrentVideoTranscriptEvidence,
  type CurrentVideoTemporaryTranscriptPutResult,
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
  let ownerToClearAfterCommit: CurrentVideoTemporaryTranscriptOwner | null = null;
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
        state = temporaryTranscriptWriteFailureState(evidence, null);
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
          state = temporaryTranscriptWriteFailureState(evidence, temporaryResult);
        }
      } else if (!plan.skippedPersistentWrite && options.temporaryOwner) {
        ownerToClearAfterCommit = options.temporaryOwner;
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

function temporaryTranscriptWriteFailureState(
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
