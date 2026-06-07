import type { FavoriteFolder, FavoriteFolderSyncDiagnostic, FavoriteItem } from '../../shared/types/favorite';

export interface FavoriteResourceApiItem {
  id?: number;
  avid?: number;
  bvid?: string;
  title?: string;
  cover?: string;
  intro?: string;
  duration?: number;
  pubtime?: number;
  fav_time?: number;
  ctime?: number;
  type?: number;
  upper?: {
    mid?: number;
    name?: string;
  };
  attr?: number;
  state?: number;
  cnt_info?: unknown;
}

export interface FavoriteResourcesData {
  info?: {
    id?: number;
    title?: string;
  };
  medias?: FavoriteResourceApiItem[];
  has_more?: boolean;
}

export interface FavoriteItemsFetchResult {
  items: FavoriteItem[];
  diagnostic: FavoriteFolderSyncDiagnostic;
}

export type FavoriteResourcePageFetcher = (pageNumber: number, signal?: AbortSignal) => Promise<FavoriteResourcesData>;

export async function fetchFavoriteItemsWithPageFetcher(
  folder: FavoriteFolder,
  fetchPage: FavoriteResourcePageFetcher,
  signal: AbortSignal | undefined,
  maxPages: number,
  pageSize: number,
): Promise<FavoriteItemsFetchResult> {
  const result: FavoriteItem[] = [];
  const syncedAt = Date.now();
  const diagnostic: FavoriteFolderSyncDiagnostic = {
    mediaId: folder.mediaId,
    title: folder.title,
    reportedMediaCount: Math.max(0, Number(folder.mediaCount ?? 0)),
    pagesFetched: 0,
    rawResourcesSeen: 0,
    storedVideoItems: 0,
    filteredUnavailableItems: 0,
    filteredMissingIdItems: 0,
    filteredNonVideoItems: 0,
    filteredItems: 0,
    hasMoreAfterStop: false,
    stoppedByMaxPages: false,
    unexplainedDelta: 0,
    errors: [],
  };

  for (let pn = 1; pn <= maxPages; pn++) {
    let data: FavoriteResourcesData;
    try {
      data = await fetchPage(pn, signal);
    } catch (error) {
      diagnostic.errors.push(`page ${pn}: ${error instanceof Error ? error.message : String(error)}`);
      diagnostic.hasMoreAfterStop = true;
      break;
    }

    const medias = data.medias ?? [];
    diagnostic.pagesFetched++;
    diagnostic.rawResourcesSeen += medias.length;
    if (medias.length === 0) break;

    for (const media of medias) {
      const parsed = toFavoriteItem(media, folder, syncedAt);
      if (parsed.item) {
        result.push(parsed.item);
      } else {
        if (parsed.reason === 'unavailable') diagnostic.filteredUnavailableItems++;
        if (parsed.reason === 'missing-id') diagnostic.filteredMissingIdItems++;
        if (parsed.reason === 'non-video') diagnostic.filteredNonVideoItems++;
      }
    }

    if (data.has_more === false) break;
    if (medias.length < pageSize) {
      if (data.has_more === true) {
        diagnostic.hasMoreAfterStop = true;
        diagnostic.errors.push(`page ${pn}: has_more=true but returned ${medias.length}/${pageSize} resources`);
      }
      break;
    }
    if (pn === maxPages && data.has_more === true) {
      diagnostic.hasMoreAfterStop = true;
      diagnostic.stoppedByMaxPages = true;
      diagnostic.errors.push(`reached max page limit ${maxPages} while has_more=true`);
    }
  }

  diagnostic.storedVideoItems = result.length;
  diagnostic.filteredItems = diagnostic.filteredUnavailableItems + diagnostic.filteredMissingIdItems + diagnostic.filteredNonVideoItems;
  diagnostic.unexplainedDelta = Math.max(
    0,
    diagnostic.reportedMediaCount - diagnostic.storedVideoItems - diagnostic.filteredItems,
  );

  return { items: result, diagnostic };
}

function toFavoriteItem(
  item: FavoriteResourceApiItem,
  folder: FavoriteFolder,
  syncedAt: number,
): { item: FavoriteItem | null; reason?: 'unavailable' | 'missing-id' | 'non-video' } {
  if (isUnavailableFavoriteResource(item)) return { item: null, reason: 'unavailable' };
  if (item.type !== undefined && Number(item.type) !== 2) return { item: null, reason: 'non-video' };

  const avid = Number(item.id ?? item.avid ?? 0);
  const bvid = item.bvid ?? '';
  if (!avid && !bvid) return { item: null, reason: 'missing-id' };

  const itemKey = `${folder.mediaId}:${bvid || avid}`;
  return {
    item: {
      itemKey,
      mediaId: folder.mediaId,
      folderTitle: folder.title,
      avid,
      bvid,
      title: item.title ?? '',
      intro: item.intro ?? '',
      authorName: item.upper?.name ?? '',
      authorMid: Number(item.upper?.mid ?? 0),
      tagName: '',
      tags: [],
      cover: item.cover ?? '',
      duration: Number(item.duration ?? 0),
      pubtime: Number(item.pubtime ?? 0),
      favTime: Number(item.fav_time ?? item.ctime ?? 0),
      syncedAt,
    },
  };
}

function isUnavailableFavoriteResource(item: FavoriteResourceApiItem): boolean {
  const title = (item.title ?? '').trim();
  return item.attr === 1
    || item.state === -1
    || title === '已失效视频'
    || title === '视频已失效'
    || title === '稿件已失效'
    || title === '已删除视频';
}
