import { FAVORITE_FOLDERS_ENDPOINT, FAVORITE_PAGE_SIZE, FAVORITE_RESOURCES_ENDPOINT, NAV_ENDPOINT } from '../../shared/constants';
import type { FavoriteFolder, FavoriteItem } from '../../shared/types/favorite';
import { biliGet } from './client';

interface NavData {
  mid: number;
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

interface FavoriteResourceApiItem {
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
}

interface FavoriteResourcesData {
  info?: {
    id?: number;
    title?: string;
  };
  medias?: FavoriteResourceApiItem[];
  has_more?: boolean;
}

export async function fetchCurrentUserMid(signal?: AbortSignal): Promise<number> {
  const nav = await biliGet<NavData>(NAV_ENDPOINT, undefined, 3, false, signal);
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
): Promise<FavoriteItem[]> {
  const result: FavoriteItem[] = [];
  const syncedAt = Date.now();

  for (let pn = 1; pn <= maxPages; pn++) {
    const data = await biliGet<FavoriteResourcesData>(
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
      signal,
    );

    const medias = data.medias ?? [];
    if (medias.length === 0) break;

    for (const media of medias) {
      const item = toFavoriteItem(media, folder, syncedAt);
      if (item) result.push(item);
    }

    if (data.has_more === false || medias.length < FAVORITE_PAGE_SIZE) break;
  }

  return result;
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

function toFavoriteItem(item: FavoriteResourceApiItem, folder: FavoriteFolder, syncedAt: number): FavoriteItem | null {
  const avid = Number(item.id ?? item.avid ?? 0);
  const bvid = item.bvid ?? '';
  if (!avid && !bvid) return null;

  const itemKey = `${folder.mediaId}:${bvid || avid}`;
  return {
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
  };
}

