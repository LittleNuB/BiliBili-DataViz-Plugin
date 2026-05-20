import { MAX_FAVORITE_SYNC_PAGES } from '../../shared/constants';
import type { FavoriteItem, FavoriteSyncResult } from '../../shared/types/favorite';
import { fetchFavoriteFolders, fetchFavoriteItems } from '../api/favorites';
import { replaceFavoriteSnapshot } from '../storage/favorite-repo';

export async function syncFavorites(): Promise<FavoriteSyncResult> {
  const folders = await fetchFavoriteFolders();
  const allItems: FavoriteItem[] = [];

  for (const folder of folders) {
    const folderItems = await fetchFavoriteItems(folder, undefined, MAX_FAVORITE_SYNC_PAGES);
    allItems.push(...folderItems);
  }

  const insertedOrUpdated = await replaceFavoriteSnapshot(folders, allItems);

  return {
    folders: folders.length,
    items: allItems.length,
    insertedOrUpdated,
    syncedAt: Date.now(),
  };
}
