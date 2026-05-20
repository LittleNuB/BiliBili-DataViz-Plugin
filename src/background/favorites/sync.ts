import { MAX_FAVORITE_SYNC_PAGES } from '../../shared/constants';
import type { FavoriteSyncResult } from '../../shared/types/favorite';
import { fetchFavoriteFolders, fetchFavoriteItems } from '../api/favorites';
import { upsertFavoriteFolders, upsertFavoriteItems } from '../storage/favorite-repo';

export async function syncFavorites(): Promise<FavoriteSyncResult> {
  const folders = await fetchFavoriteFolders();
  await upsertFavoriteFolders(folders);

  let items = 0;
  let insertedOrUpdated = 0;
  for (const folder of folders) {
    const folderItems = await fetchFavoriteItems(folder, undefined, MAX_FAVORITE_SYNC_PAGES);
    items += folderItems.length;
    insertedOrUpdated += await upsertFavoriteItems(folderItems);
  }

  return {
    folders: folders.length,
    items,
    insertedOrUpdated,
    syncedAt: Date.now(),
  };
}

