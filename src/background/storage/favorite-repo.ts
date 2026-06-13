import type {
  FavoriteFolder,
  FavoriteFolderSyncDiagnostic,
  FavoriteItem,
  SmartFavoriteIndex,
} from '../../shared/types/favorite';
import { db } from './db.ts';
import {
  prepareFavoriteFolderRows,
  prepareFavoriteItemRows,
  prepareSmartFavoriteIndexRows,
} from './favorite-write-prep.ts';

export interface FavoriteRepoWriteResult {
  written: number;
  notes: string[];
}

export async function replaceFavoriteSnapshot(
  folders: FavoriteFolder[],
  items: FavoriteItem[],
): Promise<FavoriteRepoWriteResult> {
  const preparedFolders = prepareFavoriteFolderRows(folders);
  const preparedItems = prepareFavoriteItemRows(items);
  const folderMediaIds = new Set(preparedFolders.rows.map(folder => folder.mediaId));
  const itemKeys = new Set(preparedItems.rows.map(item => item.itemKey));

  await db.transaction('rw', db.favoriteFolders, db.favoriteItems, db.smartFavoriteIndex, async () => {
    const folderRows = await attachExistingFavoriteFolderIds(preparedFolders.rows);
    const itemRows = await attachExistingFavoriteItemIds(preparedItems.rows);

    if (folderRows.length > 0) {
      await db.favoriteFolders.bulkPut(folderRows);
    }
    if (itemRows.length > 0) {
      await db.favoriteItems.bulkPut(itemRows);
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

  return {
    written: preparedItems.rows.length,
    notes: [...preparedFolders.notes, ...preparedItems.notes],
  };
}

export async function upsertFavoriteFolders(folders: FavoriteFolder[]): Promise<FavoriteRepoWriteResult> {
  const prepared = prepareFavoriteFolderRows(folders);
  if (prepared.rows.length === 0) {
    return { written: 0, notes: prepared.notes };
  }

  const rows = await attachExistingFavoriteFolderIds(prepared.rows);
  await db.favoriteFolders.bulkPut(rows);
  return { written: rows.length, notes: prepared.notes };
}

export async function updateFavoriteFolderSyncDiagnostics(
  folders: FavoriteFolder[],
  diagnostics: FavoriteFolderSyncDiagnostic[],
): Promise<FavoriteRepoWriteResult> {
  if (folders.length === 0) return { written: 0, notes: [] };

  const diagnosticByMediaId = new Map(diagnostics.map(diagnostic => [diagnostic.mediaId, diagnostic]));
  const existingFolders = await db.favoriteFolders.toArray();
  const existingByMediaId = new Map(existingFolders.map(folder => [folder.mediaId, folder]));
  const merged = folders.map(folder => ({
    ...(existingByMediaId.get(folder.mediaId) ?? folder),
    ...folder,
    lastSyncDiagnostic: diagnosticByMediaId.get(folder.mediaId),
  }));

  return await upsertFavoriteFolders(merged);
}

export async function upsertFavoriteItems(items: FavoriteItem[]): Promise<FavoriteRepoWriteResult> {
  const prepared = prepareFavoriteItemRows(items);
  if (prepared.rows.length === 0) {
    return { written: 0, notes: prepared.notes };
  }

  const rows = await attachExistingFavoriteItemIds(prepared.rows);
  await db.favoriteItems.bulkPut(rows);
  return { written: rows.length, notes: prepared.notes };
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

export async function putSmartFavoriteIndex(index: SmartFavoriteIndex): Promise<FavoriteRepoWriteResult> {
  const prepared = prepareSmartFavoriteIndexRows([index]);
  if (prepared.rows.length === 0) {
    return { written: 0, notes: prepared.notes };
  }

  const [row] = await attachExistingSmartFavoriteIndexIds(prepared.rows);
  await db.smartFavoriteIndex.put(row);
  return { written: 1, notes: prepared.notes };
}

export async function countIndexedFavorites(): Promise<number> {
  return db.smartFavoriteIndex.where({ status: 'indexed' }).count();
}

async function attachExistingFavoriteFolderIds(folders: FavoriteFolder[]): Promise<FavoriteFolder[]> {
  if (folders.length === 0) return [];
  const mediaIds = folders.map(folder => folder.mediaId);
  const existing = await db.favoriteFolders.where('mediaId').anyOf(mediaIds).toArray();
  const existingByMediaId = new Map(existing.map(folder => [folder.mediaId, folder.id]));
  return folders.map(folder => {
    const id = existingByMediaId.get(folder.mediaId);
    return typeof id === 'number' ? { ...folder, id } : folder;
  });
}

async function attachExistingFavoriteItemIds(items: FavoriteItem[]): Promise<FavoriteItem[]> {
  if (items.length === 0) return [];
  const itemKeys = items.map(item => item.itemKey);
  const existing = await db.favoriteItems.where('itemKey').anyOf(itemKeys).toArray();
  const existingByItemKey = new Map(existing.map(item => [item.itemKey, item.id]));
  return items.map(item => {
    const id = existingByItemKey.get(item.itemKey);
    return typeof id === 'number' ? { ...item, id } : item;
  });
}

async function attachExistingSmartFavoriteIndexIds(indexes: SmartFavoriteIndex[]): Promise<SmartFavoriteIndex[]> {
  if (indexes.length === 0) return [];
  const itemKeys = indexes.map(index => index.itemKey);
  const existing = await db.smartFavoriteIndex.where('itemKey').anyOf(itemKeys).toArray();
  const existingByItemKey = new Map(existing.map(index => [index.itemKey, index.id]));
  return indexes.map(index => {
    const id = existingByItemKey.get(index.itemKey);
    return typeof id === 'number' ? { ...index, id } : index;
  });
}
