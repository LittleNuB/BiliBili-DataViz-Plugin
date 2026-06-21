import type {
  ExperimentBlindBox,
  ExperimentBlindBoxId,
  ExperimentData,
  ExperimentRealCandidatePool,
  ExperimentVideoCandidate,
} from '../../shared/types/analytics';
import type { FavoriteItem, SmartFavoriteIndex } from '../../shared/types/favorite';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type {
  RelatedVideoSeed,
  VarietyRegionCandidatePool,
  VarietyRegionDirection,
} from '../api/video-blind-box-candidates.ts';
import { db } from '../storage/db.ts';
import { getFavoriteItems, getSmartFavoriteIndexMap } from '../storage/favorite-repo.ts';

const DAY_MS = 86_400_000;
const RECENT_ACTIVITY_DAYS = 45;
const RECENT_VIDEO_BLOCK_DAYS = 90;
const RANDOM_RELATED_SEED_LIMIT = 3;
const VARIETY_LONG_WINDOW_DAYS = 180;
const VARIETY_RECENT_WINDOW_DAYS = 30;
const MIN_INTEREST_RECORDS = 4;
const MIN_INTEREST_POSITIVE_RECORDS = 2;
const POSITIVE_COMPLETION = 0.75;
const RELATED_CANDIDATE_SOURCE = 'B 站公开视频的相关视频候选池';
const REGION_CANDIDATE_SOURCE = 'B 站公开分区新视频候选池';
const LOCAL_FAVORITE_SOURCE = '本地收藏';
const LOCAL_HISTORY_REVIEW_SOURCE = '本地观看历史';

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
  randomExplorePool?: ExperimentRealCandidatePool;
  varietyRegionPool?: VarietyRegionCandidatePool;
}

interface ExperimentBuildOptions {
  randomExplorePool?: ExperimentRealCandidatePool;
  varietyRegionPool?: VarietyRegionCandidatePool;
}

type BlindBoxBoundaryMeta = Pick<
  ExperimentBlindBox,
  'candidateSource' | 'realCandidateLabel' | 'usesRealBilibiliCandidates'
>;

