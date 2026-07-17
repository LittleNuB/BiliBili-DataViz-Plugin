import type { FollowedVideoUpdate } from '../../shared/types/dynamic-bill.ts';

/** Newest first, with the immutable update key ascending as the final tie-break. */
export function compareFollowedVideoUpdatesNewestFirst(
  a: FollowedVideoUpdate,
  b: FollowedVideoUpdate,
): number {
  const dynamicTimeDelta = b.dynamicTime - a.dynamicTime;
  if (dynamicTimeDelta !== 0) return dynamicTimeDelta;

  const pubtimeDelta = b.pubtime - a.pubtime;
  if (pubtimeDelta !== 0) return pubtimeDelta;

  if (a.updateKey < b.updateKey) return -1;
  if (a.updateKey > b.updateKey) return 1;
  return 0;
}
