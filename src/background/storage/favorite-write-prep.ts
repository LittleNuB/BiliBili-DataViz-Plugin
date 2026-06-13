import type {
  FavoriteFolder,
  FavoriteItem,
  SmartFavoriteIndex,
} from '../../shared/types/favorite.ts';

export interface PreparedRows<T> {
  rows: T[];
  notes: string[];
}

export function prepareFavoriteFolderRows(folders: FavoriteFolder[]): PreparedRows<FavoriteFolder> {
  const byMediaId = new Map<number, FavoriteFolder>();
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const folder of folders) {
    const mediaId = Number(folder.mediaId ?? 0);
    if (!Number.isFinite(mediaId) || mediaId <= 0) {
      invalidCount++;
      continue;
    }

    const current = byMediaId.get(mediaId);
    if (current) duplicateCount++;
    byMediaId.set(mediaId, mergeFavoriteFolder(current, folder));
  }

  return {
    rows: Array.from(byMediaId.values()),
    notes: buildNotes(
      invalidCount,
      '收藏夹同步时跳过了 {count} 条缺少 mediaId 的异常收藏夹记录。',
      duplicateCount,
      '收藏夹同步时发现 {count} 个重复收藏夹，已按最新结果覆盖。',
    ),
  };
}

export function prepareFavoriteItemRows(items: FavoriteItem[]): PreparedRows<FavoriteItem> {
  const byItemKey = new Map<string, FavoriteItem>();
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const item of items) {
    const itemKey = normalizeItemKey(item.itemKey);
    if (!itemKey) {
      invalidCount++;
      continue;
    }

    const current = byItemKey.get(itemKey);
    if (current) duplicateCount++;
    byItemKey.set(itemKey, mergeFavoriteItem(current, { ...item, itemKey }));
  }

  return {
    rows: Array.from(byItemKey.values()),
    notes: buildNotes(
      invalidCount,
      '收藏同步时跳过了 {count} 条缺少 itemKey 的异常视频记录。',
      duplicateCount,
      '收藏同步时发现 {count} 条重复收藏视频，已按最新记录覆盖。',
    ),
  };
}

export function prepareSmartFavoriteIndexRows(indexes: SmartFavoriteIndex[]): PreparedRows<SmartFavoriteIndex> {
  const byItemKey = new Map<string, SmartFavoriteIndex>();
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const index of indexes) {
    const itemKey = normalizeItemKey(index.itemKey);
    if (!itemKey) {
      invalidCount++;
      continue;
    }

    const current = byItemKey.get(itemKey);
    if (current) duplicateCount++;
    byItemKey.set(itemKey, mergeSmartFavoriteIndex(current, { ...index, itemKey }));
  }

  return {
    rows: Array.from(byItemKey.values()),
    notes: buildNotes(
      invalidCount,
      '智能索引写入时跳过了 {count} 条缺少 itemKey 的异常索引记录。',
      duplicateCount,
      '智能索引写入时发现 {count} 条重复 itemKey，已按最新结果覆盖。',
    ),
  };
}

function mergeFavoriteFolder(current: FavoriteFolder | undefined, next: FavoriteFolder): FavoriteFolder {
  if (!current) return next;
  return {
    ...current,
    ...next,
    title: next.title || current.title,
    cover: next.cover || current.cover,
    intro: next.intro || current.intro,
    mediaCount: Math.max(current.mediaCount, next.mediaCount),
    createdAt: pickPositive(current.createdAt, next.createdAt),
    updatedAt: Math.max(current.updatedAt, next.updatedAt),
    syncedAt: Math.max(current.syncedAt, next.syncedAt),
    lastSyncDiagnostic: next.lastSyncDiagnostic ?? current.lastSyncDiagnostic,
  };
}

function mergeFavoriteItem(current: FavoriteItem | undefined, next: FavoriteItem): FavoriteItem {
  if (!current) return next;
  return {
    ...current,
    ...next,
    folderTitle: next.folderTitle || current.folderTitle,
    avid: pickPositive(current.avid, next.avid),
    bvid: next.bvid || current.bvid,
    title: next.title || current.title,
    intro: preferLongerText(current.intro, next.intro),
    authorName: next.authorName || current.authorName,
    authorMid: pickPositive(current.authorMid, next.authorMid),
    tagName: next.tagName || current.tagName,
    tags: next.tags.length > 0 ? next.tags : current.tags,
    cover: next.cover || current.cover,
    duration: Math.max(current.duration, next.duration),
    pubtime: Math.max(current.pubtime, next.pubtime),
    favTime: Math.max(current.favTime, next.favTime),
    syncedAt: Math.max(current.syncedAt, next.syncedAt),
  };
}

function mergeSmartFavoriteIndex(current: SmartFavoriteIndex | undefined, next: SmartFavoriteIndex): SmartFavoriteIndex {
  if (!current) return next;
  return {
    ...current,
    ...next,
    path: next.path.length > 0 ? next.path : current.path,
    summary: next.summary || current.summary,
    keywords: next.keywords.length > 0 ? next.keywords : current.keywords,
    aliases: next.aliases.length > 0 ? next.aliases : current.aliases,
    searchableText: next.searchableText || current.searchableText,
    contentHash: next.contentHash || current.contentHash,
    model: next.model || current.model,
    error: next.error || current.error,
    indexedAt: Math.max(current.indexedAt, next.indexedAt),
  };
}

function buildNotes(
  invalidCount: number,
  invalidTemplate: string,
  duplicateCount: number,
  duplicateTemplate: string,
): string[] {
  const notes: string[] = [];
  if (invalidCount > 0) {
    notes.push(invalidTemplate.replace('{count}', String(invalidCount)));
  }
  if (duplicateCount > 0) {
    notes.push(duplicateTemplate.replace('{count}', String(duplicateCount)));
  }
  return notes;
}

function normalizeItemKey(itemKey: string | undefined): string {
  return typeof itemKey === 'string' ? itemKey.trim() : '';
}

function pickPositive(current: number, next: number): number {
  return next > 0 ? next : current;
}

function preferLongerText(current: string, next: string): string {
  return next.length >= current.length ? next : current;
}
