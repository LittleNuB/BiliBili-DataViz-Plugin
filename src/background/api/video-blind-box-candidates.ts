import type {
  ExperimentRealCandidateFailure,
  ExperimentRealCandidatePool,
  ExperimentRealVideoCandidate,
  ExperimentVideoCandidate,
} from '../../shared/types/analytics';
import type { FollowedCreator } from '../../shared/types/dynamic-bill';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';

const DAY_MS = 86_400_000;
const RELATED_VIDEO_ENDPOINT = '/x/web-interface/archive/related';
const REGION_NEWLIST_ENDPOINT = '/x/web-interface/newlist';
const CREATOR_ARCHIVE_ENDPOINT = '/x/space/wbi/arc/search';
const DEFAULT_SEED_LIMIT = 3;
const DEFAULT_PER_SEED_LIMIT = 20;
const DEFAULT_SEED_TIMEOUT_MS = 8_000;

const CROSS_REGION_WINDOW_DAYS = 7;
const CROSS_REGION_HIGH_FREQUENCY_THRESHOLD = 2;
const CROSS_REGION_HIGH_FREQUENCY_LIMIT = 3;
const POSITIVE_COMPLETION = 0.75;
const REGION_PAGE_SIZE = 20;
const REGION_SOURCE_LABEL = 'B 站分区新视频';
const CREATOR_ARCHIVE_SOURCE_LABEL = 'UP 主公开较早投稿';
const CREATOR_ARCHIVE_SEED_LIMIT = 3;
const CREATOR_ARCHIVE_PAGE_SIZE = 30;
const CREATOR_ARCHIVE_RECENT_BLOCK_DAYS = 7;

export type BlindBoxRandomSource = () => number;

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

export type CrossRegionCandidatePoolStatus =
  | 'ready'
  | 'no_available_region'
  | 'empty';

export interface PublicRegion {
  rid: number;
  regionName: string;
  labels: string[];
}

export interface CrossRegionHighFrequencyRegion {
  rid: number;
  regionName: string;
  count: number;
}

export interface CrossRegionSelection {
  selectedRegion: PublicRegion | null;
  highFrequencyRegions: CrossRegionHighFrequencyRegion[];
  candidateRegions: PublicRegion[];
  hasRecentRegionEvidence: boolean;
}

export interface CrossRegionCandidatePool {
  status: CrossRegionCandidatePoolStatus;
  sourceLabel: string;
  selectedRegion: PublicRegion | null;
  highFrequencyRegions: CrossRegionHighFrequencyRegion[];
  candidates: ExperimentVideoCandidate[];
  evidence: string[];
  checkedRegionCount: number;
  excludedInvalidCandidateCount: number;
}

export type CrossRegionCandidateRequest = (
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) => Promise<BiliRegionResponse>;

export interface CrossRegionCandidateOptions {
  nowMs?: number;
  pageSize?: number;
  random?: BlindBoxRandomSource;
  signal?: AbortSignal;
  request?: CrossRegionCandidateRequest;
}

export type CreatorArchiveCandidatePoolStatus =
  | 'ready'
  | 'no_followed_creator'
  | 'empty';

export interface CreatorArchiveSeed {
  mid: number;
  name: string;
}

export interface CreatorArchiveCandidatePool {
  status: CreatorArchiveCandidatePoolStatus;
  sourceLabel: string;
  seedCount: number;
  candidates: ExperimentVideoCandidate[];
  evidence: string[];
  failures: string[];
  checkedCreatorCount: number;
  excludedRecentSubmissionCount: number;
  excludedInvalidCandidateCount: number;
}

interface CreatorArchiveCandidateOptions {
  nowMs?: number;
  seedLimit?: number;
  pageSize?: number;
  random?: BlindBoxRandomSource;
  signal?: AbortSignal;
}

interface RegionSignal {
  rid: number;
  regionName: string;
}

interface ArchiveOwner {
  mid?: number;
  name?: string;
}

interface RelatedArchiveItem {
  aid?: number;
  bvid?: string;
  cid?: number;
  title?: string;
  owner?: ArchiveOwner;
  pic?: string;
  cover43?: string;
  duration?: number;
  pubdate?: number;
  ctime?: number;
  tname?: string;
}

