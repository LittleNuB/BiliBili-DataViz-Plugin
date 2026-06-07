import { MAX_FAVORITE_SYNC_PAGES } from '../../shared/constants';
import type { FavoriteFolderSyncDiagnostic, FavoriteItem, FavoriteSyncResult } from '../../shared/types/favorite';
import type { VideoInfo } from '../../shared/types/video-info';
import { fetchFavoriteFolders, fetchFavoriteItems } from '../api/favorites';
import { batchFetchVideoInfo } from '../api/video-info';
import {
  countFavoriteFolders,
  countFavoriteItems,
  replaceFavoriteSnapshot,
  updateFavoriteFolderSyncDiagnostics,
} from '../storage/favorite-repo';
import { assessFavoriteSyncCompleteness, attachFavoriteSyncDiagnostics } from './sync-audit';

export async function syncFavorites(): Promise<FavoriteSyncResult> {
  const [previousFolderCount, previousItemCount] = await Promise.all([
    countFavoriteFolders(),
    countFavoriteItems(),
  ]);
  const folders = await fetchFavoriteFolders();
  const allItems: FavoriteItem[] = [];
  const diagnostics: FavoriteFolderSyncDiagnostic[] = [];
  const syncedAt = Date.now();

  if (folders.length === 0 && (previousFolderCount > 0 || previousItemCount > 0)) {
    throw new Error('FAVORITE_SYNC_EMPTY_SNAPSHOT');
  }

  for (const folder of folders) {
    const { items: folderItems, diagnostic } = await fetchFavoriteItems(folder, undefined, MAX_FAVORITE_SYNC_PAGES);
    allItems.push(...folderItems);
    diagnostics.push(diagnostic);
  }

  const reportedItemCount = folders.reduce((sum, folder) => sum + Math.max(folder.mediaCount, 0), 0);
  if (allItems.length === 0 && reportedItemCount > 0 && previousItemCount > 0) {
    throw new Error('FAVORITE_SYNC_EMPTY_ITEMS_SNAPSHOT');
  }

  const assessment = assessFavoriteSyncCompleteness(diagnostics);
  if (!assessment.complete) {
    await updateFavoriteFolderSyncDiagnostics(folders, diagnostics);
    return {
      status: 'blocked',
      folders: folders.length,
      items: allItems.length,
      insertedOrUpdated: 0,
      reportedItems: reportedItemCount,
      filteredItems: diagnostics.reduce((sum, diagnostic) => sum + diagnostic.filteredItems, 0),
      blockedReason: assessment.reason,
      diagnostics,
      syncedAt,
    };
  }

  const enrichedItems = await enrichFavoriteItems(allItems);
  const insertedOrUpdated = await replaceFavoriteSnapshot(
    attachFavoriteSyncDiagnostics(folders, diagnostics),
    enrichedItems,
  );

  return {
    status: 'complete',
    folders: folders.length,
    items: enrichedItems.length,
    insertedOrUpdated,
    reportedItems: reportedItemCount,
    filteredItems: diagnostics.reduce((sum, diagnostic) => sum + diagnostic.filteredItems, 0),
    diagnostics,
    syncedAt,
  };
}

async function enrichFavoriteItems(items: FavoriteItem[]): Promise<FavoriteItem[]> {
  const bvids = items.map(item => item.bvid).filter(Boolean);
  if (bvids.length === 0) return items;

  const videoInfoMap = await batchFetchVideoInfo(bvids);
  return items.map(item => mergeFavoriteVideoInfo(item, videoInfoMap.get(item.bvid)));
}

function mergeFavoriteVideoInfo(item: FavoriteItem, info: VideoInfo | undefined): FavoriteItem {
  if (!info) return item;

  return {
    ...item,
    avid: item.avid || info.avid || 0,
    bvid: item.bvid || info.bvid || '',
    title: item.title || info.title || '',
    authorName: item.authorName || info.owner?.name || '',
    authorMid: item.authorMid || Number(info.owner?.mid ?? 0),
    tagName: info.tname || item.tagName,
    tags: Array.isArray(info.tags) && info.tags.length > 0 ? info.tags : item.tags,
    cover: item.cover || info.pic || '',
    duration: item.duration || Number(info.duration ?? 0),
  };
}
