import type { FavoriteFolder, FavoriteItem, SmartFavoriteIndex } from '../../shared/types/favorite';
import { db } from './db';

export async function replaceFavoriteSnapshot(folders: FavoriteFolder[], items: FavoriteItem[]): Promise<number> {
  const normalizedFolders = dedupeBy(folders, folder => String(folder.mediaId));
  const normalizedItems = dedupeBy(items, item => item.itemKey);
  const folderMediaIds = new Set(normalizedFolders.map(folder => folder.mediaId));
  const itemKeys = new Set(normalizedItems.map(item => item.itemKey));

  await db.transaction('rw', db.favoriteFolders, db.favoriteItems, db.smartFavoriteIndex, async () => {
    if (normalizedFolders.length > 0) {
      await db.favoriteFolders.bulkPut(await withExistingFolderIds(normalizedFolders));
    }
    if (normalizedItems.length > 0) {
      await db.favoriteItems.bulkPut(await withExistingItemIds(normalizedItems));
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

  return normalizedItems.length;
}

export async function upsertFavoriteFolders(folders: FavoriteFolder[]): Promise<void> {
  if (folders.length === 0) return;
  await db.favoriteFolders.bulkPut(await withExistingFolderIds(dedupeBy(folders, folder => String(folder.mediaId))));
}

export async function upsertFavoriteItems(items: FavoriteItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const normalizedItems = dedupeBy(items, item => item.itemKey);
  await db.favoriteItems.bulkPut(await withExistingItemIds(normalizedItems));
  return normalizedItems.length;
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
  const existing = await db.smartFavoriteIndex.where('itemKey').equals(index.itemKey).first();
  await db.smartFavoriteIndex.put({
    ...index,
    id: index.id ?? existing?.id,
  });
}

export async function countIndexedFavorites(): Promise<number> {
  return db.smartFavoriteIndex.where({ status: 'indexed' }).count();
}

async function withExistingFolderIds(folders: FavoriteFolder[]): Promise<FavoriteFolder[]> {
  const existing = await db.favoriteFolders
    .where('mediaId')
    .anyOf(folders.map(folder => folder.mediaId))
    .toArray();
  const existingIds = new Map(existing.map(folder => [folder.mediaId, folder.id]));
  return folders.map(folder => ({ ...folder, id: folder.id ?? existingIds.get(folder.mediaId) }));
}

async function withExistingItemIds(items: FavoriteItem[]): Promise<FavoriteItem[]> {
  const existing = await db.favoriteItems
    .where('itemKey')
    .anyOf(items.map(item => item.itemKey))
    .toArray();
  const existingIds = new Map(existing.map(item => [item.itemKey, item.id]));
  return items.map(item => ({ ...item, id: item.id ?? existingIds.get(item.itemKey) }));
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  return Array.from(new Map(items.map(item => [getKey(item), item])).values());
}
