import type {
  ExperimentRealCandidateFailure,
  ExperimentRealCandidatePool,
  ExperimentRealVideoCandidate,
  ExperimentVideoCandidate,
} from '../../shared/types/analytics';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { getHistoryCoverageSpan, type HistoryCoverageSpan } from '../analytics/history-coverage.ts';

const DAY_MS = 86_400_000;
const RELATED_VIDEO_ENDPOINT = '/x/web-interface/archive/related';
const DEFAULT_SEED_LIMIT = 3;
const DEFAULT_PER_SEED_LIMIT = 20;
const DEFAULT_SEED_TIMEOUT_MS = 8_000;

const LONG_WINDOW_DAYS = 180;
const RECENT_WINDOW_DAYS = 30;
const RECENT_VIDEO_BLOCK_DAYS = 90;
const POSITIVE_COMPLETION = 0.75;
const MIN_LONG_POSITIVE_COUNT = 2;
const MAX_REGION_DIRECTIONS = 3;
const REGION_PAGE_SIZE = 20;
const REGION_SOURCE_LABEL = 'B 站分区新视频';

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

export type VarietyRegionCandidatePoolStatus =
  | 'ready'
  | 'insufficient_local_evidence'
  | 'unmapped_interest'
  | 'source_failed'
  | 'empty';

export type VarietyRegionInterestKind = 'category' | 'tag';

export interface VarietyRegionDirection {
  key: string;
  kind: VarietyRegionInterestKind;
  label: string;
  rid: number;
  regionName: string;
  longWatchedCount: number;
  longPositiveCount: number;
  recentWatchedCount: number;
  recentPositiveCount: number;
  expectedRecentPositive: number;
  cooldownRatio: number;
  daysSinceLastWatch: number | null;
  recentHighLabels: string[];
  score: number;
}

export interface VarietyRegionCandidatePool {
  status: VarietyRegionCandidatePoolStatus;
  sourceLabel: string;
  directions: VarietyRegionDirection[];
  candidates: ExperimentVideoCandidate[];
  evidence: string[];
  failureReason?: string;
  checkedRegionCount: number;
  excludedRecentBvidCount: number;
  excludedInvalidCandidateCount: number;
}

