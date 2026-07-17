import type {
  ExperimentBlindBox,
  ExperimentBlindBoxId,
  ExperimentData,
  ExperimentRealCandidatePool,
  ExperimentVideoCandidate,
} from '../../shared/types/analytics';
import type { FavoriteItem, SmartFavoriteIndex } from '../../shared/types/favorite';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import {
  buildCreatorArchiveSourceFailure,
  buildCrossRegionSourceFailure,
  buildRelatedVideoSourceFailure,
  fetchCreatorArchiveCandidatePool,
  fetchCrossRegionCandidatePool,
  fetchRelatedVideoCandidates,
  pickRandomCandidate,
} from '../api/video-blind-box-candidates.ts';
import type {
  BlindBoxRandomSource,
  CreatorArchiveCandidatePool,
  CrossRegionCandidatePool,
  RelatedVideoCandidateOptions,
  RelatedVideoSeed,
} from '../api/video-blind-box-candidates.ts';
import { db } from '../storage/db.ts';
import { getFavoriteItems, getSmartFavoriteIndexMap } from '../storage/favorite-repo.ts';

const DAY_MS = 86_400_000;
const RECENT_ACTIVITY_DAYS = 45;
const RECENT_VIDEO_BLOCK_DAYS = 90;
const RANDOM_RELATED_SEED_LIMIT = 3;
const POSITIVE_COMPLETION = 0.75;
const RELATED_CANDIDATE_SOURCE = 'B 站公开视频的相关视频候选池';
const CROSS_REGION_CANDIDATE_SOURCE = 'B 站公开分区新视频候选池';
const LOCAL_FAVORITE_SOURCE = '本地收藏';
const CREATOR_ARCHIVE_CANDIDATE_SOURCE = '已关注 UP 的公开较早投稿';

interface BlindBoxContext {
  nowMs: number;
  records: WatchHistoryRecord[];
  favorites: FavoriteItem[];
  smartIndexByItemKey: Map<string, SmartFavoriteIndex>;
  recentRecords: WatchHistoryRecord[];
  recentTopTags: string[];
  recentAuthorMids: Set<number>;
  recentBvids: Set<string>;
  watchCountByBvid: Map<string, number>;
  lastWatchByBvid: Map<string, number>;
  usedBvids: Set<string>;
  random: BlindBoxRandomSource;
  randomExplorePool?: ExperimentRealCandidatePool;
  crossRegionPool?: CrossRegionCandidatePool;
  creatorArchivePool?: CreatorArchiveCandidatePool;
}

interface ExperimentBuildOptions {
  random?: BlindBoxRandomSource;
  randomExplorePool?: ExperimentRealCandidatePool;
  crossRegionPool?: CrossRegionCandidatePool;
  creatorArchivePool?: CreatorArchiveCandidatePool;
}

interface ExperimentRuntimeOptions {
  random?: BlindBoxRandomSource;
}

export type RelatedVideoCandidateRequest = (
  seeds: RelatedVideoSeed[],
  options?: RelatedVideoCandidateOptions,
) => Promise<ExperimentRealCandidatePool>;

type BlindBoxBoundaryMeta = Pick<
  ExperimentBlindBox,
  'candidateSource' | 'realCandidateLabel' | 'usesRealBilibiliCandidates'
>;

export async function getExperimentData(options: ExperimentRuntimeOptions = {}): Promise<ExperimentData> {
  const nowMs = Date.now();
  const random = options.random ?? Math.random;
  const [records, favorites, smartIndexByItemKey, followedCreators] = await Promise.all([
    db.watchHistory.toArray(),
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
    db.followedCreators.toArray().then(creators => creators.filter(creator => creator.isActive !== false)),
  ]);
  const [randomExplorePool, crossRegionPool, creatorArchivePool] = await Promise.all([
    fetchRandomExploreCandidatePool(records, nowMs),
    fetchCrossRegionCandidatePool(records, { nowMs, random })
      .catch(error => buildCrossRegionSourceFailure(records, nowMs, error, { random })),
    fetchCreatorArchiveCandidatePool(followedCreators, { nowMs, random })
      .catch(error => buildCreatorArchiveSourceFailure(followedCreators, nowMs, error, { random })),
  ]);

  return buildExperimentData(records, favorites, smartIndexByItemKey, nowMs, {
    random,
    randomExplorePool,
    crossRegionPool,
    creatorArchivePool,
  });
}

