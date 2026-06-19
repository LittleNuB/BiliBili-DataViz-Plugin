import { RELATED_VIDEO_ENDPOINT } from '../../shared/constants';
import type {
  ExperimentRealCandidateFailure,
  ExperimentRealCandidatePool,
  ExperimentRealVideoCandidate,
} from '../../shared/types/analytics';
import { biliGet } from './client';

const DEFAULT_SEED_LIMIT = 3;
const DEFAULT_PER_SEED_LIMIT = 20;
const DEFAULT_SEED_TIMEOUT_MS = 8_000;

export interface RelatedVideoSeed {
  bvid: string;
  title: string;
}

export interface RelatedVideoCandidateOptions {
  seedLimit?: number;
  perSeedLimit?: number;
  seedTimeoutMs?: number;
  signal?: AbortSignal;
}

interface RelatedArchiveOwner {
  mid?: number;
  name?: string;
}

interface RelatedArchiveItem {
  aid?: number;
  bvid?: string;
  cid?: number;
  title?: string;
  owner?: RelatedArchiveOwner;
  pic?: string;
  cover43?: string;
  duration?: number;
  pubdate?: number;
  ctime?: number;
  tname?: string;
}

export async function fetchRelatedVideoCandidates(
  seeds: RelatedVideoSeed[],
  options: RelatedVideoCandidateOptions = {},
): Promise<ExperimentRealCandidatePool> {
  const selectedSeeds = normalizeSeeds(seeds).slice(0, clampPositive(options.seedLimit, DEFAULT_SEED_LIMIT));
  const perSeedLimit = clampPositive(options.perSeedLimit, DEFAULT_PER_SEED_LIMIT);
  const seedTimeoutMs = clampPositive(options.seedTimeoutMs, DEFAULT_SEED_TIMEOUT_MS);
  const candidates: ExperimentRealVideoCandidate[] = [];
  const failures: ExperimentRealCandidateFailure[] = [];
  const seenBvids = new Set(selectedSeeds.map(seed => seed.bvid));

  for (const seed of selectedSeeds) {
    if (options.signal?.aborted) throw new Error('SYNC_CANCELLED');
    const seedController = new AbortController();
    const seedTimer = setTimeout(() => seedController.abort(), seedTimeoutMs);
    const abortFromExternal = () => seedController.abort();
    options.signal?.addEventListener('abort', abortFromExternal, { once: true });

    try {
      const data = await biliGet<RelatedArchiveItem[]>(
        RELATED_VIDEO_ENDPOINT,
        { bvid: seed.bvid },
        2,
        false,
        seedController.signal,
      );
      const relatedItems = Array.isArray(data) ? data : [];
      if (relatedItems.length === 0) {
        failures.push(toFailure(seed, 'empty_response'));
        continue;
      }

      let accepted = 0;
      for (const item of relatedItems) {
        if (accepted >= perSeedLimit) break;
        const candidate = toRelatedCandidate(item, seed);
        if (!candidate || seenBvids.has(candidate.bvid)) continue;
        seenBvids.add(candidate.bvid);
        candidates.push(candidate);
        accepted += 1;
      }

      if (accepted === 0) {
        failures.push(toFailure(seed, 'no_valid_candidates'));
      }
    } catch (error) {
      if (options.signal?.aborted && error instanceof Error && error.message === 'SYNC_CANCELLED') throw error;
      failures.push(toFailure(seed, 'request_failed'));
    } finally {
      clearTimeout(seedTimer);
      options.signal?.removeEventListener('abort', abortFromExternal);
    }
  }

  return {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedCount: selectedSeeds.length,
    candidates,
    failures,
  };
}

function toFailure(
  seed: RelatedVideoSeed,
  reason: ExperimentRealCandidateFailure['reason'],
): ExperimentRealCandidateFailure {
  return {
    seedBvid: seed.bvid,
    seedTitle: seed.title,
    reason,
  };
}

function toRelatedCandidate(
  item: RelatedArchiveItem,
  seed: RelatedVideoSeed,
): ExperimentRealVideoCandidate | null {
  const bvid = cleanText(item.bvid);
  const title = cleanText(item.title);
  if (!isLikelyBvid(bvid) || !title) return null;

  return {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedBvid: seed.bvid,
    seedTitle: seed.title,
    bvid,
    avid: positiveNumber(item.aid),
    cid: positiveNumber(item.cid),
    title,
    authorName: cleanText(item.owner?.name) || '未知 UP',
    authorMid: positiveNumber(item.owner?.mid),
    cover: cleanText(item.pic) || cleanText(item.cover43),
    duration: positiveNumber(item.duration),
    pubtime: positiveNumber(item.pubdate) ?? positiveNumber(item.ctime),
    tagName: cleanText(item.tname),
    url: buildVideoUrl(bvid),
  };
}

function normalizeSeeds(seeds: RelatedVideoSeed[]): RelatedVideoSeed[] {
  const normalized: RelatedVideoSeed[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const bvid = cleanText(seed.bvid);
    if (!isLikelyBvid(bvid) || seen.has(bvid)) continue;
    seen.add(bvid);
    normalized.push({
      bvid,
      title: cleanText(seed.title) || bvid,
    });
  }
  return normalized;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function clampPositive(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function isLikelyBvid(value: string): boolean {
  return /^BV[0-9A-Za-z]{8,}$/.test(value);
}

function buildVideoUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`;
}