interface VarietyRegionCandidateOptions {
  nowMs?: number;
  maxDirections?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

interface InterestSignal {
  key: string;
  kind: VarietyRegionInterestKind;
  label: string;
  rid: number;
  regionName: string;
}

interface RegionMapping {
  rid: number;
  regionName: string;
  labels: string[];
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
  items?: BiliRegionArchive[];
  list?: BiliRegionArchive[];
  result?: BiliRegionArchive[];
}

const REGION_MAPPINGS: RegionMapping[] = [
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

export async function fetchVarietyRegionCandidatePool(
  records: WatchHistoryRecord[],
  options: VarietyRegionCandidateOptions = {},
): Promise<VarietyRegionCandidatePool> {
  const nowMs = options.nowMs ?? Date.now();
  const directions = buildVarietyRegionDirections(records, {
    nowMs,
    maxDirections: options.maxDirections ?? MAX_REGION_DIRECTIONS,
  });

  if (directions.length === 0) {
    return buildNoDirectionPool(records, nowMs);
  }

  const recentBvids = recentWatchedBvids(records, nowMs);
  const candidatesByBvid = new Map<string, ExperimentVideoCandidate>();
  const failures: string[] = [];
  let checkedRegionCount = 0;
  let excludedRecentBvidCount = 0;
  let excludedInvalidCandidateCount = 0;
  const { biliGet } = await import('./client.ts');

  for (const direction of directions) {
    checkedRegionCount += 1;
    try {
      const data = await biliGet<BiliRegionResponse>(
        '/x/web-interface/dynamic/region',
        {
          rid: String(direction.rid),
          pn: '1',
          ps: String(options.pageSize ?? REGION_PAGE_SIZE),
        },
        2,
        false,
        options.signal,
      );
      for (const archive of getRegionArchives(data)) {
        const video = toRegionVideoCandidate(archive, direction);
        if (!video) {
          excludedInvalidCandidateCount += 1;
          continue;
        }
        if (recentBvids.has(video.bvid)) {
          excludedRecentBvidCount += 1;
          continue;
        }
        if (!candidatesByBvid.has(video.bvid)) {
          candidatesByBvid.set(video.bvid, video);
        }
      }
    } catch (error) {
      failures.push(`${direction.regionName}: ${readableCandidateError(error)}`);
    }
  }

  const candidates = [...candidatesByBvid.values()];
  if (candidates.length > 0) {
    return {
      status: 'ready',
      sourceLabel: REGION_SOURCE_LABEL,
      directions,
      candidates,
      evidence: buildDirectionEvidence(directions[0], candidates.length, excludedRecentBvidCount),
      checkedRegionCount,
      excludedRecentBvidCount,
      excludedInvalidCandidateCount,
    };
  }

  const status = failures.length >= checkedRegionCount ? 'source_failed' : 'empty';
  return {
    status,
    sourceLabel: REGION_SOURCE_LABEL,
    directions,
    candidates: [],
    evidence: [
      ...buildDirectionEvidence(directions[0], 0, excludedRecentBvidCount),
      status === 'source_failed'
        ? `分区新视频候选源暂时不可用：${failures.join('；') || '请求失败'}。`
        : '已找到冷却方向，但这次分区新视频候选池没有留下可打开候选。',
    ],
    failureReason: failures.join('；') || undefined,
    checkedRegionCount,
    excludedRecentBvidCount,
    excludedInvalidCandidateCount,
  };
}

export function buildVarietyRegionSourceFailure(
  records: WatchHistoryRecord[],
  nowMs: number,
  error: unknown,
): VarietyRegionCandidatePool {
  const directions = buildVarietyRegionDirections(records, {
    nowMs,
    maxDirections: MAX_REGION_DIRECTIONS,
  });
  return {
    status: 'source_failed',
    sourceLabel: REGION_SOURCE_LABEL,
    directions,
    candidates: [],
    evidence: directions[0]
      ? [
        ...buildDirectionEvidence(directions[0], 0, 0),
        `真实候选源请求失败：${readableCandidateError(error)}。`,
      ]
      : ['本地历史还没有形成可映射到 B 站分区的冷却方向。'],
    failureReason: readableCandidateError(error),
    checkedRegionCount: 0,
    excludedRecentBvidCount: 0,
    excludedInvalidCandidateCount: 0,
  };
}

export function buildVarietyRegionDirections(
  records: WatchHistoryRecord[],
  options: { nowMs?: number; maxDirections?: number } = {},
): VarietyRegionDirection[] {
  const nowMs = options.nowMs ?? Date.now();
  const coverage = getHistoryCoverageSpan(records, nowMs, RECENT_WINDOW_DAYS);
  if (!coverage.hasEnoughForRecentComparison) return [];

  const longCutoffMs = nowMs - LONG_WINDOW_DAYS * DAY_MS;
  const recentCutoffMs = nowMs - RECENT_WINDOW_DAYS * DAY_MS;
  const longRecords = records.filter(record => toEpochMs(record.viewAt) >= longCutoffMs);
  const recentRecords = longRecords.filter(record => toEpochMs(record.viewAt) >= recentCutoffMs);
  const totalLongPositive = Math.max(1, longRecords.filter(isPositiveRecord).length);
  const recentHighLabels = buildRecentHighLabels(recentRecords);
  const recentHighKeys = new Set(recentHighLabels.map(normalizeLabel));
  const groups = new Map<string, { signal: InterestSignal; records: WatchHistoryRecord[] }>();

  for (const record of longRecords) {
    for (const signal of getRecordSignals(record)) {
      const existing = groups.get(signal.key);
      if (existing) {
        existing.records.push(record);
      } else {
        groups.set(signal.key, { signal, records: [record] });
      }
    }
  }

  const directionsByRid = new Map<number, VarietyRegionDirection>();

  for (const group of groups.values()) {
    const positiveRecords = group.records.filter(isPositiveRecord);
    if (positiveRecords.length < MIN_LONG_POSITIVE_COUNT) continue;
    if (recentHighKeys.has(normalizeLabel(group.signal.label))) continue;

    const recentGroupRecords = group.records.filter(record => toEpochMs(record.viewAt) >= recentCutoffMs);
    const recentPositiveRecords = recentGroupRecords.filter(isPositiveRecord);
    const expectedRecentPositive = positiveRecords.length * (RECENT_WINDOW_DAYS / LONG_WINDOW_DAYS);
    const cooldownRatio = expectedRecentPositive > 0
      ? recentPositiveRecords.length / expectedRecentPositive
      : 0;

    if (cooldownRatio > 0.85) continue;

    const lastWatchMs = Math.max(...group.records.map(record => toEpochMs(record.viewAt)));
    const daysSinceLastWatch = lastWatchMs > 0
      ? Math.max(1, Math.floor((nowMs - lastWatchMs) / DAY_MS))
      : null;
    const longPositiveShare = positiveRecords.length / totalLongPositive;
    const cooldownStrength = 1 - Math.min(cooldownRatio, 1);
    const staleBoost = daysSinceLastWatch == null ? 0 : Math.min(daysSinceLastWatch / RECENT_WINDOW_DAYS, 2);
    const score = positiveRecords.length * 8
      + longPositiveShare * 35
      + cooldownStrength * 24
      + staleBoost * 4
      + (group.signal.kind === 'tag' ? 1.5 : 0);

    const direction: VarietyRegionDirection = {
      key: group.signal.key,
      kind: group.signal.kind,
      label: group.signal.label,
      rid: group.signal.rid,
      regionName: group.signal.regionName,
      longWatchedCount: group.records.length,
      longPositiveCount: positiveRecords.length,
      recentWatchedCount: recentGroupRecords.length,
      recentPositiveCount: recentPositiveRecords.length,
      expectedRecentPositive,
      cooldownRatio,
      daysSinceLastWatch,
      recentHighLabels,
      score: Math.round(score * 100) / 100,
    };

    const existing = directionsByRid.get(direction.rid);
    if (!existing || direction.score > existing.score) {
      directionsByRid.set(direction.rid, direction);
    }
  }

  return [...directionsByRid.values()]
    .sort((a, b) => b.score - a.score || a.regionName.localeCompare(b.regionName, 'zh-CN'))
    .slice(0, options.maxDirections ?? MAX_REGION_DIRECTIONS);
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

function buildNoDirectionPool(records: WatchHistoryRecord[], nowMs: number): VarietyRegionCandidatePool {
  const coverage = getHistoryCoverageSpan(records, nowMs, RECENT_WINDOW_DAYS);
  const positiveRecords = records
    .filter(record => toEpochMs(record.viewAt) >= nowMs - LONG_WINDOW_DAYS * DAY_MS)
    .filter(isPositiveRecord);
  const mappedSignalCount = positiveRecords
    .flatMap(record => getRecordSignals(record))
    .length;
  const hasShortHistoryCoverage = !coverage.hasEnoughForRecentComparison;
  const status: VarietyRegionCandidatePoolStatus = hasShortHistoryCoverage || positiveRecords.length < MIN_LONG_POSITIVE_COUNT
    ? 'insufficient_local_evidence'
    : mappedSignalCount === 0
      ? 'unmapped_interest'
      : 'empty';

  return {
    status,
    sourceLabel: REGION_SOURCE_LABEL,
    directions: [],
    candidates: [],
    evidence: [
      hasShortHistoryCoverage
        ? formatShortHistoryCoverageEvidence(coverage)
        : `近 ${LONG_WINDOW_DAYS} 天本地正向观看 ${positiveRecords.length} 条，换口味至少需要 ${MIN_LONG_POSITIVE_COUNT} 条可聚合兴趣证据。`,
      hasShortHistoryCoverage
        ? `本地历史覆盖短于最近 ${RECENT_WINDOW_DAYS} 天对比窗口，暂不把这些记录解释成长期兴趣或冷却方向。`
        : status === 'unmapped_interest'
        ? '本地长期兴趣还不能保守映射到 B 站公开分区，暂不硬凑真实候选。'
        : '没有找到长期相关但近期低频的分区方向，避免从近期高频口味里抽。',
    ],
    checkedRegionCount: 0,
    excludedRecentBvidCount: 0,
    excludedInvalidCandidateCount: 0,
  };
}

function formatShortHistoryCoverageEvidence(coverage: HistoryCoverageSpan): string {
  if (coverage.recordCount === 0) {
    return `本地观看历史目前还没有可用于长期/近期对比的记录，至少需要覆盖最近 ${coverage.requiredDays} 天。`;
  }
  return `本地观看历史目前只覆盖约 ${coverage.spanDays} 天，短于最近 ${coverage.requiredDays} 天对比窗口。`;
}

function buildDirectionEvidence(
  direction: VarietyRegionDirection,
  candidateCount: number,
  excludedRecentBvidCount: number,
): string[] {
  const recentHigh = direction.recentHighLabels.length > 0
    ? direction.recentHighLabels.join('、')
    : '暂无明显高频口味';
  return [
    `长期 ${LONG_WINDOW_DAYS} 天里，「${direction.label}」有 ${direction.longWatchedCount} 条观看、${direction.longPositiveCount} 条正向观看。`,
    `近期 ${RECENT_WINDOW_DAYS} 天里，这个方向正向观看 ${direction.recentPositiveCount} 条；按长期节奏预期约 ${formatCount(direction.expectedRecentPositive)} 条。`,
    `最近高频口味是：${recentHigh}；本次只从冷却方向「${direction.regionName}」分区取新视频候选。`,
    `真实候选池返回 ${candidateCount} 条可打开视频，已排除最近 ${RECENT_VIDEO_BLOCK_DAYS} 天本地看过的同 bvid ${excludedRecentBvidCount} 条。`,
  ];
}

function getRecordSignals(record: WatchHistoryRecord): InterestSignal[] {
  const signals = [
    toInterestSignal('category', record.tagName),
    ...(record.tags ?? []).map(tag => toInterestSignal('tag', tag)),
  ].filter((signal): signal is InterestSignal => Boolean(signal));
  const result: InterestSignal[] = [];
  const seen = new Set<string>();
  for (const signal of signals) {
    if (seen.has(signal.key)) continue;
    seen.add(signal.key);
    result.push(signal);
  }
  return result;
}

function toInterestSignal(kind: VarietyRegionInterestKind, rawLabel: string | undefined): InterestSignal | null {
  const label = cleanText(rawLabel);
  if (!label) return null;
  const region = resolveRegion(label);
  if (!region) return null;
  return {
    key: `${kind}:${normalizeLabel(label)}:${region.rid}`,
    kind,
    label,
    rid: region.rid,
    regionName: region.regionName,
  };
}

function resolveRegion(label: string): RegionMapping | null {
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

function buildRecentHighLabels(records: WatchHistoryRecord[]): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const record of records.filter(isPositiveRecord)) {
    const seenInRecord = new Set<string>();
    for (const signal of getRecordSignals(record)) {
      const key = normalizeLabel(signal.label);
      if (!key || seenInRecord.has(key)) continue;
      seenInRecord.add(key);
      const existing = counts.get(key);
      counts.set(key, {
        label: existing?.label ?? signal.label,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  return [...counts.values()]
    .filter(entry => entry.count >= 2)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
    .slice(0, 3)
    .map(entry => entry.label);
}

function getRegionArchives(data: BiliRegionResponse): BiliRegionArchive[] {
  if (Array.isArray(data.archives)) return data.archives;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.result)) return data.result;
  return [];
}

function toRegionVideoCandidate(
  archive: BiliRegionArchive,
  direction: VarietyRegionDirection,
): ExperimentVideoCandidate | null {
  const bvid = cleanText(archive.bvid);
  if (!isLikelyBvid(bvid)) return null;
  const title = stripHtml(cleanText(archive.title));
  return {
    bvid,
    avid: positiveNumber(archive.aid),
    cid: positiveNumber(archive.cid),
    title: title || bvid,
    authorName: cleanText(archive.owner?.name) || cleanText(archive.author) || '未知 UP',
    authorMid: positiveNumber(archive.owner?.mid),
    cover: normalizeImageUrl(archive.pic || archive.cover || archive.first_frame),
    url: buildVideoUrl(bvid),
    duration: positiveNumber(archive.duration),
    pubtime: positiveNumber(archive.pubdate ?? archive.ctime),
    publishedAt: positiveNumber(archive.pubdate ?? archive.ctime),
    tagName: cleanText(archive.tname) || direction.label,
    sourceKind: 'bili_region_dynamic',
    sourceLabel: `${REGION_SOURCE_LABEL} / ${direction.regionName}`,
    regionRid: direction.rid,
    regionName: direction.regionName,
    cooldownLabel: direction.label,
  };
}

function recentWatchedBvids(records: WatchHistoryRecord[], nowMs: number): Set<string> {
  const cutoffMs = nowMs - RECENT_VIDEO_BLOCK_DAYS * DAY_MS;
  return new Set(
    records
      .filter(record => toEpochMs(record.viewAt) >= cutoffMs)
      .map(record => cleanText(record.bvid))
      .filter(Boolean),
  );
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

function clampPositive(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
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

function formatCount(value: number): string {
  return String(Math.round(value * 10) / 10);
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
