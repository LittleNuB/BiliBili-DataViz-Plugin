import { FAVORITE_FOLDERS_ENDPOINT, FAVORITE_PAGE_SIZE, FAVORITE_RESOURCES_ENDPOINT, NAV_ENDPOINT } from '../../shared/constants';
import type { FavoriteFolder } from '../../shared/types/favorite';
import {
  fetchFavoriteItemsWithPageFetcher,
  type FavoriteItemsFetchResult,
  type FavoriteResourcesData,
} from '../favorites/favorite-fetch-loop';
import { biliGet } from './client';

interface NavData {
  mid: number;
  isLogin?: boolean;
}

interface FavoriteFolderApiItem {
  id?: number;
  media_id?: number;
  fid?: number;
  title?: string;
  cover?: string;
  intro?: string;
  media_count?: number;
  ctime?: number;
  mtime?: number;
}

interface FavoriteFoldersData {
  count?: number;
  list?: FavoriteFolderApiItem[];
}

export async function fetchCurrentUserMid(signal?: AbortSignal): Promise<number> {
  const nav = await biliGet<NavData>(NAV_ENDPOINT, undefined, 3, false, signal);
  if (nav.isLogin === false || !nav.mid) {
    throw new Error('NOT_LOGGED_IN');
  }
  return nav.mid;
}

export async function fetchFavoriteFolders(signal?: AbortSignal): Promise<FavoriteFolder[]> {
  const mid = await fetchCurrentUserMid(signal);
  const data = await biliGet<FavoriteFoldersData>(
    FAVORITE_FOLDERS_ENDPOINT,
    { up_mid: String(mid) },
    3,
    false,
    signal,
  );
  const syncedAt = Date.now();
  return (data.list ?? [])
    .map(item => toFavoriteFolder(item, syncedAt))
    .filter((folder): folder is FavoriteFolder => folder !== null);
}

export async function fetchFavoriteItems(
  folder: FavoriteFolder,
  signal?: AbortSignal,
  maxPages = 500,
): Promise<FavoriteItemsFetchResult> {
  return fetchFavoriteItemsWithPageFetcher(
    folder,
    (pn, pageSignal) => biliGet<FavoriteResourcesData>(
      FAVORITE_RESOURCES_ENDPOINT,
      {
        media_id: String(folder.mediaId),
        pn: String(pn),
        ps: String(FAVORITE_PAGE_SIZE),
        keyword: '',
        order: 'mtime',
        type: '0',
        tid: '0',
        platform: 'web',
      },
      3,
      false,
      pageSignal,
    ),
    signal,
    maxPages,
    FAVORITE_PAGE_SIZE,
  );
}

function toFavoriteFolder(item: FavoriteFolderApiItem, syncedAt: number): FavoriteFolder | null {
  const mediaId = Number(item.id ?? item.media_id ?? item.fid ?? 0);
  if (!mediaId) return null;
  return {
    mediaId,
    title: item.title ?? '未命名收藏夹',
    cover: item.cover ?? '',
    intro: item.intro ?? '',
    mediaCount: Number(item.media_count ?? 0),
    createdAt: Number(item.ctime ?? 0),
    updatedAt: Number(item.mtime ?? 0),
    syncedAt,
  };
}
