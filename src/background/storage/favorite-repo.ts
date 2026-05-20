import type { FavoriteFolder, FavoriteItem, SmartFavoriteIndex } from '../../shared/types/favorite';
import { db } from './db';

export async function upsertFavoriteFolders(folders: FavoriteFolder[]): Promise<void> {
  if (folders.length === 0) return;
  await db.favoriteFolders.bulkPut(folders);
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

