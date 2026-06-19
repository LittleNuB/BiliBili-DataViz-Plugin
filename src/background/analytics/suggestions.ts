import type {
  ExperimentBlindBox,
  ExperimentBlindBoxId,
  ExperimentData,
  ExperimentRealCandidatePool,
  ExperimentVideoCandidate,
} from '../../shared/types/analytics';
import type { FavoriteItem, SmartFavoriteIndex } from '../../shared/types/favorite';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type { RelatedVideoSeed } from '../api/video-blind-box-candidates.ts';
import { db } from '../storage/db.ts';
import { getFavoriteItems, getSmartFavoriteIndexMap } from '../storage/favorite-repo.ts';

const DAY_MS = 86_400_000;
const RECENT_ACTIVITY_DAYS = 45;
const RECENT_VIDEO_BLOCK_DAYS = 90;
const RANDOM_RELATED_SEED_LIMIT = 3;
const MIN_INTEREST_RECORDS = 4;
const MIN_INTEREST_POSITIVE_RECORDS = 2;
const POSITIVE_COMPLETION = 0.75;

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
}

interface FavoriteTaste {
  displayLabel: string;
  matchLabels: string[];
}

export async function getExperimentData(): Promise<ExperimentData> {
  const nowMs = Date.now();
  const [records, favorites, smartIndexByItemKey] = await Promise.all([
    db.watchHistory.toArray(),
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
  ]);
  const { fetchRelatedVideoCandidates } = await import('../api/video-blind-box-candidates.ts');
  const randomExplorePool = await fetchRelatedVideoCandidates(
    selectRelatedVideoSeeds(records, nowMs),
    { seedLimit: RANDOM_RELATED_SEED_LIMIT },
  );

  return buildExperimentData(records, favorites, smartIndexByItemKey, nowMs, randomExplorePool);
}