interface BiliRegionArchive {
  aid?: number;
  bvid?: string;
  cid?: number;
  title?: string;
  owner?: ArchiveOwner;
  author?: string;
  pic?: string;
  cover?: string;
  first_frame?: string;
  duration?: number;
  pubdate?: number;
  ctime?: number;
  tname?: string;
}

interface BiliRegionResponse {
  archives?: BiliRegionArchive[];
}

interface SpaceArchiveItem {
  aid?: number;
  bvid?: string;
  title?: string;
  author?: string;
  owner?: ArchiveOwner;
  pic?: string;
  cover?: string;
  length?: string | number;
  duration?: string | number;
  created?: number;
  pubdate?: number;
  ctime?: number;
  tname?: string;
}

interface SpaceArchiveList {
  vlist?: SpaceArchiveItem[];
}

interface SpaceArchiveResponse {
  list?: SpaceArchiveList | SpaceArchiveItem[];
  vlist?: SpaceArchiveItem[];
  archives?: SpaceArchiveItem[];
}

const REGION_MAPPINGS: PublicRegion[] = [
  { rid: 1, regionName: '动画', labels: ['动画', 'mad', 'mmd', '手书', '配音'] },
  { rid: 13, regionName: '番剧', labels: ['番剧', '追番', '动漫番剧'] },
  { rid: 167, regionName: '国创', labels: ['国创', '国产动画'] },
  { rid: 3, regionName: '音乐', labels: ['音乐', '歌曲', '演奏', '翻唱', '乐器'] },
  { rid: 129, regionName: '舞蹈', labels: ['舞蹈', '宅舞'] },
  { rid: 4, regionName: '游戏', labels: ['游戏', '单机游戏', '网络游戏', '手游', '电竞'] },
  { rid: 36, regionName: '知识', labels: ['知识', '科普', '学习', '教程', '公开课', '财经', '人文历史', '社科'] },
  { rid: 188, regionName: '科技', labels: ['科技', '数码', '编程', '程序员', '开发', 'ai', 'aigc', '人工智能', '机器学习', '电脑装机'] },
  { rid: 234, regionName: '运动', labels: ['运动', '健身', '篮球', '足球'] },
  { rid: 223, regionName: '汽车', labels: ['汽车', '新能源车'] },
  { rid: 160, regionName: '生活', labels: ['生活', '日常', 'vlog', '家居', '手工', '绘画'] },
  { rid: 211, regionName: '美食', labels: ['美食', '料理', '探店'] },
  { rid: 119, regionName: '鬼畜', labels: ['鬼畜'] },
  { rid: 155, regionName: '时尚', labels: ['时尚', '美妆', '穿搭'] },
  { rid: 5, regionName: '娱乐', labels: ['娱乐', '综艺', '明星'] },
  { rid: 181, regionName: '影视', labels: ['影视', '电影解说', '电视剧', '纪录片'] },
  { rid: 202, regionName: '资讯', labels: ['资讯', '新闻'] },
];

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
  const { biliGet } = await import('./client.ts');

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
        failures.push(toRelatedFailure(seed, 'empty_response'));
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
        failures.push(toRelatedFailure(seed, 'no_valid_candidates'));
      }
    } catch (error) {
      if (options.signal?.aborted && error instanceof Error && error.message === 'SYNC_CANCELLED') throw error;
      failures.push(toRelatedFailure(seed, 'request_failed'));
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

export function buildRelatedVideoSourceFailure(
  seeds: RelatedVideoSeed[],
  _error: unknown,
  options: RelatedVideoCandidateOptions = {},
): ExperimentRealCandidatePool {
  const selectedSeeds = normalizeSeeds(seeds).slice(0, clampPositive(options.seedLimit, DEFAULT_SEED_LIMIT));
  return {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedCount: selectedSeeds.length,
    candidates: [],
    failures: selectedSeeds.map(seed => toRelatedFailure(seed, 'request_failed')),
  };
}

export async function fetchCrossRegionCandidatePool(
  records: WatchHistoryRecord[],
  options: CrossRegionCandidateOptions = {},
): Promise<CrossRegionCandidatePool> {
  const nowMs = options.nowMs ?? Date.now();
  const selection = selectCrossRegion(records, {
    nowMs,
    random: options.random,
  });
  if (!selection.selectedRegion) {
    return {
      status: 'no_available_region',
      sourceLabel: REGION_SOURCE_LABEL,
      selectedRegion: null,
      highFrequencyRegions: selection.highFrequencyRegions,
      candidates: [],
      evidence: buildCrossRegionSelectionEvidence(selection, 0),
      checkedRegionCount: 0,
      excludedInvalidCandidateCount: 0,
    };
  }

  const candidatesByBvid = new Map<string, ExperimentVideoCandidate>();
  let excludedInvalidCandidateCount = 0;
  const checkedRegionCount = 1;
  const request = options.request ?? requestCrossRegionCandidates;

  try {
    const data = await request(
      REGION_NEWLIST_ENDPOINT,
      {
        rid: String(selection.selectedRegion.rid),
        pn: '1',
        ps: String(options.pageSize ?? REGION_PAGE_SIZE),
      },
      options.signal,
    );
    for (const archive of getRegionArchives(data)) {
      const video = toRegionVideoCandidate(archive, selection.selectedRegion);
      if (!video) {
        excludedInvalidCandidateCount += 1;
        continue;
      }
      if (!candidatesByBvid.has(video.bvid)) {
        candidatesByBvid.set(video.bvid, video);
      }
    }
  } catch {
    return {
      status: 'empty',
      sourceLabel: REGION_SOURCE_LABEL,
      selectedRegion: selection.selectedRegion,
      highFrequencyRegions: selection.highFrequencyRegions,
      candidates: [],
      evidence: [
        ...buildCrossRegionSelectionEvidence(selection, 0),
        '这次没有取得可打开的分区新视频。',
      ],
      checkedRegionCount,
      excludedInvalidCandidateCount,
    };
  }

  const candidates = [...candidatesByBvid.values()];
  if (candidates.length > 0) {
    return {
      status: 'ready',
      sourceLabel: REGION_SOURCE_LABEL,
      selectedRegion: selection.selectedRegion,
      highFrequencyRegions: selection.highFrequencyRegions,
      candidates,
      evidence: buildCrossRegionSelectionEvidence(selection, candidates.length),
      checkedRegionCount,
      excludedInvalidCandidateCount,
    };
  }

  return {
    status: 'empty',
    sourceLabel: REGION_SOURCE_LABEL,
    selectedRegion: selection.selectedRegion,
    highFrequencyRegions: selection.highFrequencyRegions,
    candidates: [],
    evidence: [
      ...buildCrossRegionSelectionEvidence(selection, 0),
      '这次分区新视频候选池没有留下可打开视频。',
    ],
    checkedRegionCount,
    excludedInvalidCandidateCount,
  };
}

export function buildCrossRegionSourceFailure(
  records: WatchHistoryRecord[],
  nowMs: number,
  _error: unknown,
  options: { random?: BlindBoxRandomSource } = {},
): CrossRegionCandidatePool {
  const selection = selectCrossRegion(records, {
    nowMs,
    random: options.random,
  });
  return {
    status: 'empty',
    sourceLabel: REGION_SOURCE_LABEL,
    selectedRegion: selection.selectedRegion,
    highFrequencyRegions: selection.highFrequencyRegions,
    candidates: [],
    evidence: [
      ...buildCrossRegionSelectionEvidence(selection, 0),
      '这次没有取得可打开的分区新视频。',
    ],
    checkedRegionCount: 0,
    excludedInvalidCandidateCount: 0,
  };
}

export function selectCrossRegion(
  records: WatchHistoryRecord[],
  options: { nowMs?: number; random?: BlindBoxRandomSource } = {},
): CrossRegionSelection {
  const nowMs = options.nowMs ?? Date.now();
  const highFrequencyRegions = buildRecentHighFrequencyRegions(records, nowMs);
  const excludedRids = new Set(highFrequencyRegions.map(region => region.rid));
  const candidateRegions = highFrequencyRegions.length > 0
    ? REGION_MAPPINGS.filter(region => !excludedRids.has(region.rid))
    : [...REGION_MAPPINGS];
  const selectedRegion = pickRandomCandidate(candidateRegions, options.random) ?? null;

  return {
    selectedRegion,
    highFrequencyRegions,
    candidateRegions,
    hasRecentRegionEvidence: highFrequencyRegions.length > 0,
  };
}

export function buildRecentHighFrequencyRegions(
  records: WatchHistoryRecord[],
  nowMs = Date.now(),
): CrossRegionHighFrequencyRegion[] {
  const cutoffMs = nowMs - CROSS_REGION_WINDOW_DAYS * DAY_MS;
  const counts = new Map<number, CrossRegionHighFrequencyRegion>();
  const countedVideoRidPairs = new Set<string>();

  for (const record of records) {
    if (!isValidCrossRegionWatchRecord(record)) continue;
    const watchedAtMs = toEpochMs(record.viewAt);
    if (watchedAtMs < cutoffMs || watchedAtMs > nowMs) continue;
    if (!isPositiveRecord(record)) continue;

    for (const signal of getRecordRegionSignals(record)) {
      const pairKey = `${record.bvid}:${signal.rid}`;
      if (countedVideoRidPairs.has(pairKey)) continue;
      countedVideoRidPairs.add(pairKey);
      const existing = counts.get(signal.rid);
      counts.set(signal.rid, {
        rid: signal.rid,
        regionName: existing?.regionName ?? signal.regionName,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  return [...counts.values()]
    .filter(region => region.count >= CROSS_REGION_HIGH_FREQUENCY_THRESHOLD)
    .sort((a, b) => b.count - a.count || a.rid - b.rid)
    .slice(0, CROSS_REGION_HIGH_FREQUENCY_LIMIT);
}

export async function fetchCreatorArchiveCandidatePool(
  creators: FollowedCreator[],
  options: CreatorArchiveCandidateOptions = {},
): Promise<CreatorArchiveCandidatePool> {
  const nowMs = options.nowMs ?? Date.now();
  const selectedSeeds = selectCreatorArchiveSeeds(creators, {
    seedLimit: options.seedLimit ?? CREATOR_ARCHIVE_SEED_LIMIT,
    random: options.random,
  });

  if (selectedSeeds.length === 0) {
    return {
      status: 'no_followed_creator',
      sourceLabel: CREATOR_ARCHIVE_SOURCE_LABEL,
      seedCount: 0,
      candidates: [],
      evidence: ['本地尚无已同步的已关注 UP 快照，暂时不能请求公开较早投稿。'],
      failures: [],
      checkedCreatorCount: 0,
      excludedRecentSubmissionCount: 0,
      excludedInvalidCandidateCount: 0,
    };
  }

  const cutoffSeconds = Math.floor((nowMs - CREATOR_ARCHIVE_RECENT_BLOCK_DAYS * DAY_MS) / 1000);
  const candidatesByBvid = new Map<string, ExperimentVideoCandidate>();
  const failures: string[] = [];
  let excludedRecentSubmissionCount = 0;
  let excludedInvalidCandidateCount = 0;
  const { biliGet } = await import('./client.ts');

  for (const seed of selectedSeeds) {
    try {
      const data = await biliGet<SpaceArchiveResponse>(
        CREATOR_ARCHIVE_ENDPOINT,
        {
          mid: String(seed.mid),
          pn: '1',
          ps: String(options.pageSize ?? CREATOR_ARCHIVE_PAGE_SIZE),
          order: 'pubdate',
          tid: '0',
        },
        2,
        true,
        options.signal,
      );
      for (const item of getSpaceArchives(data)) {
        const candidate = toCreatorArchiveCandidate(item, seed);
        if (!candidate) {
          excludedInvalidCandidateCount += 1;
          continue;
        }
        if (!candidate.pubtime || candidate.pubtime >= cutoffSeconds) {
          excludedRecentSubmissionCount += 1;
          continue;
        }
        if (!candidatesByBvid.has(candidate.bvid)) {
          candidatesByBvid.set(candidate.bvid, candidate);
        }
      }
    } catch (error) {
      failures.push(`${seed.name}: ${readableCandidateError(error)}`);
    }
  }

  const candidates = [...candidatesByBvid.values()];
  if (candidates.length > 0) {
    return {
      status: 'ready',
      sourceLabel: CREATOR_ARCHIVE_SOURCE_LABEL,
      seedCount: selectedSeeds.length,
      candidates,
      evidence: [
        `本轮从已同步关注快照中选取 ${selectedSeeds.length} 位 UP，只请求每位 UP 的公开投稿第一页。`,
        `已排除最近 ${CREATOR_ARCHIVE_RECENT_BLOCK_DAYS} 天投稿 ${excludedRecentSubmissionCount} 条，避免和动态账单的新投稿重复。`,
        `公开较早投稿候选池留下 ${candidates.length} 条可打开视频。`,
      ],
      failures,
      checkedCreatorCount: selectedSeeds.length,
      excludedRecentSubmissionCount,
      excludedInvalidCandidateCount,
    };
  }

  return {
    status: 'empty',
    sourceLabel: CREATOR_ARCHIVE_SOURCE_LABEL,
    seedCount: selectedSeeds.length,
    candidates: [],
    evidence: [
      `本轮从已同步关注快照中选取 ${selectedSeeds.length} 位 UP，只请求每位 UP 的公开投稿第一页。`,
      `已排除最近 ${CREATOR_ARCHIVE_RECENT_BLOCK_DAYS} 天投稿 ${excludedRecentSubmissionCount} 条，避免和动态账单的新投稿重复。`,
      '这次没有留下可打开的公开较早投稿。',
    ],
    failures,
    checkedCreatorCount: selectedSeeds.length,
    excludedRecentSubmissionCount,
    excludedInvalidCandidateCount,
  };
}

export function buildCreatorArchiveSourceFailure(
  creators: FollowedCreator[],
  _nowMs: number,
  error: unknown,
  options: { random?: BlindBoxRandomSource } = {},
): CreatorArchiveCandidatePool {
  const selectedSeeds = selectCreatorArchiveSeeds(creators, {
    seedLimit: CREATOR_ARCHIVE_SEED_LIMIT,
    random: options.random,
  });
  return {
    status: selectedSeeds.length > 0 ? 'empty' : 'no_followed_creator',
    sourceLabel: CREATOR_ARCHIVE_SOURCE_LABEL,
    seedCount: selectedSeeds.length,
    candidates: [],
    evidence: selectedSeeds.length > 0
      ? [
        `本轮从已同步关注快照中选取 ${selectedSeeds.length} 位 UP。`,
        '这次没有留下可打开的公开较早投稿。',
      ]
      : ['本地尚无已同步的已关注 UP 快照，暂时不能请求公开较早投稿。'],
    failures: selectedSeeds.map(seed => `${seed.name}: ${readableCandidateError(error)}`),
    checkedCreatorCount: 0,
    excludedRecentSubmissionCount: 0,
    excludedInvalidCandidateCount: 0,
  };
}

export function selectCreatorArchiveSeeds(
  creators: FollowedCreator[],
  options: { seedLimit?: number; random?: BlindBoxRandomSource } = {},
): CreatorArchiveSeed[] {
  const seedLimit = clampPositive(options.seedLimit, CREATOR_ARCHIVE_SEED_LIMIT);
  const activeCreators = creators
    .filter(creator => creator.isActive !== false && positiveNumber(creator.mid))
    .map(creator => ({
      mid: creator.mid,
      name: cleanText(creator.name) || `UP ${creator.mid}`,
      weightKey: `${creator.lastSeenAt || creator.syncedAt || creator.followedAt || 0}:${creator.mid}`,
    }))
    .sort((a, b) => a.weightKey.localeCompare(b.weightKey, 'en'));

  if (activeCreators.length <= seedLimit) {
    return activeCreators.map(({ mid, name }) => ({ mid, name }));
  }

  const rotated = [...activeCreators];
  const offset = Math.floor(clampRandom(options.random?.() ?? Math.random()) * rotated.length);
  return [
    ...rotated.slice(offset),
    ...rotated.slice(0, offset),
  ].slice(0, seedLimit).map(({ mid, name }) => ({ mid, name }));
}

function toRelatedFailure(
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
    cover: normalizeImageUrl(item.pic || item.cover43),
    duration: positiveNumber(item.duration),
    pubtime: positiveNumber(item.pubdate) ?? positiveNumber(item.ctime),
    tagName: cleanText(item.tname),
    url: buildVideoUrl(bvid),
  };
}

function buildCrossRegionSelectionEvidence(
  selection: CrossRegionSelection,
  candidateCount: number,
): string[] {
  const selectedRegionName = selection.selectedRegion?.regionName ?? '无可用分区';
  const highFrequencyText = selection.highFrequencyRegions.length > 0
    ? selection.highFrequencyRegions.map(region => `${region.regionName} ${region.count} 次`).join('、')
    : '';
  const basis = selection.hasRecentRegionEvidence
    ? `最近最多 ${CROSS_REGION_WINDOW_DAYS} 天有效观看中，高频分区是：${highFrequencyText}；本轮从这些分区之外随机选择「${selectedRegionName}」。`
    : `最近最多 ${CROSS_REGION_WINDOW_DAYS} 天没有达到门槛的高频分区证据，本轮从固定公开分区目录随机选择「${selectedRegionName}」。`;
  return [
    basis,
    `跨区漫游只使用仓库维护的固定公开分区目录和 B 站分区新视频接口，本轮候选分区为「${selectedRegionName}」。`,
    `真实候选池返回 ${candidateCount} 条可打开视频；本切片不使用最近抽取记录去重，也不改用本地历史或收藏补位。`,
  ];
}

function getRecordRegionSignals(record: WatchHistoryRecord): RegionSignal[] {
  const signals = [
    toRegionSignal(record.tagName),
    ...(record.tags ?? []).map(tag => toRegionSignal(tag)),
  ].filter((signal): signal is RegionSignal => Boolean(signal));
  const result: RegionSignal[] = [];
  const seen = new Set<number>();
  for (const signal of signals) {
    if (seen.has(signal.rid)) continue;
    seen.add(signal.rid);
    result.push(signal);
  }
  return result;
}

function toRegionSignal(rawLabel: string | undefined): RegionSignal | null {
  const label = cleanText(rawLabel);
  if (!label) return null;
  const region = resolveRegion(label);
  if (!region) return null;
  return {
    rid: region.rid,
    regionName: region.regionName,
  };
}

function resolveRegion(label: string): PublicRegion | null {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;
  for (const mapping of REGION_MAPPINGS) {
    for (const candidate of mapping.labels.map(normalizeLabel)) {
      if (normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized)) {
        return mapping;
      }
    }
  }
  return null;
}

function getRegionArchives(data: BiliRegionResponse): BiliRegionArchive[] {
  if (Array.isArray(data.archives)) return data.archives;
  return [];
}

async function requestCrossRegionCandidates(
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<BiliRegionResponse> {
  const { biliGet } = await import('./client.ts');
  return biliGet<BiliRegionResponse>(endpoint, params, 2, false, signal);
}

function toRegionVideoCandidate(
  archive: BiliRegionArchive,
  region: PublicRegion,
): ExperimentVideoCandidate | null {
  const bvid = cleanText(archive.bvid);
  const title = stripHtml(cleanText(archive.title));
  if (!isLikelyBvid(bvid) || !title) return null;
  return {
    bvid,
    avid: positiveNumber(archive.aid),
    cid: positiveNumber(archive.cid),
    title,
    authorName: cleanText(archive.owner?.name) || cleanText(archive.author) || '未知 UP',
    authorMid: positiveNumber(archive.owner?.mid),
    cover: normalizeImageUrl(archive.pic || archive.cover || archive.first_frame),
    url: buildVideoUrl(bvid),
    duration: positiveNumber(archive.duration),
    pubtime: positiveNumber(archive.pubdate ?? archive.ctime),
    publishedAt: positiveNumber(archive.pubdate ?? archive.ctime),
    tagName: cleanText(archive.tname) || region.regionName,
    sourceKind: 'bili_region_dynamic',
    sourceLabel: `${REGION_SOURCE_LABEL} / ${region.regionName}`,
    regionRid: region.rid,
    regionName: region.regionName,
  };
}

function getSpaceArchives(data: SpaceArchiveResponse): SpaceArchiveItem[] {
  if (Array.isArray(data.archives)) return data.archives;
  if (Array.isArray(data.vlist)) return data.vlist;
  if (Array.isArray(data.list)) return data.list;
  if (data.list && !Array.isArray(data.list) && Array.isArray(data.list.vlist)) return data.list.vlist;
  return [];
}

function toCreatorArchiveCandidate(
  item: SpaceArchiveItem,
  seed: CreatorArchiveSeed,
): ExperimentVideoCandidate | null {
  const bvid = cleanText(item.bvid);
  const title = stripHtml(cleanText(item.title));
  const pubtime = positiveNumber(item.created ?? item.pubdate ?? item.ctime);
  if (!isLikelyBvid(bvid) || !title || !pubtime) return null;

  return {
    bvid,
    avid: positiveNumber(item.aid),
    title,
    authorName: cleanText(item.author) || cleanText(item.owner?.name) || seed.name,
    authorMid: positiveNumber(item.owner?.mid) ?? seed.mid,
    cover: normalizeImageUrl(item.pic || item.cover),
    url: buildVideoUrl(bvid),
    duration: parseDurationValue(item.duration ?? item.length),
    pubtime,
    publishedAt: pubtime,
    tagName: cleanText(item.tname),
    sourceKind: 'bili_space_archive',
    sourceLabel: `${CREATOR_ARCHIVE_SOURCE_LABEL} / ${seed.name}`,
  };
}

function isValidCrossRegionWatchRecord(record: WatchHistoryRecord): boolean {
  return isLikelyBvid(cleanText(record.bvid))
    && Number.isFinite(record.viewAt)
    && record.viewAt > 0
    && Number.isFinite(record.duration)
    && record.duration > 0
    && Number.isFinite(record.progress)
    && record.progress >= 0
    && Number.isFinite(record.actualCompletion)
    && record.actualCompletion >= 0
    && record.actualCompletion <= 1;
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
      title: cleanText(seed.title) || '近期视频',
    });
  }
  return normalized;
}

function isPositiveRecord(record: WatchHistoryRecord): boolean {
  return record.actualCompletion >= POSITIVE_COMPLETION
    || Math.max(0, record.progress) >= Math.min(Math.max(0, record.duration), 900);
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLabel(value: unknown): string {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[\s_\-·/｜|]+/g, '');
}

function toEpochMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function parseDurationValue(value: unknown): number | undefined {
  if (typeof value === 'number') return positiveNumber(value);
  const text = cleanText(value);
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return positiveNumber(Number(text));
  const parts = text.split(':').map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return undefined;
  return positiveNumber(parts.reduce((total, part) => total * 60 + part, 0));
}

function clampPositive(value: unknown, defaultValue: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.max(1, Math.floor(numeric));
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= 1) return 0.999999;
  if (value < 0) return 0;
  return value;
}

