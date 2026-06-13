import { FAVORITE_SHORT_PAGE_RETRY_LIMIT } from '../../shared/constants.ts';
import type {
  FavoriteFolder,
  FavoriteFolderSyncDiagnostic,
  FavoriteFolderSyncPageDiagnostic,
  FavoriteFolderSyncStopReason,
  FavoriteItem,
} from '../../shared/types/favorite';

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

interface FavoritePageFetchAttempt {
  resourceCount: number;
  hasMore: boolean;
}

interface FavoriteFetchedPage extends FavoriteResourcesData {
  attempts: number;
  attemptDiagnostics: FavoritePageFetchAttempt[];
  retryImprovedShortPage: boolean;
}

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
    pageSize,
    requestedPages: 0,
    pagesFetched: 0,
    rawResourcesSeen: 0,
    uniqueResourcesSeen: 0,
    duplicateResourceIds: 0,
    duplicateBvids: 0,
    storedVideoItems: 0,
    filteredUnavailableItems: 0,
    filteredMissingIdItems: 0,
    filteredNonVideoItems: 0,
    filteredItems: 0,
    pageErrors: 0,
    hasMoreAfterStop: false,
    stoppedByMaxPages: false,
    unexplainedDelta: 0,
    completenessState: 'complete',
    pageDiagnostics: [],
    errors: [],
  };
  const seenResourceIds = new Set<number>();
  const seenBvids = new Set<string>();
  const seenResourceKeys = new Set<string>();
  const seenItemKeys = new Set<string>();

  for (let pn = 1; pn <= maxPages; pn++) {
    const page = await fetchFavoritePageWithRetries(pn, fetchPage, signal, pageSize, diagnostic);
    if (!page) {
      if (!diagnostic.stopReason) {
        diagnostic.stopReason = diagnostic.errors.length > 0 ? 'request_error' : 'empty_page';
      }
      break;
    }

    const medias = page.medias ?? [];
    diagnostic.pagesFetched++;
    diagnostic.rawResourcesSeen += medias.length;

    const pageDiagnostic = buildPageDiagnostic(
      pn,
      page,
      pageSize,
      medias,
      folder,
      syncedAt,
      seenResourceIds,
      seenBvids,
      seenResourceKeys,
      seenItemKeys,
      result,
      diagnostic,
    );
    diagnostic.pageDiagnostics.push(pageDiagnostic);

    if (medias.length === 0) {
      if (page.has_more === true) {
        diagnostic.hasMoreAfterStop = true;
        markDiagnosticIncomplete(
          diagnostic,
          `page ${pn}: has_more=true but returned 0/${pageSize} resources after ${page.attempts} attempt(s)`,
          'empty_page_has_more',
        );
      } else {
        diagnostic.stopReason = diagnostic.stopReason ?? 'empty_page';
      }
      break;
    }

    if (page.has_more === false) {
      diagnostic.stopReason = diagnostic.stopReason ?? 'has_more_false';
      break;
    }

    if (medias.length < pageSize) {
      diagnostic.hasMoreAfterStop = true;
      markDiagnosticIncomplete(
        diagnostic,
        `page ${pn}: has_more=true but returned ${medias.length}/${pageSize} resources after ${page.attempts} attempt(s)`,
      );
    }

    if (pn === maxPages && page.has_more === true) {
      diagnostic.hasMoreAfterStop = true;
      diagnostic.stoppedByMaxPages = true;
      markDiagnosticIncomplete(
        diagnostic,
        `reached max page limit ${maxPages} while has_more=true`,
        'max_pages_reached',
      );
      break;
    }
  }

  diagnostic.storedVideoItems = result.length;
  diagnostic.filteredItems = diagnostic.filteredUnavailableItems + diagnostic.filteredMissingIdItems + diagnostic.filteredNonVideoItems;
  diagnostic.pageErrors = diagnostic.errors.length;
  diagnostic.unexplainedDelta = Math.max(0, diagnostic.reportedMediaCount - diagnostic.uniqueResourcesSeen);
  if (diagnostic.pageErrors > 0 || diagnostic.hasMoreAfterStop || diagnostic.stoppedByMaxPages || diagnostic.unexplainedDelta > 0) {
    diagnostic.completenessState = 'incomplete';
  }
  if (!diagnostic.stopReason) {
    diagnostic.stopReason = diagnostic.hasMoreAfterStop || diagnostic.stoppedByMaxPages
      ? 'probe_limit_reached'
      : 'has_more_false';
  }

  return { items: result, diagnostic };
}

