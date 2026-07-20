import { DYNAMIC_FEED_MAX_PAGES, DYNAMIC_UPDATE_WINDOW_DAYS, MAX_FOLLOWING_SYNC_PAGES } from '../../shared/constants';
import type {
  DynamicBillOverview,
  DynamicSyncResult,
  DynamicSyncStage,
  DynamicSyncState,
  FollowedVideoUpdate,
} from '../../shared/types/dynamic-bill';
import type { VideoInfo } from '../../shared/types/video-info';
import { fetchFollowedVideoDynamics, type DynamicFeedFetchResult } from '../api/dynamic';
import { fetchFollowingCreators, type FollowingFetchResult } from '../api/following';
import { batchFetchVideoInfo } from '../api/video-info';
import {
  getDynamicBillOverview,
  getDynamicSyncState,
  pruneFollowedVideoUpdatesOlderThan,
  replaceFollowedCreatorSnapshot,
  setDynamicSyncState,
  upsertFollowedVideoUpdates,
} from '../storage/dynamic-bill-repo';
import { ensureDynamicBill013Migration } from './migration';
import { runDynamicBillDataOperation } from './operation-control';

const VIDEO_UPDATE_RETENTION_DAYS = 30;
const VIDEO_DETAIL_ENRICHMENT_LIMIT = 40;
const VIDEO_DETAIL_ENRICHMENT_TIMEOUT_MS = 30_000;

interface SyncPartial {
  following?: FollowingFetchResult;
  dynamicFeed?: DynamicFeedFetchResult;
  followedCreatorsStored?: number;
  videoUpdatesStored?: number;
  detailEnrichedCount?: number;
}

export async function getDynamicOverview(): Promise<DynamicBillOverview> {
  await ensureDynamicBill013Migration();
  return getDynamicBillOverview(DYNAMIC_UPDATE_WINDOW_DAYS);
}

export function syncDynamicBillUpdates(signal?: AbortSignal): Promise<DynamicSyncResult> {
  return runDynamicBillDataOperation(() => syncDynamicBillUpdatesExclusive(signal));
}

async function syncDynamicBillUpdatesExclusive(signal?: AbortSignal): Promise<DynamicSyncResult> {
  await ensureDynamicBill013Migration();
  const startedAt = Date.now();
  const previousState = await getDynamicSyncState();
  const partial: SyncPartial = {};

  await setDynamicSyncState({
    status: 'syncing',
    stage: 'following',
    lastStartedAt: startedAt,
    lastFinishedAt: previousState.lastFinishedAt,
    lastSuccessAt: previousState.lastSuccessAt,
  });

  try {
    partial.following = await fetchFollowingCreators({
      maxPages: MAX_FOLLOWING_SYNC_PAGES,
      signal,
    });

    await patchSyncStage('storage', startedAt, previousState.lastSuccessAt);
    partial.followedCreatorsStored = await replaceFollowedCreatorSnapshot(
      partial.following.creators,
      partial.following.syncedAt,
    );
  } catch (error) {
    return finishFailure(startedAt, 'following', error, partial, previousState.lastSuccessAt);
  }

  try {
    const followingMids = new Set(partial.following.creators.map(creator => creator.mid));
    await patchSyncStage('dynamic-feed', startedAt, previousState.lastSuccessAt);
    partial.dynamicFeed = followingMids.size > 0
      ? await fetchFollowedVideoDynamics({
        followingMids,
        windowDays: DYNAMIC_UPDATE_WINDOW_DAYS,
        maxPages: DYNAMIC_FEED_MAX_PAGES,
        signal,
      })
      : emptyDynamicFeedResult();

    await patchSyncStage('storage', startedAt, previousState.lastSuccessAt);
    partial.videoUpdatesStored = await upsertFollowedVideoUpdates(partial.dynamicFeed.updates);
    await pruneFollowedVideoUpdatesOlderThan(VIDEO_UPDATE_RETENTION_DAYS);

    await patchSyncStage('video-detail', startedAt, previousState.lastSuccessAt);
    const { updates, enrichedCount } = await enrichVideoUpdates(partial.dynamicFeed.updates, signal);
    partial.detailEnrichedCount = enrichedCount;
    if (enrichedCount > 0) {
      await patchSyncStage('storage', startedAt, previousState.lastSuccessAt);
      partial.videoUpdatesStored = await upsertFollowedVideoUpdates(updates);
    }
  } catch (error) {
    return finishFailure(startedAt, 'dynamic-feed', error, partial, previousState.lastSuccessAt);
  }

  const finishedAt = Date.now();
  await setDynamicSyncState({
    status: 'success',
    stage: 'complete',
    lastStartedAt: startedAt,
    lastFinishedAt: finishedAt,
    lastSuccessAt: finishedAt,
  });

  return buildResult('success', 'complete', startedAt, finishedAt, partial);
}

