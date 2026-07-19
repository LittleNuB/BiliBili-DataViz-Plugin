import type { CurrentVideoContextResult } from '../shared/types/current-video-context.ts';
import {
  retainTemporaryCurrentVideoTranscriptOwner,
  type CurrentVideoTemporaryTranscriptOwner,
} from './current-video-temporary-transcript-cache.ts';

export function retainTemporaryTranscriptOwnerForContextSnapshot(
  context: CurrentVideoContextResult,
  ownerTabId: number | null,
): CurrentVideoTemporaryTranscriptOwner | undefined {
  if (context.kind !== 'video' || !context.cid) return undefined;
  if (!ownerTabId || ownerTabId <= 0) return undefined;
  return retainTemporaryCurrentVideoTranscriptOwner({
    ownerTabId,
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
  }) ?? undefined;
}
