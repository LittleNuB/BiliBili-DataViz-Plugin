export function buildWatchSessionKey(kid: number | undefined, viewAt: number, bvid = '', cid = 0): string {
  if (kid !== undefined && kid !== 0) return `${kid}:${viewAt}`;
  return `${bvid}:${cid}:${viewAt}`;
}