async function enrichVideoUpdates(
  updates: FollowedVideoUpdate[],
  signal?: AbortSignal,
): Promise<{ updates: FollowedVideoUpdate[]; enrichedCount: number }> {
  const bvids = updates.map(update => update.bvid).filter(Boolean).slice(0, VIDEO_DETAIL_ENRICHMENT_LIMIT);
  if (bvids.length === 0) return { updates, enrichedCount: 0 };

  const infoMap = await fetchVideoInfoBestEffort(bvids, signal);
  let enrichedCount = 0;
  const enriched = updates.map(update => {
    const info = infoMap.get(update.bvid);
    if (!info) return update;
    enrichedCount++;
    return mergeVideoInfo(update, info);
  });

  return { updates: enriched, enrichedCount };
}

async function fetchVideoInfoBestEffort(bvids: string[], signal?: AbortSignal): Promise<Map<string, VideoInfo>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VIDEO_DETAIL_ENRICHMENT_TIMEOUT_MS);
  const abortParent = (): void => controller.abort();
  signal?.addEventListener('abort', abortParent, { once: true });

  try {
    return await batchFetchVideoInfo(bvids, controller.signal);
  } catch (error) {
    if (signal?.aborted && error instanceof Error && error.message === 'SYNC_CANCELLED') {
      throw error;
    }
    console.warn('[BiliViz] Dynamic bill video detail enrichment skipped:', error);
    return new Map<string, VideoInfo>();
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortParent);
  }
}

function mergeVideoInfo(update: FollowedVideoUpdate, info: VideoInfo): FollowedVideoUpdate {
  return {
    ...update,
    avid: update.avid || Number(info.avid ?? 0),
    bvid: update.bvid || info.bvid || '',
    title: update.title || info.title || '',
    intro: update.intro || info.desc || '',
    cover: update.cover || info.pic || '',
    duration: update.duration || Number(info.duration ?? 0),
    pubtime: update.pubtime || Number(info.pubdate ?? info.ctime ?? 0) || update.dynamicTime,
    authorMid: update.authorMid || Number(info.owner?.mid ?? 0),
    authorName: update.authorName || info.owner?.name || '',
    authorFace: update.authorFace || info.owner?.face || '',
    tagName: info.tname || update.tagName,
    tags: Array.isArray(info.tags) && info.tags.length > 0 ? info.tags : update.tags,
  };
}

async function patchSyncStage(stage: DynamicSyncStage, startedAt: number, lastSuccessAt: number): Promise<void> {
  await setDynamicSyncState({
    status: 'syncing',
    stage,
    lastStartedAt: startedAt,
    lastFinishedAt: 0,
    lastSuccessAt,
  });
}

async function finishFailure(
  startedAt: number,
  stage: DynamicSyncStage,
  error: unknown,
  partial: SyncPartial,
  lastSuccessAt: number,
): Promise<DynamicSyncResult> {
  const finishedAt = Date.now();
  const status = isNotLoggedIn(error) ? 'not_logged_in' : 'failed';
  const message = describeError(error);
  const state: DynamicSyncState = {
    status,
    stage,
    lastStartedAt: startedAt,
    lastFinishedAt: finishedAt,
    lastSuccessAt,
    lastError: message,
  };
  await setDynamicSyncState(state);
  return buildResult(status, stage, startedAt, finishedAt, partial, message);
}

async function buildResult(
  status: DynamicSyncResult['status'],
  stage: DynamicSyncStage,
  startedAt: number,
  finishedAt: number,
  partial: SyncPartial,
  error?: string,
): Promise<DynamicSyncResult> {
  const overview = await getDynamicBillOverview(DYNAMIC_UPDATE_WINDOW_DAYS);
  const following = partial.following;
  const dynamicFeed = partial.dynamicFeed ?? emptyDynamicFeedResult();

  return {
    status,
    stage,
    startedAt,
    finishedAt,
    followedCreatorsFetched: following?.creators.length ?? 0,
    followedCreatorsStored: partial.followedCreatorsStored ?? 0,
    followAgeKnownCount: following?.followAgeKnownCount ?? 0,
    followAgeUnknownCount: following?.followAgeUnknownCount ?? 0,
    followingPagesFetched: following?.pagesFetched ?? 0,
    dynamicPagesFetched: dynamicFeed.pagesFetched,
    dynamicItemsScanned: dynamicFeed.itemsScanned,
    videoUpdatesFetched: dynamicFeed.updates.length,
    videoUpdatesStored: partial.videoUpdatesStored ?? 0,
    filteredNonVideoCount: dynamicFeed.filteredNonVideoCount,
    filteredNonFollowedCount: dynamicFeed.filteredNonFollowedCount,
    filteredOutsideWindowCount: dynamicFeed.filteredOutsideWindowCount,
    detailEnrichedCount: partial.detailEnrichedCount ?? 0,
    error,
    overview,
  };
}

function emptyDynamicFeedResult(): DynamicFeedFetchResult {
  return {
    updates: [],
    pagesFetched: 0,
    itemsScanned: 0,
    filteredNonVideoCount: 0,
    filteredNonFollowedCount: 0,
    filteredOutsideWindowCount: 0,
    syncedAt: Date.now(),
  };
}

function isNotLoggedIn(error: unknown): boolean {
  return error instanceof Error && error.message === 'NOT_LOGGED_IN';
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
