import { biliGet } from './client';
import { VIDEO_INFO_ENDPOINT, VIDEO_TAGS_ENDPOINT } from '../../shared/constants';
import type { VideoInfo } from '../../shared/types/video-info';
import { abortableDelay } from '../utils/abortable-delay';

interface VideoInfoCacheEntry {
  data: VideoInfo;
  cachedAt: number;
}

interface VideoTagsCacheEntry {
  data: string[];
  cachedAt: number;
}

interface VideoTagApiItem {
  tag_name?: string;
}

const videoInfoCache = new Map<string, VideoInfoCacheEntry>();
const videoTagsCache = new Map<string, VideoTagsCacheEntry>();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
const BATCH_DELAY_MS = 300; // Delay between batched requests to respect rate limit

export async function fetchVideoInfo(bvid: string, signal?: AbortSignal): Promise<VideoInfo> {
  const cached = videoInfoCache.get(bvid);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  const data = await biliGet<VideoInfo>(VIDEO_INFO_ENDPOINT, { bvid }, 3, false, signal);
  videoInfoCache.set(bvid, { data, cachedAt: Date.now() });
  return data;
}

export async function batchFetchVideoInfo(
  bvids: string[],
  signal?: AbortSignal,
): Promise<Map<string, VideoInfo>> {
  const results = new Map<string, VideoInfo>();
  const unique = [...new Set(bvids)];

  const toFetch: string[] = [];
  for (const bvid of unique) {
    const cached = videoInfoCache.get(bvid);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      results.set(bvid, cached.data);
    } else {
      toFetch.push(bvid);
    }
  }

  for (const bvid of toFetch) {
    try {
      if (signal?.aborted) throw new Error('SYNC_CANCELLED');
      const data = await fetchVideoInfo(bvid, signal);
      results.set(bvid, data);
      await abortableDelay(BATCH_DELAY_MS, signal);
    } catch (e) {
      if (e instanceof Error && e.message === 'SYNC_CANCELLED') throw e;
      console.warn(`[BiliViz] Failed to fetch video info for ${bvid}:`, e);
    }
  }

  return results;
}

export async function fetchVideoTags(bvid: string, signal?: AbortSignal): Promise<string[]> {
  const cached = videoTagsCache.get(bvid);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  const data = await biliGet<VideoTagApiItem[]>(VIDEO_TAGS_ENDPOINT, { bvid }, 3, false, signal);
  const tags = (data ?? [])
    .map(tag => tag.tag_name?.trim() ?? '')
    .filter(Boolean);
  videoTagsCache.set(bvid, { data: tags, cachedAt: Date.now() });
  return tags;
}

export async function batchFetchVideoTags(
  bvids: string[],
  signal?: AbortSignal,
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();
  const unique = [...new Set(bvids.filter(Boolean))];

  const toFetch: string[] = [];
  for (const bvid of unique) {
    const cached = videoTagsCache.get(bvid);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      results.set(bvid, cached.data);
    } else {
      toFetch.push(bvid);
    }
  }

  for (const bvid of toFetch) {
    try {
      if (signal?.aborted) throw new Error('SYNC_CANCELLED');
      const tags = await fetchVideoTags(bvid, signal);
      results.set(bvid, tags);
      await abortableDelay(BATCH_DELAY_MS, signal);
    } catch (e) {
      if (e instanceof Error && e.message === 'SYNC_CANCELLED') throw e;
      console.warn(`[BiliViz] Failed to fetch video tags for ${bvid}:`, e);
    }
  }

  return results;
}