export function pickRandomCandidate<T>(
  items: readonly T[],
  random: BlindBoxRandomSource = Math.random,
): T | undefined {
  if (items.length === 0) return undefined;
  const value = random();
  return items[Math.floor(clampRandom(value) * items.length)];
}

function normalizeImageUrl(value: unknown): string {
  const url = cleanText(value);
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

function isLikelyBvid(value: string): boolean {
  return /^BV[0-9A-Za-z]{8,}$/.test(value);
}

function buildVideoUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`;
}

function readableCandidateError(error: unknown): string {
  if (error instanceof Error) return sanitizeCandidateError(error.message);
  if (typeof error === 'string') return sanitizeCandidateError(error);
  try {
    return sanitizeCandidateError(JSON.stringify(error));
  } catch {
    return sanitizeCandidateError(String(error));
  }
}

function sanitizeCandidateError(message: string): string {
  if (/document is not defined|window is not defined|ReferenceError/i.test(message)) {
    return '运行环境暂不支持该候选源';
  }
  if (/RATE_LIMITED|HTTP 412|\b412\b/i.test(message)) {
    return '请求频率受限';
  }
  if (/REQUEST_TIMEOUT|AbortError|timeout/i.test(message)) {
    return '请求超时';
  }
  if (/NOT_LOGGED_IN/i.test(message)) {
    return '登录状态不可用';
  }
  if (/API Error/i.test(message)) {
    return 'B 站接口暂时不可用';
  }
  return '候选源请求失败';
}
