import type { FavoriteFolder, FavoriteFolderSyncDiagnostic, FavoriteItem, SmartFavoriteIndex } from '../../shared/types/favorite';
import { db } from './db';

export async function replaceFavoriteSnapshot(folders: FavoriteFolder[], items: FavoriteItem[]): Promise<number> {
  const folderMediaIds = new Set(folders.map(folder => folder.mediaId));
  const itemKeys = new Set(items.map(item => item.itemKey));

  await db.transaction('rw', db.favoriteFolders, db.favoriteItems, db.smartFavoriteIndex, async () => {
    if (folders.length > 0) {
      await db.favoriteFolders.bulkPut(folders);
    }
    if (items.length > 0) {
      await db.favoriteItems.bulkPut(items);
    }

    await db.favoriteFolders
      .filter(folder => !folderMediaIds.has(folder.mediaId))
      .delete();

    await db.favoriteItems
      .filter(item => !folderMediaIds.has(item.mediaId) || !itemKeys.has(item.itemKey))
      .delete();

    await db.smartFavoriteIndex
      .filter(index => !itemKeys.has(index.itemKey))
      .delete();
  });

  return items.length;
}

export async function upsertFavoriteFolders(folders: FavoriteFolder[]): Promise<void> {
  if (folders.length === 0) return;
  await db.favoriteFolders.bulkPut(folders);
}

export async function updateFavoriteFolderSyncDiagnostics(
  folders: FavoriteFolder[],
  diagnostics: FavoriteFolderSyncDiagnostic[],
): Promise<void> {
  if (folders.length === 0) return;

  const diagnosticByMediaId = new Map(diagnostics.map(diagnostic => [diagnostic.mediaId, diagnostic]));
  const existingFolders = await db.favoriteFolders.toArray();
  const existingByMediaId = new Map(existingFolders.map(folder => [folder.mediaId, folder]));
  const merged = folders.map(folder => ({
    ...(existingByMediaId.get(folder.mediaId) ?? folder),
    ...folder,
    lastSyncDiagnostic: diagnosticByMediaId.get(folder.mediaId),
  }));

  await db.favoriteFolders.bulkPut(merged);
}

export async function upsertFavoriteItems(items: FavoriteItem[]): Promise<number> {
  if (items.length === 0) return 0;
  await db.favoriteItems.bulkPut(items);
  return items.length;
}

export async function getFavoriteFolders(): Promise<FavoriteFolder[]> {
  return db.favoriteFolders.orderBy('mediaId').toArray();
}

export async function getFavoriteItems(): Promise<FavoriteItem[]> {
  return db.favoriteItems.orderBy('favTime').reverse().toArray();
}

export async function countFavoriteFolders(): Promise<number> {
  return db.favoriteFolders.count();
}

export async function countFavoriteItems(): Promise<number> {
  return db.favoriteItems.count();
}

export async function getFavoriteItemByKey(itemKey: string): Promise<FavoriteItem | undefined> {
  return db.favoriteItems.where({ itemKey }).first();
}

export async function getSmartFavoriteIndexes(): Promise<SmartFavoriteIndex[]> {
  return db.smartFavoriteIndex.toArray();
}

export async function getSmartFavoriteIndexMap(): Promise<Map<string, SmartFavoriteIndex>> {
  const indexes = await getSmartFavoriteIndexes();
  return new Map(indexes.map(index => [index.itemKey, index]));
}

export async function putSmartFavoriteIndex(index: SmartFavoriteIndex): Promise<void> {
  await db.smartFavoriteIndex.put(index);
}

export async function countIndexedFavorites(): Promise<number> {
  return db.smartFavoriteIndex.where({ status: 'indexed' }).count();
}
