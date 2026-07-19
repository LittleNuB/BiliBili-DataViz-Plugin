import type { CurrentVideoTextSourceIdentity } from '../../shared/current-video-primary-text.ts';
import { stableDigestHex } from '../../shared/stable-digest.ts';
import { serializeCurrentVideoCanonicalRecord } from '../../shared/current-video-primary-text.ts';
import type {
  CurrentVideoSummaryHighlightsCacheRecord,
  CurrentVideoSummaryHighlightsResult,
} from '../../shared/types/current-video-summary.ts';
import {
  runCurrentVideoSummaryHighlightsClearCoordinator,
} from '../current-video-summary-highlights-clear-epoch.ts';
import { db } from './db.ts';

export const CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_RECORDS = 50;
export const CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_BYTES = 5 * 1024 * 1024;

export interface CurrentVideoSummaryHighlightsCacheUsage {
  count: number;
  usageBytes: number;
  latestGeneratedAt: number | null;
}

export function buildCurrentVideoSummaryHighlightsCacheKey(input: {
  identity: Pick<CurrentVideoTextSourceIdentity, 'sourceIdentityKey'>;
  model: string;
}): string {
  const digest = stableDigestHex(serializeCurrentVideoCanonicalRecord({
    version: 1,
    kind: 'current-video-summary-highlights-cache-key',
    sourceIdentityKey: input.identity.sourceIdentityKey,
    model: normalizeModel(input.model),
  }));
  return `cv-summary-highlights:v1:${digest}`;
}

export async function getCurrentVideoSummaryHighlightsCache(input: {
  identity: Pick<CurrentVideoTextSourceIdentity, 'sourceIdentityKey'>;
  model: string;
  now?: number;
}): Promise<CurrentVideoSummaryHighlightsCacheRecord | null> {
  const cacheKey = buildCurrentVideoSummaryHighlightsCacheKey(input);
  const record = await db.currentVideoSummaryHighlights
    .where('cacheKey')
    .equals(cacheKey)
    .first();
  if (!record) return null;
  const lastAccessedAt = input.now ?? Date.now();
  await db.currentVideoSummaryHighlights.update(record.id as number, { lastAccessedAt });
  return {
    ...record,
    lastAccessedAt,
    result: {
      ...record.result,
      cacheHit: true,
      cacheKey: record.cacheKey,
    },
  };
}

export async function putCurrentVideoSummaryHighlightsCache(
  record: Omit<CurrentVideoSummaryHighlightsCacheRecord, 'id' | 'serializedBytes'>,
): Promise<{ cached: boolean; cacheKey: string; serializedBytes: number }> {
  const serializedBytes = serializedSize(record);
  const nextRecord: CurrentVideoSummaryHighlightsCacheRecord = {
    ...record,
    serializedBytes,
  };
  await db.transaction('rw', db.currentVideoSummaryHighlights, async () => {
    await db.currentVideoSummaryHighlights.put(nextRecord);
    await pruneCurrentVideoSummaryHighlightsCache();
  });
  const cached = await db.currentVideoSummaryHighlights
    .where('cacheKey')
    .equals(record.cacheKey)
    .count() > 0;
  return {
    cached,
    cacheKey: record.cacheKey,
    serializedBytes,
  };
}

export async function clearCurrentVideoSummaryHighlightsCache(): Promise<{
  currentVideoSummaryHighlightParts: number;
  currentVideoSummaryHighlightBytes: number;
}> {
  return await runCurrentVideoSummaryHighlightsClearCoordinator(async () => {
    const usage = await collectCurrentVideoSummaryHighlightsCacheUsage();
    await db.currentVideoSummaryHighlights.clear();
    return {
      currentVideoSummaryHighlightParts: usage.count,
      currentVideoSummaryHighlightBytes: usage.usageBytes,
    };
  });
}

export async function collectCurrentVideoSummaryHighlightsCacheUsage(): Promise<CurrentVideoSummaryHighlightsCacheUsage> {
  const records = await db.currentVideoSummaryHighlights.toArray();
  return {
    count: records.length,
    usageBytes: records.reduce((sum, record) => sum + Math.max(0, record.serializedBytes ?? serializedSize(record)), 0),
    latestGeneratedAt: records.reduce<number | null>((latest, record) => {
      const generatedAt = normalizeTimestamp(record.generatedAt);
      if (!generatedAt) return latest;
      return latest === null ? generatedAt : Math.max(latest, generatedAt);
    }, null),
  };
}

export async function readCurrentVideoSummaryHighlightsAfterClear(): Promise<CurrentVideoSummaryHighlightsCacheUsage & { empty: boolean }> {
  const usage = await collectCurrentVideoSummaryHighlightsCacheUsage();
  return {
    ...usage,
    empty: usage.count === 0 && usage.usageBytes === 0,
  };
}

export function withCurrentCacheHit(
  record: CurrentVideoSummaryHighlightsCacheRecord,
  current: boolean,
): CurrentVideoSummaryHighlightsResult {
  return {
    ...record.result,
    cacheHit: true,
    cacheKey: record.cacheKey,
    current,
    message: current
      ? '已读取本地缓存的摘要与亮点。'
      : '已读取对应视频缓存；当前页面已变化，因此没有覆盖当前视图。',
    ai: {
      ...record.result.ai,
      note: '已从本地缓存读取。',
    },
  };
}

async function pruneCurrentVideoSummaryHighlightsCache(): Promise<void> {
  let records = await db.currentVideoSummaryHighlights
    .orderBy('lastAccessedAt')
    .toArray();
  let usageBytes = records.reduce((sum, record) => sum + Math.max(0, record.serializedBytes ?? serializedSize(record)), 0);
  const deleteIds: number[] = [];

  while (
    records.length > 0
    && (records.length > CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_RECORDS
      || usageBytes > CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE_MAX_BYTES)
  ) {
    const [oldest, ...rest] = records;
    records = rest;
    usageBytes -= Math.max(0, oldest.serializedBytes ?? serializedSize(oldest));
    if (oldest.id !== undefined) {
      deleteIds.push(oldest.id);
    }
  }

  if (deleteIds.length > 0) {
    await db.currentVideoSummaryHighlights.bulkDelete(deleteIds);
  }
}

function normalizeModel(value: string): string {
  return value.trim() || 'unknown-model';
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function serializedSize(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
}
