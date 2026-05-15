import { biliGet } from './client';
import { VIDEO_INFO_ENDPOINT } from '../../shared/constants';
import type { VideoInfo } from '../../shared/types/video-info';

interface VideoInfoCacheEntry {
  data: VideoInfo;
  cachedAt: number;
}

const videoInfoCache = new Map<string, VideoInfoCacheEntry>();
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
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    } catch (e) {
      if (e instanceof Error && e.message === 'SYNC_CANCELLED') throw e;
      console.warn(`[BiliViz] Failed to fetch video info for ${bvid}:`, e);
    }
  }

  return results;
}