export async function fetchRandomExploreCandidatePool(
  records: WatchHistoryRecord[],
  nowMs: number,
  request: RelatedVideoCandidateRequest = fetchRelatedVideoCandidates,
): Promise<ExperimentRealCandidatePool> {
  const seeds = selectRelatedVideoSeeds(records, nowMs);
  const requestOptions = { seedLimit: RANDOM_RELATED_SEED_LIMIT };
  if (seeds.length === 0) {
    return buildRelatedVideoSourceFailure(seeds, null, requestOptions);
  }

  try {
    return await request(seeds, requestOptions);
  } catch (error) {
    return buildRelatedVideoSourceFailure(seeds, error, requestOptions);
  }
}

export function buildExperimentData(
  records: WatchHistoryRecord[],
  favorites: FavoriteItem[],
  smartIndexByItemKey: Map<string, SmartFavoriteIndex>,
  nowMs = Date.now(),
  optionsOrRandomPool: ExperimentBuildOptions | ExperimentRealCandidatePool = {},
): ExperimentData {
  const options = normalizeExperimentBuildOptions(optionsOrRandomPool);
  const recentCutoffMs = nowMs - RECENT_ACTIVITY_DAYS * DAY_MS;
  const recentRecords = records.filter(record => toEpochMs(record.viewAt) >= recentCutoffMs);

  const ctx: BlindBoxContext = {
    nowMs,
    records,
    favorites,
    smartIndexByItemKey,
    recentRecords,
    recentTopTags: topLabels(recentRecords.map(record => record.tagName), 3),
    recentAuthorMids: new Set(recentRecords.map(record => record.authorMid).filter(mid => mid > 0)),
    recentBvids: new Set(
      records
        .filter(record => toEpochMs(record.viewAt) >= nowMs - RECENT_VIDEO_BLOCK_DAYS * DAY_MS)
        .map(record => record.bvid)
        .filter(Boolean),
    ),
    watchCountByBvid: countByBvid(records),
    lastWatchByBvid: buildLastWatchByBvid(records),
    usedBvids: new Set<string>(),
    random: options.random ?? Math.random,
    randomExplorePool: options.randomExplorePool,
    crossRegionPool: options.crossRegionPool,
    creatorArchivePool: options.creatorArchivePool,
  };

  return {
    blindBoxes: [
      buildRandomExploreBox(ctx),
      buildCrossRegionBox(ctx),
      buildHiddenFavoriteBox(ctx),
      buildCreatorArchiveBox(ctx),
    ],
    generatedAt: nowMs,
  };
}

function normalizeExperimentBuildOptions(
  value: ExperimentBuildOptions | ExperimentRealCandidatePool,
): ExperimentBuildOptions {
  if ('sourceKind' in value && 'candidates' in value && 'failures' in value) {
    return { randomExplorePool: value };
  }
  return value;
}

function realCandidateUsedMeta(candidateSource: string): BlindBoxBoundaryMeta {
  return {
    candidateSource,
    realCandidateLabel: '已使用真实 B 站候选',
    usesRealBilibiliCandidates: true,
  };
}

function realCandidateUnavailableMeta(candidateSource: string, reason: string): BlindBoxBoundaryMeta {
  return {
    candidateSource,
    realCandidateLabel: `未使用真实 B 站候选：${reason}`,
    usesRealBilibiliCandidates: false,
  };
}

function localFavoriteMeta(): BlindBoxBoundaryMeta {
  return {
    candidateSource: LOCAL_FAVORITE_SOURCE,
    realCandidateLabel: '未使用真实 B 站候选：这是本地收藏回访。',
    usesRealBilibiliCandidates: false,
  };
}

