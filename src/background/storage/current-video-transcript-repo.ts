import {
  buildTranscriptEvidenceStateFromCache,
  planTranscriptEvidenceUpsert,
} from '../../shared/current-video-transcript-cache';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptIdentity,
} from '../../shared/types/current-video-transcript';
import { db } from './db';

export async function upsertCurrentVideoTranscriptEvidence(
  evidence: CurrentVideoTranscriptEvidenceWrite,
): Promise<CurrentVideoTranscriptEvidenceState> {
  let state: CurrentVideoTranscriptEvidenceState | null = null;

  await db.transaction(
    'rw',
    db.currentVideoTranscriptSources,
    db.currentVideoTranscriptSegments,
    async () => {
      const [sources, segments] = await Promise.all([
        db.currentVideoTranscriptSources
          .where('bvid')
          .equals(evidence.sourceRecord.bvid)
          .toArray(),
        db.currentVideoTranscriptSegments
          .where('bvid')
          .equals(evidence.sourceRecord.bvid)
          .toArray(),
      ]);
      const plan = planTranscriptEvidenceUpsert(sources, segments, evidence);

      await db.currentVideoTranscriptSources.bulkPut(plan.sourcesToPut);
      if (plan.segmentsToPut.length > 0) {
        await db.currentVideoTranscriptSegments.bulkPut(plan.segmentsToPut);
      }
      state = plan.state;
    },
  );

  if (!state) {
    throw new Error('TRANSCRIPT_CACHE_WRITE_FAILED');
  }
  return state;
}

export async function getCurrentVideoTranscriptEvidenceState(
  identity: CurrentVideoTranscriptIdentity,
  now = Date.now(),
): Promise<CurrentVideoTranscriptEvidenceState> {
  const [sources, segments] = await Promise.all([
    db.currentVideoTranscriptSources.where('bvid').equals(identity.bvid).toArray(),
    db.currentVideoTranscriptSegments.where('bvid').equals(identity.bvid).toArray(),
  ]);

  return buildTranscriptEvidenceStateFromCache(identity, sources, segments, now);
}