function buildPageDiagnostic(
  pageNumber: number,
  page: FavoriteFetchedPage,
  pageSize: number,
  medias: FavoriteResourceApiItem[],
  folder: FavoriteFolder,
  syncedAt: number,
  seenResourceIds: Set<number>,
  seenBvids: Set<string>,
  seenResourceKeys: Set<string>,
  seenItemKeys: Set<string>,
  result: FavoriteItem[],
  diagnostic: FavoriteFolderSyncDiagnostic,
): FavoriteFolderSyncPageDiagnostic {
  let duplicateResourceIds = 0;
  let duplicateBvids = 0;
  let storedVideoItems = 0;
  let filteredUnavailableItems = 0;
  let filteredMissingIdItems = 0;
  let filteredNonVideoItems = 0;
  let uniqueResourcesSeen = 0;

  for (const media of medias) {
    const resourceId = Number(media.id ?? media.avid ?? 0);
    const bvid = (media.bvid ?? '').trim();
    const uniqueKey = getResourceKey(media);
    const isDuplicateResourceId = resourceId > 0 && seenResourceIds.has(resourceId);
    const isDuplicateBvid = bvid.length > 0 && seenBvids.has(bvid);

    if (isDuplicateResourceId) duplicateResourceIds++;
    if (isDuplicateBvid) duplicateBvids++;
    if (resourceId > 0) seenResourceIds.add(resourceId);
    if (bvid) seenBvids.add(bvid);
    if (!uniqueKey) {
      uniqueResourcesSeen++;
    } else if (!seenResourceKeys.has(uniqueKey)) {
      seenResourceKeys.add(uniqueKey);
      uniqueResourcesSeen++;
    }

    const parsed = toFavoriteItem(media, folder, syncedAt);
    if (parsed.item) {
      if (!seenItemKeys.has(parsed.item.itemKey)) {
        seenItemKeys.add(parsed.item.itemKey);
        result.push(parsed.item);
        storedVideoItems++;
      }
    } else {
      if (parsed.reason === 'unavailable') filteredUnavailableItems++;
      if (parsed.reason === 'missing-id') filteredMissingIdItems++;
      if (parsed.reason === 'non-video') filteredNonVideoItems++;
    }
  }

  diagnostic.uniqueResourcesSeen += uniqueResourcesSeen;
  diagnostic.duplicateResourceIds += duplicateResourceIds;
  diagnostic.duplicateBvids += duplicateBvids;
  diagnostic.filteredUnavailableItems += filteredUnavailableItems;
  diagnostic.filteredMissingIdItems += filteredMissingIdItems;
  diagnostic.filteredNonVideoItems += filteredNonVideoItems;

  return {
    pageNumber,
    requestedPageSize: pageSize,
    attempts: page.attempts,
    attemptResourceCounts: page.attemptDiagnostics.map(attempt => attempt.resourceCount),
    returnedResourceCount: medias.length,
    hasMore: page.has_more === true,
    shortPageWithHasMore: page.has_more === true && medias.length < pageSize,
    retryImprovedShortPage: page.retryImprovedShortPage,
    duplicateResourceIds,
    duplicateBvids,
    storedVideoItems,
    filteredUnavailableItems,
    filteredMissingIdItems,
    filteredNonVideoItems,
    filteredItems: filteredUnavailableItems + filteredMissingIdItems + filteredNonVideoItems,
  };
}

async function fetchFavoritePageWithRetries(
  pageNumber: number,
  fetchPage: FavoriteResourcePageFetcher,
  signal: AbortSignal | undefined,
  pageSize: number,
  diagnostic: FavoriteFolderSyncDiagnostic,
): Promise<FavoriteFetchedPage | null> {
  let attempts = 0;
  let bestPage: FavoriteResourcesData | null = null;
  const attemptDiagnostics: FavoritePageFetchAttempt[] = [];
  let firstShortPageCount: number | null = null;
  let retryImprovedShortPage = false;

  while (attempts <= FAVORITE_SHORT_PAGE_RETRY_LIMIT) {
    attempts++;
    diagnostic.requestedPages++;

    let data: FavoriteResourcesData;
    try {
      data = await fetchPage(pageNumber, signal);
    } catch (error) {
      markDiagnosticIncomplete(
        diagnostic,
        `page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
        'request_error',
      );
      diagnostic.hasMoreAfterStop = true;
      return bestPage ? { ...bestPage, attempts, attemptDiagnostics, retryImprovedShortPage } : null;
    }

    const medias = data.medias ?? [];
    const isShortPageWithHasMore = data.has_more === true && medias.length < pageSize;
    attemptDiagnostics.push({
      resourceCount: medias.length,
      hasMore: data.has_more === true,
    });

    if (isShortPageWithHasMore && firstShortPageCount === null) {
      firstShortPageCount = medias.length;
    } else if (
      isShortPageWithHasMore
      && firstShortPageCount !== null
      && medias.length > firstShortPageCount
    ) {
      retryImprovedShortPage = true;
    }
    if (data.has_more === true && medias.length === pageSize && firstShortPageCount !== null) {
      retryImprovedShortPage = true;
    }

    if (!bestPage || medias.length > (bestPage.medias ?? []).length || data.has_more === false) {
      bestPage = data;
    }

    if (data.has_more !== true) {
      return { ...data, attempts, attemptDiagnostics, retryImprovedShortPage };
    }
    if (medias.length === pageSize) {
      return { ...data, attempts, attemptDiagnostics, retryImprovedShortPage };
    }
  }

  return bestPage ? { ...bestPage, attempts, attemptDiagnostics, retryImprovedShortPage } : null;
}

function markDiagnosticIncomplete(
  diagnostic: FavoriteFolderSyncDiagnostic,
  message: string,
  stopReason?: FavoriteFolderSyncStopReason,
): void {
  diagnostic.completenessState = 'incomplete';
  diagnostic.errors.push(message);
  if (stopReason) {
    diagnostic.stopReason = stopReason;
  }
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

function getResourceKey(item: FavoriteResourceApiItem): string {
  const avid = Number(item.id ?? item.avid ?? 0);
  if (avid > 0) return `av:${avid}`;
  const bvid = (item.bvid ?? '').trim();
  if (bvid) return `bv:${bvid}`;
  return '';
}

function isUnavailableFavoriteResource(item: FavoriteResourceApiItem): boolean {
  const title = (item.title ?? '').trim();
  return item.attr === 1
    || item.state === -1
    || title === '宸插け鏁堣棰?'
    || title === '瑙嗛宸插け鏁?'
    || title === '绋夸欢宸插け鏁?'
    || title === '宸插垹闄よ棰?';
}
