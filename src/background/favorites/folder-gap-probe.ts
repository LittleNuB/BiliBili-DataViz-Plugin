import type { FavoriteFolderGapProbeResult } from '../../shared/types/favorite';
import { fetchFavoriteFolders, fetchFavoriteItems } from '../api/favorites.ts';
import { getFavoriteItems, getSmartFavoriteIndexMap } from '../storage/favorite-repo.ts';
import { buildFavoriteFolderGapReport } from './folder-gap-probe-report.ts';

const DEFAULT_PROBE_MAX_PAGES = 12;
const MAX_PROBE_PAGES = 50;

export async function probeFavoriteFolderGap(
  mediaId: number,
  maxPages = DEFAULT_PROBE_MAX_PAGES,
): Promise<FavoriteFolderGapProbeResult> {
  const normalizedMediaId = Math.max(1, Math.floor(mediaId));
  if (!Number.isFinite(normalizedMediaId)) {
    throw new Error('INVALID_FAVORITE_MEDIA_ID');
  }

  const folders = await fetchFavoriteFolders();
  const folder = folders.find(candidate => candidate.mediaId === normalizedMediaId);
  if (!folder) {
    throw new Error('FAVORITE_FOLDER_NOT_FOUND');
  }

  const boundedMaxPages = Math.max(1, Math.min(Math.floor(maxPages), MAX_PROBE_PAGES));
  const { items: probeItems, diagnostic } = await fetchFavoriteItems(folder, undefined, boundedMaxPages);
  const [localItems, indexMap] = await Promise.all([
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
  ]);

  return buildFavoriteFolderGapReport(
    folder,
    diagnostic,
    localItems.filter(item => item.mediaId === folder.mediaId),
    probeItems,
    indexMap,
  );
}

export { buildFavoriteFolderGapReport } from './folder-gap-probe-report.ts';
