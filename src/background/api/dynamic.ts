import { DYNAMIC_FEED_ENDPOINT, DYNAMIC_FEED_MAX_PAGES, DYNAMIC_UPDATE_WINDOW_DAYS } from '../../shared/constants';
import type { FollowedVideoUpdate } from '../../shared/types/dynamic-bill';
import { biliGet } from './client';

interface DynamicFeedData {
  items?: unknown[];
  has_more?: boolean;
  offset?: string;
}

export interface DynamicFeedFetchResult {
  updates: FollowedVideoUpdate[];
  pagesFetched: number;
  itemsScanned: number;
  filteredNonVideoCount: number;
  filteredNonFollowedCount: number;
  filteredOutsideWindowCount: number;
  syncedAt: number;
}

export async function fetchFollowedVideoDynamics(options: {
  followingMids: Set<number>;
  windowDays?: number;
  maxPages?: number;
  signal?: AbortSignal;
}): Promise<DynamicFeedFetchResult> {
  const windowDays = Math.max(1, Math.floor(options.windowDays ?? DYNAMIC_UPDATE_WINDOW_DAYS));
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? DYNAMIC_FEED_MAX_PAGES));
  const cutoffSeconds = Math.floor(Date.now() / 1000) - windowDays * 86_400;
  const syncedAt = Date.now();
  const updates: FollowedVideoUpdate[] = [];
  const seenOffsets = new Set<string>();
  let offset = '';
  let pagesFetched = 0;
  let itemsScanned = 0;
  let filteredNonVideoCount = 0;
  let filteredNonFollowedCount = 0;
  let filteredOutsideWindowCount = 0;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = {
      type: 'video',
      timezone_offset: '-480',
    };
    if (offset) params.offset = offset;

    const data = await biliGet<DynamicFeedData>(DYNAMIC_FEED_ENDPOINT, params, 3, false, options.signal);
    pagesFetched++;
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) break;

    let oldestDynamicTime = Number.POSITIVE_INFINITY;
    for (const item of items) {
      itemsScanned++;
      const update = toVideoUpdate(item, syncedAt);
      if (!update) {
        filteredNonVideoCount++;
        continue;
      }

      if (update.dynamicTime <= 0) {
        filteredOutsideWindowCount++;
        continue;
      }

      oldestDynamicTime = Math.min(oldestDynamicTime, update.dynamicTime);
      if (update.dynamicTime < cutoffSeconds) {
        filteredOutsideWindowCount++;
        continue;
      }

      if (!options.followingMids.has(update.authorMid)) {
        filteredNonFollowedCount++;
        continue;
      }

      updates.push(update);
    }

    const nextOffset = String(data.offset ?? '');
    if (oldestDynamicTime < cutoffSeconds || data.has_more === false || !nextOffset || seenOffsets.has(nextOffset)) {
      break;
    }
    seenOffsets.add(nextOffset);
    offset = nextOffset;
  }

  return {
    updates,
    pagesFetched,
    itemsScanned,
    filteredNonVideoCount,
    filteredNonFollowedCount,
    filteredOutsideWindowCount,
    syncedAt,
  };
}

function toVideoUpdate(item: unknown, syncedAt: number): FollowedVideoUpdate | null {
  const record = asRecord(item);
  const modules = asRecord(record.modules);
  const author = asRecord(modules.module_author);
  const dynamic = asRecord(modules.module_dynamic);
  const major = asRecord(dynamic.major);
  const archive = asRecord(major.archive);

  const itemType = stringValue(record.type);
  const majorType = stringValue(major.type);
  const bvid = stringValue(archive.bvid);
  if (itemType !== 'DYNAMIC_TYPE_AV' || majorType !== 'MAJOR_TYPE_ARCHIVE' || !bvid) {
    return null;
  }

  const authorMid = numberValue(author.mid);
  if (!authorMid) return null;

  const dynamicId = stringValue(record.id_str) || stringValue(record.id) || bvid;
  const dynamicTime = numberValue(author.pub_ts) || numberValue(archive.pub_ts) || numberValue(archive.ctime);
  const avid = numberValue(archive.aid);

  return {
    updateKey: `${dynamicId}:${bvid}`,
    dynamicId,
    bvid,
    avid,
    title: stringValue(archive.title),
    intro: stringValue(archive.desc),
    cover: stringValue(archive.cover),
    duration: numberValue(archive.duration) || parseDurationText(stringValue(archive.duration_text)),
    pubtime: numberValue(archive.pubdate) || numberValue(archive.ctime) || dynamicTime,
    dynamicTime,
    authorMid,
    authorName: stringValue(author.name),
    authorFace: stringValue(author.face),
    tagName: '',
    tags: [],
    syncedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function numberValue(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseDurationText(value: string): number {
  if (!value) return 0;
  const parts = value.split(':').map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