function buildCrossRegionBox(ctx: BlindBoxContext): ExperimentBlindBox {
  const pool = ctx.crossRegionPool;
  const title = '跨区漫游';
  const teaser = '避开最近高频分区，从公开分区新视频里随机开一条。';

  if (!pool) {
    return emptyBox(
      'cross_region',
      title,
      teaser,
      ['真实候选源尚未返回，暂不使用本地历史或收藏补位。'],
      '分区候选池还没准备好',
      '跨区漫游需要先选择一个公开分区，再从 B 站分区新视频候选池抽取。当前没有拿到候选源结果，所以不显示空卡。',
      '候选源未返回',
      'B 站分区新视频',
      '候选源尚未返回，跨区漫游不会退回本地历史或收藏凑数。',
      realCandidateUnavailableMeta(CROSS_REGION_CANDIDATE_SOURCE, '候选源尚未返回。'),
    );
  }

  if (pool.status !== 'ready' || pool.candidates.length === 0 || !pool.selectedRegion) {
    return emptyBox(
      'cross_region',
      title,
      teaser,
      pool.evidence.length > 0 ? pool.evidence : ['没有留下可解释的真实候选池证据。'],
      crossRegionEmptyTitle(pool.status),
      crossRegionEmptyDescription(pool),
      crossRegionEmptyStatusLabel(pool.status),
      pool.sourceLabel,
      crossRegionEmptyReason(pool),
      realCandidateUnavailableMeta(CROSS_REGION_CANDIDATE_SOURCE, crossRegionRealCandidateUnavailableReason(pool)),
    );
  }

  const candidates = pool.candidates.filter(video => !ctx.usedBvids.has(video.bvid));
  if (candidates.length === 0) {
    return emptyBox(
      'cross_region',
      title,
      teaser,
      [
        ...pool.evidence,
        `真实候选池有 ${pool.candidates.length} 条，但都已被本页其他盲盒占用。`,
      ],
      '本页候选已经用完',
      '跨区漫游不会改用本地历史、收藏或其他盲盒来源。刷新后可重新抽取公开分区候选。',
      '本页候选已占用',
      pool.sourceLabel,
      '真实候选池有结果，但经过本页占用过滤后没有剩余视频。',
      realCandidateUnavailableMeta(CROSS_REGION_CANDIDATE_SOURCE, '候选经过本页占用过滤后没有剩余视频。'),
    );
  }

  const pick = pickRandomCandidate(candidates, ctx.random)!;
  ctx.usedBvids.add(pick.bvid);

  return {
    id: 'cross_region',
    title,
    teaser,
    ...realCandidateUsedMeta(CROSS_REGION_CANDIDATE_SOURCE),
    source: pick.sourceLabel ?? `${pool.sourceLabel} / ${pool.selectedRegion.regionName}`,
    reason: buildCrossRegionReason(pool, pick),
    evidence: [
      ...pool.evidence,
      `这条候选来自公开分区「${pick.regionName ?? pool.selectedRegion.regionName}」，本地只保留打开视频页和展示所需的标题、UP 主、封面、时长等信息。`,
    ],
    state: 'ready',
    statusLabel: '真实候选',
    video: pick,
  };
}

function buildCrossRegionReason(
  pool: CrossRegionCandidatePool,
  video: ExperimentVideoCandidate,
): string {
  const regionName = video.regionName ?? pool.selectedRegion?.regionName ?? '公开分区';
  if (pool.highFrequencyRegions.length === 0) {
    return `最近最多 7 天没有达到门槛的高频分区证据，本轮随机选择 B 站「${regionName}」分区，并从公开新视频候选池里抽取这条视频。`;
  }
  const high = pool.highFrequencyRegions.map(region => region.regionName).join('、');
  return `最近最多 7 天的高频分区是「${high}」，本轮避开这些方向，随机选择 B 站「${regionName}」分区，并从公开新视频候选池里抽取这条视频。`;
}

function crossRegionEmptyTitle(status: CrossRegionCandidatePool['status']): string {
  return status === 'no_available_region'
    ? '本轮没有可漫游的公开分区'
    : '这次没有取得可打开的分区新视频';
}

function crossRegionEmptyDescription(pool: CrossRegionCandidatePool): string {
  if (pool.status === 'no_available_region') {
    return '固定公开分区目录在排除近期高频分区后没有剩余方向，跨区漫游不会退回近期高频分区或其他盲盒来源。';
  }
  return '这次没有取得可打开的分区新视频。刷新后可重试，当前不会改用本地历史、收藏或其他盲盒来源。';
}