export async function getExperimentData(): Promise<ExperimentData> {
  const nowMs = Date.now();
  const [records, favorites, smartIndexByItemKey] = await Promise.all([
    db.watchHistory.toArray(),
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
  ]);
  const {
    fetchRelatedVideoCandidates,
    fetchVarietyRegionCandidatePool,
    buildVarietyRegionSourceFailure,
  } = await import('../api/video-blind-box-candidates.ts');

  const [randomExplorePool, varietyRegionPool] = await Promise.all([
    fetchRelatedVideoCandidates(
      selectRelatedVideoSeeds(records, nowMs),
      { seedLimit: RANDOM_RELATED_SEED_LIMIT },
    ),
    fetchVarietyRegionCandidatePool(records, { nowMs })
      .catch(error => buildVarietyRegionSourceFailure(records, nowMs, error)),
  ]);

  return buildExperimentData(records, favorites, smartIndexByItemKey, nowMs, {
    randomExplorePool,
    varietyRegionPool,
  });
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
    randomExplorePool: options.randomExplorePool,
    varietyRegionPool: options.varietyRegionPool,
  };

  return {
    blindBoxes: [
      buildVarietyBox(ctx),
      buildHiddenFavoriteBox(ctx),
      buildReviveInterestBox(ctx),
      buildRandomExploreBox(ctx),
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

function localHistoryReviewMeta(): BlindBoxBoundaryMeta {
  return {
    candidateSource: LOCAL_HISTORY_REVIEW_SOURCE,
    realCandidateLabel: '未使用真实 B 站候选：这是本地历史回顾。',
    usesRealBilibiliCandidates: false,
  };
}

function buildVarietyBox(ctx: BlindBoxContext): ExperimentBlindBox {
  const title = '换口味';
  const teaser = '从长期兴趣里找一条近期少看的真实 B 站新视频。';
  const pool = ctx.varietyRegionPool;

  if (!pool) {
    return emptyBox(
      'variety',
      title,
      teaser,
      ['真实候选源尚未返回，暂不使用本地收藏冒充候选全集。'],
      '真实候选池还没准备好',
      '换口味需要先根据本地长期兴趣选择冷却分区，再从 B 站分区新视频候选池抽取。当前没有拿到候选源结果，所以不显示空卡。',
      '候选源未返回',
      'B 站分区新视频',
      '真实候选源尚未返回，换口味不会退回本地收藏夹凑数。',
      realCandidateUnavailableMeta(REGION_CANDIDATE_SOURCE, '候选源尚未返回。'),
    );
  }

  if (pool.status !== 'ready' || pool.candidates.length === 0 || pool.directions.length === 0) {
    return emptyBox(
      'variety',
      title,
      teaser,
      pool.evidence.length > 0 ? pool.evidence : ['没有留下可解释的真实候选池证据。'],
      varietyEmptyTitle(pool.status),
      varietyEmptyDescription(pool),
      varietyEmptyStatusLabel(pool.status),
      pool.sourceLabel,
      varietyEmptyReason(pool),
      realCandidateUnavailableMeta(REGION_CANDIDATE_SOURCE, varietyRealCandidateUnavailableReason(pool)),
    );
  }

  const candidates = pool.candidates.filter(video => !ctx.usedBvids.has(video.bvid) && !ctx.recentBvids.has(video.bvid));
  if (candidates.length === 0) {
    return emptyBox(
      'variety',
      title,
      teaser,
      [
        ...pool.evidence,
        `真实候选池有 ${pool.candidates.length} 条，但都已被本页其他盲盒占用或在本地最近 ${RECENT_VIDEO_BLOCK_DAYS} 天看过。`,
      ],
      '候选都被近期记录挡住了',
      '换口味不会从近期已经看过的视频里硬抽，也不会退回本地收藏夹凑数。稍后刷新或等分区新视频更新后再试。',
      '候选已冷却过滤',
      pool.sourceLabel,
      '真实候选池有结果，但经过近期观看和本页占用过滤后没有剩余视频。',
      realCandidateUnavailableMeta(REGION_CANDIDATE_SOURCE, '候选经过近期过滤后没有剩余视频。'),
    );
  }

  const pick = candidates[stableHash(`${Math.floor(ctx.nowMs / DAY_MS)}:${pool.directions[0].rid}:${candidates.length}`) % candidates.length];
  const direction = pool.directions.find(item => item.rid === pick.regionRid) ?? pool.directions[0];
  ctx.usedBvids.add(pick.bvid);

  return {
    id: 'variety',
    title,
    teaser,
    ...realCandidateUsedMeta(REGION_CANDIDATE_SOURCE),
    source: pick.sourceLabel ?? `${pool.sourceLabel} / ${direction.regionName}`,
    reason: buildVarietyReason(direction, pick),
    evidence: [
      ...buildVarietyReadyEvidence(direction, pick, pool),
      `这条候选来自公开分区「${pick.regionName ?? direction.regionName}」，Bili-Bill 只保留 bvid、标题、UP、封面、时长和播放页链接用于展示。`,
      '本地历史和收藏只参与选择冷却方向与解释，不作为本次换口味的候选全集。',
    ],
    state: 'ready',
    statusLabel: '真实候选',
    video: pick,
  };
}

function buildVarietyReason(
  direction: VarietyRegionDirection,
  video: ExperimentVideoCandidate,
): string {
  const recentHigh = direction.recentHighLabels.length > 0
    ? direction.recentHighLabels.join('、')
    : '暂无明显高频口味';
  return `你长期看过「${direction.label}」，但最近 ${VARIETY_RECENT_WINDOW_DAYS} 天这个方向正向观看 ${direction.recentPositiveCount} 次，低于长期 ${VARIETY_LONG_WINDOW_DAYS} 天节奏；这条来自 B 站「${video.regionName ?? direction.regionName}」分区新视频候选，和最近高频的「${recentHigh}」拉开距离。`;
}

function buildVarietyReadyEvidence(
  direction: VarietyRegionDirection,
  video: ExperimentVideoCandidate,
  pool: VarietyRegionCandidatePool,
): string[] {
  const recentHigh = direction.recentHighLabels.length > 0
    ? direction.recentHighLabels.join('、')
    : '暂无明显高频口味';
  return [
    `长期 ${VARIETY_LONG_WINDOW_DAYS} 天里，「${direction.label}」有 ${direction.longWatchedCount} 条观看、${direction.longPositiveCount} 条正向观看。`,
    `近期 ${VARIETY_RECENT_WINDOW_DAYS} 天里，这个方向正向观看 ${direction.recentPositiveCount} 条；按长期节奏预期约 ${formatCount(direction.expectedRecentPositive)} 条。`,
    `最近高频口味是：${recentHigh}；本次只从冷却方向「${video.regionName ?? direction.regionName}」分区取新视频候选。`,
    `真实候选池返回 ${pool.candidates.length} 条可打开视频，已排除最近 ${RECENT_VIDEO_BLOCK_DAYS} 天本地看过的同 bvid ${pool.excludedRecentBvidCount} 条。`,
  ];
}

function varietyEmptyTitle(status: VarietyRegionCandidatePool['status']): string {
  switch (status) {
    case 'insufficient_local_evidence':
      return '本地冷却方向还不够明确';
    case 'unmapped_interest':
      return '长期兴趣暂时映射不到公开分区';
    case 'source_failed':
      return '分区新视频候选源暂不可用';
    case 'empty':
      return '真实候选池这次没有留下可打开视频';
    case 'ready':
      return '真实候选池暂时为空';
  }
}

function varietyEmptyDescription(pool: VarietyRegionCandidatePool): string {
  switch (pool.status) {
    case 'insufficient_local_evidence':
      return '换口味需要先从本地长期历史里找出“长期相关、近期低频”的方向。当前证据不足时不会退回本地收藏夹凑数。';
    case 'unmapped_interest':
      return '本地长期兴趣还不能保守映射到 B 站公开分区，所以暂不请求不相关候选，也不从近期高频口味里抽。';
    case 'source_failed':
      return `已找到冷却方向，但 B 站分区新视频候选源请求失败${pool.failureReason ? `：${pool.failureReason}` : ''}。本卡保留降级说明，不显示空视频。`;
    case 'empty':
      return '已找到冷却方向并尝试真实候选源，但本轮没有可打开的新视频候选。刷新后可重试，当前不会改用本地收藏作为候选全集。';
    case 'ready':
      return '真实候选池返回了结果，但候选列表为空。当前不显示空卡。';
  }
}

function varietyEmptyReason(pool: VarietyRegionCandidatePool): string {
  switch (pool.status) {
    case 'insufficient_local_evidence':
      return '本地长期兴趣和近期冷却差异还不够明确，暂不生成换口味真实候选。';
    case 'unmapped_interest':
      return '本地长期兴趣暂时不能保守映射到 B 站分区，暂不硬抽无关候选。';
    case 'source_failed':
      return '已找到换口味冷却方向，但真实分区新视频候选源暂不可用。';
    case 'empty':
      return '已请求真实分区新视频候选池，但本轮没有留下可打开候选。';
    case 'ready':
      return '真实分区新视频候选池没有返回可展示视频。';
  }
}

function varietyRealCandidateUnavailableReason(pool: VarietyRegionCandidatePool): string {
  switch (pool.status) {
    case 'insufficient_local_evidence':
      return '本地长期兴趣和近期低频方向还不够明确。';
    case 'unmapped_interest':
      return '本地长期兴趣暂时不能映射到 B 站公开分区。';
    case 'source_failed':
      return 'B 站分区新视频候选源暂不可用。';
    case 'empty':
      return '候选源本轮没有返回可打开视频。';
    case 'ready':
      return '候选列表为空。';
  }
}

function varietyEmptyStatusLabel(status: VarietyRegionCandidatePool['status']): string {
  switch (status) {
    case 'source_failed':
      return '候选源暂不可用';
    case 'empty':
    case 'ready':
      return '真实候选为空';
    case 'unmapped_interest':
      return '分区未映射';
    case 'insufficient_local_evidence':
      return '冷却证据不足';
  }
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
      const score = favoriteAgeDays * 1.2 + (watchCount === 0 ? 50 : Math.max(0, 24 - watchCount * 8)) + (lastWatchDays ?? 45);

      return {
        item,
        video,
        watchCount,
        lastWatchDays,
        favoriteAgeDays,
        score,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

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

  const pick = candidates[0];
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

function buildReviveInterestBox(ctx: BlindBoxContext): ExperimentBlindBox {
  const title = '本地兴趣回顾';
  const teaser = '只从本地历史里回看一条旧兴趣代表视频。';
  if (ctx.records.length < MIN_INTEREST_RECORDS) {
    return emptyBox(
      'revive_interest',
      title,
      teaser,
      [`本地历史只有 ${ctx.records.length} 条，暂时还看不出长期兴趣。`],
      '先多积累一点历史',
      '这盒只做本地历史回顾，不读取关注新投稿，也不替代动态账单的兴趣再平衡；它需要更长一点的本地历史样本。',
      '本地历史不足',
      LOCAL_HISTORY_REVIEW_SOURCE,
      '本地历史样本不足，暂不回看旧兴趣。',
      localHistoryReviewMeta(),
    );
  }

  const groups = new Map<string, WatchHistoryRecord[]>();
  for (const record of ctx.records) {
    const label = cleanText(record.tagName);
    if (!label) continue;
    const existing = groups.get(label);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(label, [record]);
    }
  }

  const candidates = [...groups.entries()]
    .map(([label, records]) => {
      const positiveRecords = records.filter(isPositiveRecord);
      if (records.length < MIN_INTEREST_RECORDS || positiveRecords.length < MIN_INTEREST_POSITIVE_RECORDS) return null;

      const lastWatchMs = Math.max(...records.map(record => toEpochMs(record.viewAt)));
      const daysSinceLastWatch = Math.max(1, Math.floor((ctx.nowMs - lastWatchMs) / DAY_MS));
      if (daysSinceLastWatch < RECENT_ACTIVITY_DAYS) return null;

      const recentRecords = records.filter(record => toEpochMs(record.viewAt) >= ctx.nowMs - RECENT_ACTIVITY_DAYS * DAY_MS);
      const representative = positiveRecords
        .filter(record => !ctx.usedBvids.has(record.bvid) && !ctx.recentBvids.has(record.bvid))
        .sort((a, b) => {
          if (b.actualCompletion !== a.actualCompletion) return b.actualCompletion - a.actualCompletion;
          return toEpochMs(b.viewAt) - toEpochMs(a.viewAt);
        })[0];
      if (!representative?.bvid) return null;

      const averageCompletion = positiveRecords.reduce((sum, record) => sum + record.actualCompletion, 0) / positiveRecords.length;
      const score = positiveRecords.length * 12 + averageCompletion * 40 + daysSinceLastWatch - recentRecords.length * 6;

      return {
        label,
        records,
        positiveRecords,
        recentRecords,
        representative,
        averageCompletion,
        daysSinceLastWatch,
        score,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return emptyBox(
      'revive_interest',
      title,
      teaser,
      [`在 ${ctx.records.length} 条本地历史里，还没有找到“以前常看、最近明显降温”的主题。`],
      '近期口味还没出现明显冷却',
      '这盒只会在本地证据足够明确时回看旧兴趣，不读取关注新投稿，也不会硬塞一条泛泛建议。',
      '本地历史暂不符合',
      LOCAL_HISTORY_REVIEW_SOURCE,
      '本地历史里暂时没有明确冷却的旧兴趣。',
      localHistoryReviewMeta(),
    );
  }

  const pick = candidates[0];
  const video = toHistoryVideo(pick.representative);
  if (!video) {
    return emptyBox(
      'revive_interest',
      title,
      teaser,
      ['本地找到了兴趣下降信号，但缺少可打开的视频链接。'],
      '证据够了，链接不够',
      '这个兴趣确实冷下来了，但目前本地没有留下能直接打开的代表视频；不会改用动态账单或外部候选补位。',
      '本地历史链接不足',
      LOCAL_HISTORY_REVIEW_SOURCE,
      '本地历史缺少可打开的代表视频。',
      localHistoryReviewMeta(),
    );
  }

  ctx.usedBvids.add(video.bvid);

  return {
    id: 'revive_interest',
    title,
    teaser,
    ...localHistoryReviewMeta(),
    source: `本地历史 / 标签「${pick.label}」`,
    reason: `你对「${pick.label}」长期有稳定正反馈，但最近已经 ${pick.daysSinceLastWatch} 天没碰它；这不是动态账单的兴趣再平衡，也不使用关注新投稿，只回看本地历史里的一条代表视频。`,
    evidence: [
      `长期累计 ${pick.records.length} 条相关历史，其中高完成度记录 ${pick.positiveRecords.length} 条，平均完成度 ${formatPercent(pick.averageCompletion)}。`,
      `最近 ${RECENT_ACTIVITY_DAYS} 天相关记录 ${pick.recentRecords.length} 条，上次观看距今 ${pick.daysSinceLastWatch} 天。`,
      '代表视频只从这个兴趣里完成度更高、且最近没有重复打开过的本地历史里挑选。',
    ],
    state: 'ready',
    video,
  };
}

function buildRandomExploreBox(ctx: BlindBoxContext): ExperimentBlindBox {
  const sourceLabel = '来自相关视频候选';
  const teaser = '只从真实 B 站候选池里随机抽一条，不从本地库存补位。';
  if (!ctx.randomExplorePool || ctx.randomExplorePool.seedCount === 0) {
    return emptyBox(
      'random_explore',
      '随机探索',
      teaser,
      ['本地还没有可作为公开相关视频候选种子的 BV 号。'],
      '真实候选源还没有可用种子',
      '随机探索现在需要先用最近少量本地历史作为种子，请求 B 站公开视频的相关视频候选池。等本地有可用 BV 号后，它才会开出真实候选。',
      '候选源未准备好',
      sourceLabel,
      '没有可请求的种子，未生成空白视频卡。',
      realCandidateUnavailableMeta(RELATED_CANDIDATE_SOURCE, '缺少可请求的本地 BV 种子。'),
    );
  }

  const pool = ctx.randomExplorePool.candidates
    .filter(candidate => !ctx.usedBvids.has(candidate.bvid) && !ctx.recentBvids.has(candidate.bvid))
    .sort((a, b) => a.bvid.localeCompare(b.bvid, 'en'));

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

  const index = stableHash(`${Math.floor(ctx.nowMs / DAY_MS)}:${pool.length}:${pool[0]?.seedBvid ?? ''}`) % pool.length;
  const pick = pool[index];
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

function selectRelatedVideoSeeds(records: WatchHistoryRecord[], nowMs: number): RelatedVideoSeed[] {
  const recentCutoffMs = nowMs - RECENT_VIDEO_BLOCK_DAYS * DAY_MS;
  const seeds: RelatedVideoSeed[] = [];
  const seen = new Set<string>();
  const sortedRecords = [...records]
    .filter(record => record.business === 'archive' && cleanText(record.bvid))
    .sort((a, b) => toEpochMs(b.viewAt) - toEpochMs(a.viewAt));

  for (const record of sortedRecords) {
    const bvid = cleanText(record.bvid);
    if (!isLikelyBvid(bvid) || seen.has(bvid)) continue;
    const watchedAt = toEpochMs(record.viewAt);
    if (watchedAt < recentCutoffMs && seeds.length > 0) break;
    seen.add(bvid);
    seeds.push({
      bvid,
      title: cleanText(record.title) || bvid,
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
    counts.no_valid_candidates ? `无有效 BV 候选 ${counts.no_valid_candidates} 个` : '',
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
  boundaryMeta: BlindBoxBoundaryMeta = localHistoryReviewMeta(),
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

function toHistoryVideo(record: WatchHistoryRecord): ExperimentVideoCandidate | null {
  if (!cleanText(record.bvid)) return null;
  return {
    bvid: record.bvid,
    avid: record.avid > 0 ? record.avid : undefined,
    title: cleanText(record.title) || record.bvid,
    authorName: cleanText(record.authorName) || '未知 UP',
    cover: cleanText(record.cover),
    url: buildVideoUrl(record.bvid, record.avid),
    sourceKind: 'local_history',
  };
}

function toFavoriteVideo(item: FavoriteItem): ExperimentVideoCandidate | null {
  if (!cleanText(item.bvid)) return null;
  return {
    bvid: item.bvid,
    avid: item.avid > 0 ? item.avid : undefined,
    title: cleanText(item.title) || item.bvid,
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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCount(value: number): string {
  return String(Math.round(value * 10) / 10);
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

function stableHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}