export function buildExperimentData(
  records: WatchHistoryRecord[],
  favorites: FavoriteItem[],
  smartIndexByItemKey: Map<string, SmartFavoriteIndex>,
  nowMs = Date.now(),
  randomExplorePool?: ExperimentRealCandidatePool,
): ExperimentData {
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
    randomExplorePool,
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

function buildVarietyBox(ctx: BlindBoxContext): ExperimentBlindBox {
  if (ctx.favorites.length === 0) {
    return emptyBox(
      'variety',
      '换口味',
      '从本地收藏里挑一条和最近口味不一样的。',
      ['本地收藏 0 条，暂时没有可以换口味的视频池。'],
      '先把收藏同步进来',
      '这盒只从本地收藏里挑视频。同步收藏后，我才能从你已经留住的视频里找一条明显不同的口味。',
    );
  }

  if (ctx.recentRecords.length < 6 || ctx.recentTopTags.length === 0) {
    return emptyBox(
      'variety',
      '换口味',
      '从本地收藏里挑一条和最近口味不一样的。',
      [`最近 ${RECENT_ACTIVITY_DAYS} 天本地历史只有 ${ctx.recentRecords.length} 条，口味轮廓还不够稳定。`],
      '最近历史还不够成型',
      '等最近再多积累一点观看记录，我才能判断你现在的主口味，并从收藏里挑一条真正“换口味”的视频。',
    );
  }

  const dominantTag = ctx.recentTopTags[0];
  const candidates = ctx.favorites
    .map(item => {
      const video = toFavoriteVideo(item);
      if (!video || ctx.usedBvids.has(video.bvid) || ctx.recentBvids.has(video.bvid)) return null;

      const smart = ctx.smartIndexByItemKey.get(item.itemKey);
      const taste = getFavoriteTaste(item, smart);
      const tasteDiff = taste.matchLabels.every(label => !ctx.recentTopTags.includes(label));
      if (!tasteDiff) return null;

      const favoriteAgeDays = daysSince(item.favTime, ctx.nowMs);
      const score = favoriteAgeDays
        + (smart?.status === 'indexed' ? 20 : 0)
        + (ctx.recentAuthorMids.has(item.authorMid) ? 0 : 12);

      return {
        item,
        taste,
        smart,
        video,
        favoriteAgeDays,
        score,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    const indexedCount = ctx.favorites.filter(item => ctx.smartIndexByItemKey.get(item.itemKey)?.status === 'indexed').length;
    return emptyBox(
      'variety',
      '换口味',
      '从本地收藏里挑一条和最近口味不一样的。',
      [
        `最近 ${RECENT_ACTIVITY_DAYS} 天高频主题：${ctx.recentTopTags.join('、')}。`,
        `本地收藏 ${ctx.favorites.length} 条，其中已生成智能路径 ${indexedCount} 条。`,
      ],
      indexedCount === 0 ? '先生成收藏分类路径' : '收藏和最近口味太接近',
      indexedCount === 0
        ? '这盒需要靠本地收藏路径来判断“不同口味”。先同步收藏并生成智能索引，再回来开盒。'
        : '你最近看的主题和本地收藏重合度很高，暂时挑不出一条明显反差的换口味视频。',
    );
  }

  const pick = candidates[0];
  ctx.usedBvids.add(pick.video.bvid);

  return {
    id: 'variety',
    title: '换口味',
    teaser: '从本地收藏里挑一条和最近口味不一样的。',
    source: pick.smart?.status === 'indexed'
      ? `本地收藏 / 智能路径「${pick.taste.displayLabel}」`
      : `本地收藏 / 收藏夹「${pick.item.folderTitle}」`,
    reason: `最近 ${RECENT_ACTIVITY_DAYS} 天你更常看「${dominantTag}」，这条收藏落在「${pick.taste.displayLabel}」，适合作为一次主动换口味。`,
    evidence: [
      `最近 ${RECENT_ACTIVITY_DAYS} 天共有 ${ctx.recentRecords.length} 条本地观看，主口味集中在：${ctx.recentTopTags.join('、')}。`,
      `这条视频收藏于 ${pick.favoriteAgeDays} 天前，来自 ${pick.smart?.status === 'indexed' ? `智能路径「${pick.taste.displayLabel}」` : `收藏夹「${pick.item.folderTitle}」`}。`,
      `本地最近 ${RECENT_VIDEO_BLOCK_DAYS} 天没有再看过它${ctx.recentAuthorMids.has(pick.item.authorMid) ? '' : '，这位 UP 也不在你最近的高频观看里'}。`,
    ],
    state: 'ready',
    video: pick.video,
  };
}

function buildHiddenFavoriteBox(ctx: BlindBoxContext): ExperimentBlindBox {
  if (ctx.favorites.length === 0) {
    return emptyBox(
      'hidden_favorite',
      '冷门收藏',
      '从本地收藏里翻出被你压箱底的一条。',
      ['本地收藏 0 条，暂时没有可以翻出来的冷门收藏。'],
      '先同步收藏',
      '这盒只看本地收藏，不会去猜外部推荐。先把收藏同步进来，再让我帮你翻压箱底。',
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
    );
  }

  const pick = candidates[0];
  ctx.usedBvids.add(pick.video.bvid);

  return {
    id: 'hidden_favorite',
    title: '冷门收藏',
    teaser: '从本地收藏里翻出被你压箱底的一条。',
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
  if (ctx.records.length < MIN_INTEREST_RECORDS) {
    return emptyBox(
      'revive_interest',
      '久未观看兴趣',
      '把曾经常看的兴趣，重新翻回你面前。',
      [`本地历史只有 ${ctx.records.length} 条，暂时还看不出长期兴趣。`],
      '先多积累一点历史',
      '这盒要判断“以前常看、最近冷下来”的兴趣，需要更长一点的本地历史样本。',
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
      '久未观看兴趣',
      '把曾经常看的兴趣，重新翻回你面前。',
      [`在 ${ctx.records.length} 条本地历史里，还没有找到“以前常看、最近明显降温”的主题。`],
      '近期口味还没出现明显冷却',
      '这盒只会在本地证据足够明确时开出来，不会硬塞一条泛泛建议。',
    );
  }

  const pick = candidates[0];
  const video = toHistoryVideo(pick.representative);
  if (!video) {
    return emptyBox(
      'revive_interest',
      '久未观看兴趣',
      '把曾经常看的兴趣，重新翻回你面前。',
      ['本地找到了兴趣下降信号，但缺少可打开的视频链接。'],
      '证据够了，链接不够',
      '这个兴趣确实冷下来了，但目前本地没有留下能直接打开的代表视频。',
    );
  }

  ctx.usedBvids.add(video.bvid);

  return {
    id: 'revive_interest',
    title: '久未观看兴趣',
    teaser: '把曾经常看的兴趣，重新翻回你面前。',
    source: `本地历史 / 标签「${pick.label}」`,
    reason: `你对「${pick.label}」长期有稳定正反馈，但最近已经 ${pick.daysSinceLastWatch} 天没碰它，这条是本地历史里的代表视频。`,
    evidence: [
      `长期累计 ${pick.records.length} 条相关历史，其中高完成度记录 ${pick.positiveRecords.length} 条，平均完成度 ${formatPercent(pick.averageCompletion)}。`,
      `最近 ${RECENT_ACTIVITY_DAYS} 天相关记录 ${pick.recentRecords.length} 条，上次观看距今 ${pick.daysSinceLastWatch} 天。`,
      '代表视频优先从这个兴趣里完成度更高、且最近没有重复打开过的本地历史里挑选。',
    ],
    state: 'ready',
    video,
  };
}

function buildRandomExploreBox(ctx: BlindBoxContext): ExperimentBlindBox {
  const sourceLabel = '来自相关视频候选';
  if (!ctx.randomExplorePool || ctx.randomExplorePool.seedCount === 0) {
    return emptyBox(
      'random_explore',
      '随机探索',
      '不做推荐排序，只从真实候选池里随机抽一条。',
      ['本地还没有可作为公开相关视频候选种子的 BV 号。'],
      '真实候选源还没有可用种子',
      `随机探索现在需要先用最近少量本地历史作为种子，请求 B 站公开视频的相关视频候选池。等本地有可用 BV 号后，它才会开出真实候选。`,
      sourceLabel,
      '没有可请求的种子，未生成空白视频卡。',
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
      '不做推荐排序，只从真实候选池里随机抽一条。',
      [
        `已尝试 ${ctx.randomExplorePool.seedCount} 个种子视频的相关视频候选。`,
        failureSummary,
        `同时会排除最近 ${RECENT_VIDEO_BLOCK_DAYS} 天看过的视频和本页其它盲盒已占用的视频。`,
      ],
      '相关视频候选暂时不可用',
      '这次没有拿到可安全展示的真实候选，Bili-Bill 不会用本地库存视频冒充随机探索候选。',
      sourceLabel,
      '真实候选源失败或为空，未生成空白视频卡。',
    );
  }

  const index = stableHash(`${Math.floor(ctx.nowMs / DAY_MS)}:${pool.length}:${pool[0]?.seedBvid ?? ''}`) % pool.length;
  const pick = pool[index];
  ctx.usedBvids.add(pick.bvid);

  return {
    id: 'random_explore',
    title: '随机探索',
    teaser: '不做推荐排序，只从真实候选池里随机抽一条。',
    source: `${sourceLabel} / 种子视频「${pick.seedTitle || pick.seedBvid}」`,
    reason: `Bili-Bill 没有保留平台排序，只是在 ${pool.length} 条公开相关视频候选里随机抽取一条。`,
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
  source = '仅使用本地历史 / 本地收藏',
  reason = '这盒没有足够的本地证据，不会拿泛泛建议来凑数。',
): ExperimentBlindBox {
  return {
    id,
    title,
    teaser,
    source,
    reason,
    evidence,
    state: 'empty',
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
  };
}

function getFavoriteTaste(item: FavoriteItem, smart: SmartFavoriteIndex | undefined): FavoriteTaste {
  const path = smart?.status === 'indexed'
    ? smart.path.map(cleanText).filter(Boolean)
    : [];
  const fallback = [item.tagName, item.folderTitle].map(cleanText).filter(Boolean);
  const displayParts = path.length > 0 ? path : fallback.length > 0 ? fallback : ['未命名口味'];
  return {
    displayLabel: displayParts.join(' / '),
    matchLabels: uniqueTexts([...displayParts, item.tagName, item.folderTitle]),
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

function uniqueTexts(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map(cleanText).filter(Boolean)) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isPositiveRecord(record: WatchHistoryRecord): boolean {
  return record.actualCompletion >= POSITIVE_COMPLETION
    || Math.max(0, record.progress) >= Math.min(Math.max(0, record.duration), 900);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