function crossRegionEmptyReason(pool: CrossRegionCandidatePool): string {
  return pool.status === 'no_available_region'
    ? '排除近期高频分区后没有剩余公开分区。'
    : '本轮公开分区新视频候选池没有留下可打开视频。';
}

function crossRegionRealCandidateUnavailableReason(pool: CrossRegionCandidatePool): string {
  return pool.status === 'no_available_region'
    ? '排除近期高频分区后没有剩余公开分区。'
    : '本轮没有可打开的分区新视频。';
}

function crossRegionEmptyStatusLabel(status: CrossRegionCandidatePool['status']): string {
  return status === 'no_available_region' ? '无可用分区' : '真实候选为空';
}

function buildHiddenFavoriteBox(ctx: BlindBoxContext): ExperimentBlindBox {
  if (ctx.favorites.length === 0) {
    return emptyBox(
      'hidden_favorite',
      '冷门收藏',
      '从本地收藏里翻出被你压箱底的一条。',
      ['本地收藏 0 条，暂时没有可以翻出来的冷门收藏。'],
      '先同步收藏',
      '这盒只看本地收藏，不会拿外部候选凑数。先把收藏同步进来，再让我帮你翻压箱底。',
      '本地收藏未同步',
      LOCAL_FAVORITE_SOURCE,
      '本地收藏还没有可回访的视频。',
      localFavoriteMeta(),
    );
  }

  const candidates = ctx.favorites
    .map(item => {
      const video = toFavoriteVideo(item);
      if (!video || ctx.usedBvids.has(video.bvid) || ctx.recentBvids.has(video.bvid)) return null;

      const watchCount = ctx.watchCountByBvid.get(video.bvid) ?? 0;
      const lastWatchMs = ctx.lastWatchByBvid.get(video.bvid) ?? 0;
      const favoriteAgeDays = daysSince(item.favTime, ctx.nowMs);
      if (favoriteAgeDays < 30) return null;

      const lastWatchDays = lastWatchMs > 0 ? Math.max(1, Math.floor((ctx.nowMs - lastWatchMs) / DAY_MS)) : null;

      return {
        item,
        video,
        watchCount,
        lastWatchDays,
        favoriteAgeDays,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  if (candidates.length === 0) {
    return emptyBox(
      'hidden_favorite',
      '冷门收藏',
      '从本地收藏里翻出被你压箱底的一条。',
      [`本地收藏 ${ctx.favorites.length} 条，但最近 ${RECENT_VIDEO_BLOCK_DAYS} 天都还比较活跃。`],
      '压箱底的视频还没攒出来',
      '当前收藏里最近都还在看，或者收藏时间太新，暂时没有那种“你留过但快忘了”的冷门收藏。',
      '本地收藏暂不符合',
      LOCAL_FAVORITE_SOURCE,
      '本地收藏里暂时没有足够冷门的回访候选。',
      localFavoriteMeta(),
    );
  }

  const pick = pickRandomCandidate(candidates, ctx.random)!;
  ctx.usedBvids.add(pick.video.bvid);

  return {
    id: 'hidden_favorite',
    title: '冷门收藏',
    teaser: '从本地收藏里翻出被你压箱底的一条。',
    ...localFavoriteMeta(),
    source: `本地收藏 / 收藏夹「${pick.item.folderTitle}」`,
    reason: pick.watchCount === 0
      ? '你把它收进本地收藏后，还没有留下再次观看记录。'
      : `你收藏过它，但本地只看过 ${pick.watchCount} 次，已经沉下去很久了。`,
    evidence: [
      `这条视频收藏于 ${pick.favoriteAgeDays} 天前，来自收藏夹「${pick.item.folderTitle}」。`,
      pick.lastWatchDays == null
        ? '本地没有找到这条视频的再次观看记录。'
        : `本地共记录到 ${pick.watchCount} 次观看，上次观看距今 ${pick.lastWatchDays} 天。`,
      `最近 ${RECENT_VIDEO_BLOCK_DAYS} 天没有再次点开它，所以更像一条真正被压箱底的收藏。`,
    ],
    state: 'ready',
    video: pick.video,
  };
}

function buildCreatorArchiveBox(ctx: BlindBoxContext): ExperimentBlindBox {
  const pool = ctx.creatorArchivePool;
  const title = 'UP 主考古';
  const teaser = '从已关注 UP 的公开较早投稿里随机翻一条。';

  if (!pool) {
    return emptyBox(
      'creator_archive',
      title,
      teaser,
      ['公开投稿候选源尚未返回，不从本地历史或动态账单新投稿补位。'],
      '公开投稿候选池还没准备好',
      'UP 主考古需要先选择少量已关注 UP，再请求公开较早投稿。当前没有拿到候选源结果，所以不显示空卡。',
      '候选源未返回',
      CREATOR_ARCHIVE_CANDIDATE_SOURCE,
      '公开投稿候选源尚未返回，UP 主考古不会退回本地历史凑数。',
      realCandidateUnavailableMeta(CREATOR_ARCHIVE_CANDIDATE_SOURCE, '候选源尚未返回。'),
    );
  }

  if (pool.status !== 'ready' || pool.candidates.length === 0) {
    return emptyBox(
      'creator_archive',
      title,
      teaser,
      pool.evidence.length > 0 ? pool.evidence : ['没有留下可解释的公开投稿候选池证据。'],
      creatorArchiveEmptyTitle(pool.status),
      creatorArchiveEmptyDescription(pool),
      creatorArchiveEmptyStatusLabel(pool.status),
      pool.sourceLabel,
      creatorArchiveEmptyReason(pool),
      realCandidateUnavailableMeta(CREATOR_ARCHIVE_CANDIDATE_SOURCE, creatorArchiveRealCandidateUnavailableReason(pool)),
    );
  }

  const candidates = pool.candidates.filter(video => !ctx.usedBvids.has(video.bvid));
  if (candidates.length === 0) {
    return emptyBox(
      'creator_archive',
      title,
      teaser,
      [
        ...pool.evidence,
        `公开较早投稿候选池有 ${pool.candidates.length} 条，但都已被本页其他盲盒占用。`,
      ],
      '本页候选已经用完',
      'UP 主考古不会改用本地历史、收藏或最近 7 天新投稿。刷新后可重新抽取公开投稿候选。',
      '本页候选已占用',
      pool.sourceLabel,
      '公开较早投稿候选池有结果，但经过本页占用过滤后没有剩余视频。',
      realCandidateUnavailableMeta(CREATOR_ARCHIVE_CANDIDATE_SOURCE, '候选经过本页占用过滤后没有剩余视频。'),
    );
  }

  const pick = pickRandomCandidate(candidates, ctx.random)!;
  ctx.usedBvids.add(pick.bvid);

  return {
    id: 'creator_archive',
    title,
    teaser,
    ...realCandidateUsedMeta(CREATOR_ARCHIVE_CANDIDATE_SOURCE),
    source: pick.sourceLabel ?? pool.sourceLabel,
    reason: `这条来自已关注 UP「${pick.authorName}」的公开较早投稿，已排除最近 7 天新投稿，避免和动态账单重复。`,
    evidence: [
      ...pool.evidence,
      `最终视频《${pick.title}》来自公开 UP 空间投稿候选池，可以直接打开 B 站视频页。`,
    ],
    state: 'ready',
    statusLabel: '真实候选',
    video: pick,
  };
}

function creatorArchiveEmptyTitle(status: CreatorArchiveCandidatePool['status']): string {
  return status === 'no_followed_creator'
    ? '还没有可用于考古的已关注 UP'
    : '这次没有取得可打开的较早投稿';
}

function creatorArchiveEmptyDescription(pool: CreatorArchiveCandidatePool): string {
  if (pool.status === 'no_followed_creator') {
    return '需要先同步关注快照，UP 主考古才知道该从哪些已关注 UP 的公开投稿里抽取。';
  }
  return '这次没有取得可打开的较早投稿。刷新后可重试，当前不会改用本地历史、收藏或最近 7 天新投稿。';
}

function creatorArchiveEmptyReason(pool: CreatorArchiveCandidatePool): string {
  return pool.status === 'no_followed_creator'
    ? '本地没有已同步关注 UP 快照，暂不请求公开投稿。'
    : '本轮公开投稿候选池没有留下可打开的较早投稿。';
}

function creatorArchiveRealCandidateUnavailableReason(pool: CreatorArchiveCandidatePool): string {
  return pool.status === 'no_followed_creator'
    ? '缺少已同步关注 UP 快照。'
    : '本轮没有可打开的较早投稿。';
}

function creatorArchiveEmptyStatusLabel(status: CreatorArchiveCandidatePool['status']): string {
  return status === 'no_followed_creator' ? '关注快照未同步' : '真实候选为空';
}

function buildRandomExploreBox(ctx: BlindBoxContext): ExperimentBlindBox {
  const sourceLabel = '来自相关视频候选';
  const teaser = '只从真实 B 站候选池里随机抽一条，不从本地库存补位。';
  if (!ctx.randomExplorePool || ctx.randomExplorePool.seedCount === 0) {
    return emptyBox(
      'random_explore',
      '随机探索',
      teaser,
      ['本地还没有可作为公开相关视频候选种子的近期视频。'],
      '当前没有可用于探索的近期视频',
      '随机探索需要先用最近少量本地历史作为种子，请求 B 站公开视频的相关视频候选池。当前没有合格种子，因此没有发出相关候选请求。',
      '候选源未准备好',
      sourceLabel,
      '没有可请求的种子，未生成空白视频卡。',
      realCandidateUnavailableMeta(RELATED_CANDIDATE_SOURCE, '缺少可请求的本地近期视频。'),
    );
  }

  const pool = ctx.randomExplorePool.candidates
    .filter(candidate => !ctx.usedBvids.has(candidate.bvid) && !ctx.recentBvids.has(candidate.bvid));

  if (pool.length === 0) {
    const failureSummary = formatRelatedCandidateFailures(ctx.randomExplorePool);
    return emptyBox(
      'random_explore',
      '随机探索',
      teaser,
      [
        `已尝试 ${ctx.randomExplorePool.seedCount} 个种子视频的相关视频候选。`,
        failureSummary,
        `同时会排除最近 ${RECENT_VIDEO_BLOCK_DAYS} 天看过的视频和本页其它盲盒已占用的视频。`,
      ],
      '相关视频候选暂时不可用',
      '这次没有拿到可安全展示的真实候选，Bili-Bill 不会用本地库存视频冒充随机探索候选。',
      '候选源暂不可用',
      sourceLabel,
      '真实候选源失败或为空，未生成空白视频卡。',
      realCandidateUnavailableMeta(RELATED_CANDIDATE_SOURCE, '候选源失败、为空或过滤后无可打开视频。'),
    );
  }

  const pick = pickRandomCandidate(pool, ctx.random)!;
  ctx.usedBvids.add(pick.bvid);

  return {
    id: 'random_explore',
    title: '随机探索',
    teaser,
    ...realCandidateUsedMeta(RELATED_CANDIDATE_SOURCE),
    source: `${sourceLabel} / 种子视频「${pick.seedTitle || pick.seedBvid}」`,
    reason: `Bili-Bill 只保留可打开的公开相关视频候选，并在 ${pool.length} 条候选里随机抽取一条；不会从本地历史或收藏库存补位。`,
    evidence: [
      `候选来自 B 站公开视频的相关视频候选池，使用 ${ctx.randomExplorePool.seedCount} 个本地种子视频逐个请求。`,
      `抽取前已排除最近 ${RECENT_VIDEO_BLOCK_DAYS} 天看过的视频，以及其它盲盒已经占用的候选。`,
      `本次种子视频：${pick.seedTitle || pick.seedBvid}。`,
    ],
    state: 'ready',
    video: pick,
  };
}

export function selectRelatedVideoSeeds(records: WatchHistoryRecord[], nowMs: number): RelatedVideoSeed[] {
  const recentCutoffMs = nowMs - RECENT_VIDEO_BLOCK_DAYS * DAY_MS;
  const seeds: RelatedVideoSeed[] = [];
  const seen = new Set<string>();
  const sortedRecords = [...records]
    .filter(record => {
      if (record.business !== 'archive' || !isLikelyBvid(cleanText(record.bvid))) return false;
      const watchedAt = toEpochMs(record.viewAt);
      return watchedAt >= recentCutoffMs && watchedAt <= nowMs;
    })
    .sort((a, b) => toEpochMs(b.viewAt) - toEpochMs(a.viewAt));

  for (const record of sortedRecords) {
    const bvid = cleanText(record.bvid);
    if (seen.has(bvid)) continue;
    seen.add(bvid);
    seeds.push({
      bvid,
      title: cleanText(record.title) || '近期视频',
    });
    if (seeds.length >= RANDOM_RELATED_SEED_LIMIT) break;
  }

  return seeds;
}

function formatRelatedCandidateFailures(pool: ExperimentRealCandidatePool): string {
  if (pool.candidates.length > 0) {
    return `相关视频候选返回 ${pool.candidates.length} 条，但都已被近期观看、重复候选或其它盲盒占用。`;
  }
  if (pool.failures.length === 0) {
    return '相关视频候选没有返回可展示的视频。';
  }

  const counts = pool.failures.reduce<Record<string, number>>((acc, failure) => {
    acc[failure.reason] = (acc[failure.reason] ?? 0) + 1;
    return acc;
  }, {});
  const parts = [
    counts.request_failed ? `请求失败 ${counts.request_failed} 个` : '',
    counts.empty_response ? `空响应 ${counts.empty_response} 个` : '',
    counts.no_valid_candidates ? `无可打开候选 ${counts.no_valid_candidates} 个` : '',
  ].filter(Boolean);

  return `相关视频候选暂不可用：${parts.join('，') || '未返回有效候选'}。`;
}

function emptyBox(
  id: ExperimentBlindBoxId,
  title: string,
  teaser: string,
  evidence: string[],
  emptyTitle: string,
  emptyDescription: string,
  statusLabel?: string,
  source?: string,
  reason?: string,
  boundaryMeta: BlindBoxBoundaryMeta = realCandidateUnavailableMeta('候选源', '当前没有可用候选。'),
): ExperimentBlindBox {
  return {
    id,
    title,
    teaser,
    ...boundaryMeta,
    source: source ?? '仅使用本地历史 / 本地收藏',
    reason: reason ?? '这盒没有足够的本地证据，不会拿泛泛建议来凑数。',
    evidence,
    state: 'empty',
    statusLabel,
    emptyTitle,
    emptyDescription,
  };
}

function toFavoriteVideo(item: FavoriteItem): ExperimentVideoCandidate | null {
  if (!cleanText(item.bvid)) return null;
  return {
    bvid: item.bvid,
    avid: item.avid > 0 ? item.avid : undefined,
    title: cleanText(item.title) || '未命名收藏视频',
    authorName: cleanText(item.authorName) || '未知 UP',
    cover: cleanText(item.cover),
    url: buildVideoUrl(item.bvid, item.avid),
    sourceKind: 'local_favorite',
  };
}

function countByBvid(records: WatchHistoryRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const bvid = cleanText(record.bvid);
    if (!bvid) continue;
    counts.set(bvid, (counts.get(bvid) ?? 0) + 1);
  }
  return counts;
}

function buildLastWatchByBvid(records: WatchHistoryRecord[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const record of records) {
    const bvid = cleanText(record.bvid);
    if (!bvid) continue;
    const watchedAt = toEpochMs(record.viewAt);
    if (watchedAt > (latest.get(bvid) ?? 0)) {
      latest.set(bvid, watchedAt);
    }
  }
  return latest;
}

function topLabels(labels: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const label of labels.map(cleanText).filter(Boolean)) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, limit)
    .map(([label]) => label);
}

function isPositiveRecord(record: WatchHistoryRecord): boolean {
  return record.actualCompletion >= POSITIVE_COMPLETION
    || Math.max(0, record.progress) >= Math.min(Math.max(0, record.duration), 900);
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyBvid(value: string): boolean {
  return /^BV[0-9A-Za-z]{8,}$/.test(value);
}

function toEpochMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function daysSince(value: number, nowMs: number): number {
  const timestamp = toEpochMs(value);
  if (timestamp <= 0) return 0;
  return Math.max(1, Math.floor((nowMs - timestamp) / DAY_MS));
}

function buildVideoUrl(bvid: string, avid?: number): string {
  if (cleanText(bvid)) return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`;
  if (typeof avid === 'number' && avid > 0) return `https://www.bilibili.com/video/av${encodeURIComponent(String(avid))}`;
  return 'https://www.bilibili.com';
}
