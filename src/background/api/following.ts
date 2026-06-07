import { FOLLOWING_PAGE_SIZE, FOLLOWINGS_ENDPOINT, MAX_FOLLOWING_SYNC_PAGES } from '../../shared/constants';
import type { FollowedCreator } from '../../shared/types/dynamic-bill';
import { biliGet } from './client';
import { fetchCurrentUserMid } from './favorites';

interface FollowingApiItem {
  mid?: number;
  uname?: string;
  name?: string;
  face?: string;
  sign?: string;
  mtime?: number | string;
  special?: number | boolean;
  attribute?: number;
  tagid?: number;
  tag?: number;
}

interface FollowingsData {
  list?: FollowingApiItem[];
  total?: number;
}

export interface FollowingFetchResult {
  creators: FollowedCreator[];
  pagesFetched: number;
  reportedTotal: number;
  followAgeKnownCount: number;
  followAgeUnknownCount: number;
  syncedAt: number;
}

export async function fetchFollowingCreators(options: {
  maxPages?: number;
  pageSize?: number;
  signal?: AbortSignal;
} = {}): Promise<FollowingFetchResult> {
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? MAX_FOLLOWING_SYNC_PAGES));
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? FOLLOWING_PAGE_SIZE));
  const syncedAt = Date.now();
  const mid = await fetchCurrentUserMid(options.signal);
  const creators: FollowedCreator[] = [];
  let pagesFetched = 0;
  let reportedTotal = 0;

  for (let pn = 1; pn <= maxPages; pn++) {
    const data = await biliGet<FollowingsData>(
      FOLLOWINGS_ENDPOINT,
      {
        vmid: String(mid),
        pn: String(pn),
        ps: String(pageSize),
        order: 'desc',
        order_type: 'attention',
      },
      3,
      false,
      options.signal,
    );

    pagesFetched++;
    reportedTotal = Number(data.total ?? reportedTotal ?? 0);
    const list = Array.isArray(data.list) ? data.list : [];
    if (list.length === 0) break;

    for (const item of list) {
      const creator = toFollowedCreator(item, syncedAt);
      if (creator) creators.push(creator);
    }

    if ((reportedTotal > 0 && creators.length >= reportedTotal) || list.length < pageSize) {
      break;
    }
  }

  const followAgeKnownCount = creators.filter(creator => creator.followAgeKnown).length;

  return {
    creators,
    pagesFetched,
    reportedTotal,
    followAgeKnownCount,
    followAgeUnknownCount: creators.length - followAgeKnownCount,
    syncedAt,
  };
}

function toFollowedCreator(item: FollowingApiItem, syncedAt: number): FollowedCreator | null {
  const mid = Number(item.mid ?? 0);
  if (!Number.isFinite(mid) || mid <= 0) return null;

  const followedAt = normalizeFollowedAt(item.mtime);

  return {
    mid,
    name: String(item.uname ?? item.name ?? ''),
    face: String(item.face ?? ''),
    sign: String(item.sign ?? ''),
    followedAt,
    followAgeKnown: followedAt !== undefined,
    special: item.special === true || Number(item.special ?? 0) > 0,
    attribute: Number(item.attribute ?? 0),
    tagId: Number(item.tagid ?? item.tag ?? 0),
    isActive: true,
    syncedAt,
    lastSeenAt: syncedAt,
  };
}

function normalizeFollowedAt(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const asSeconds = numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  if (asSeconds <= 0 || asSeconds > nowSeconds + 86_400) return undefined;
  return asSeconds;
}
