import { MAX_FAVORITE_SYNC_PAGES } from '../../shared/constants';
import type { FavoriteItem, FavoriteSyncResult } from '../../shared/types/favorite';
import type { VideoInfo } from '../../shared/types/video-info';
import { fetchFavoriteFolders, fetchFavoriteItems } from '../api/favorites';
import { batchFetchVideoInfo } from '../api/video-info';
import { countFavoriteFolders, countFavoriteItems, replaceFavoriteSnapshot } from '../storage/favorite-repo';
import { resolveBiliRegion } from './taxonomy';

export async function syncFavorites(): Promise<FavoriteSyncResult> {
  const [previousFolderCount, previousItemCount] = await Promise.all([
    countFavoriteFolders(),
    countFavoriteItems(),
  ]);
  const folders = await fetchFavoriteFolders();
  const allItems: FavoriteItem[] = [];

  if (folders.length === 0 && (previousFolderCount > 0 || previousItemCount > 0)) {
    throw new Error('FAVORITE_SYNC_EMPTY_SNAPSHOT');
  }

  for (const folder of folders) {
    const folderItems = await fetchFavoriteItems(folder, undefined, MAX_FAVORITE_SYNC_PAGES);
    allItems.push(...folderItems);
  }

  const reportedItemCount = folders.reduce((sum, folder) => sum + Math.max(folder.mediaCount, 0), 0);
  if (allItems.length === 0 && reportedItemCount > 0 && previousItemCount > 0) {
    throw new Error('FAVORITE_SYNC_EMPTY_ITEMS_SNAPSHOT');
  }

  const enrichedItems = await enrichFavoriteItems(allItems);
  const insertedOrUpdated = await replaceFavoriteSnapshot(folders, enrichedItems);

  return {
    folders: folders.length,
    items: enrichedItems.length,
    uniqueItems: countUniqueFavoriteVideos(enrichedItems),
    insertedOrUpdated,
    syncedAt: Date.now(),
  };
}

function countUniqueFavoriteVideos(items: FavoriteItem[]): number {
  return new Set(items.map(getFavoriteVideoKey)).size;
}

function getFavoriteVideoKey(item: FavoriteItem): string {
  if (item.bvid) return `bvid:${item.bvid}`;
  if (item.avid) return `avid:${item.avid}`;
  return item.itemKey;
}

async function enrichFavoriteItems(items: FavoriteItem[]): Promise<FavoriteItem[]> {
  const bvids = items.map(item => item.bvid).filter(Boolean);
  if (bvids.length === 0) return items;

  const videoInfoMap = await batchFetchVideoInfo(bvids);
  return items.map(item => mergeFavoriteVideoInfo(item, videoInfoMap.get(item.bvid)));
}

function mergeFavoriteVideoInfo(item: FavoriteItem, info: VideoInfo | undefined): FavoriteItem {
  if (!info) return item;
  const region = resolveBiliRegion({
    tid: info.tid ?? item.tid,
    tname: info.tname || item.tname || item.tagName,
    tidV2: info.tid_v2 ?? item.tidV2,
    tnameV2: info.tname_v2 || item.tnameV2,
    pidV2: item.pidV2,
    pidNameV2: item.pidNameV2,
  });

  return {
    ...item,
    avid: item.avid || info.avid || 0,
    bvid: item.bvid || info.bvid || '',
    title: item.title || info.title || '',
    authorName: item.authorName || info.owner?.name || '',
    authorMid: item.authorMid || Number(info.owner?.mid ?? 0),
    tid: region.tid,
    tname: region.tname,
    tidV2: region.tidV2,
    tnameV2: region.tnameV2,
    pidV2: region.pidV2,
    pidNameV2: region.pidNameV2,
    tagName: region.tname || info.tname || item.tagName,
    tags: Array.isArray(info.tags) && info.tags.length > 0 ? info.tags : item.tags,
    cover: item.cover || info.pic || '',
    duration: item.duration || Number(info.duration ?? 0),
  };
}
