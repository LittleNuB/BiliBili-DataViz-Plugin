import type {
  DynamicBillColumn,
  DynamicBillFollowMemorySignal,
  DynamicBillItem,
  DynamicBillRotationRecord,
  DynamicBillWindowEvidence,
  FollowedCreator,
  FollowedVideoUpdate,
} from '../../shared/types/dynamic-bill.ts';
import type { FavoriteItem } from '../../shared/types/favorite.ts';
import type { WatchHistoryRecord } from '../../shared/types/watch-event.ts';
import {
  DYNAMIC_BILL_COLUMNS,
  DYNAMIC_BILL_STRATEGY,
  getDynamicBillThresholdEvidence,
} from './strategy.ts';
import { compareFollowedVideoUpdatesNewestFirst } from './update-order.ts';

const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_DAY = 86_400_000;

interface CreatorWindowStats extends DynamicBillWindowEvidence {
  records: WatchHistoryRecord[];
}

interface FixedBillCandidate {
  creator: FollowedCreator;
  update: FollowedVideoUpdate;
  column: DynamicBillColumn;
  longStats: CreatorWindowStats;
  recentStats: CreatorWindowStats;
  followAgeDays?: number;
  memorySignals: DynamicBillFollowMemorySignal[];
  daysSinceLastWatch: number | null;
  historyBvids: string[];
  favoriteEvidenceCount: number;
  rotationLastShownAt: number;
}

export interface FixedDynamicBillPlanInput {
  creators: FollowedCreator[];
  updates: FollowedVideoUpdate[];
  historyRecords: WatchHistoryRecord[];
  favoriteItems: FavoriteItem[];
  rotationRecords: DynamicBillRotationRecord[];
  pausedCreatorMids: Set<number>;
  now: number;
}

export interface FixedDynamicBillPlanResult {
  items: DynamicBillItem[];
  candidatesScanned: number;
  eligibleCreatorCount: number;
  excludedNoLongSignalCount: number;
  excludedRecentActiveCount: number;
  excludedRecentSameVideoCount: number;
  excludedByFeedbackCount: number;
  columnEligibleCounts: Record<DynamicBillColumn, number>;
}

export function planFixedDynamicBillItems(input: FixedDynamicBillPlanInput): FixedDynamicBillPlanResult {
  const nowSeconds = Math.floor(input.now / 1000);
  const longCutoff = nowSeconds - DYNAMIC_BILL_STRATEGY.longWindowDays * SECONDS_PER_DAY;
  const recentCutoff = nowSeconds - DYNAMIC_BILL_STRATEGY.recentWindowDays * SECONDS_PER_DAY;
  const recentSameVideoCutoff = nowSeconds - DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays * SECONDS_PER_DAY;
  const activeCreatorsByMid = new Map(
    input.creators
      .filter(creator => creator.isActive !== false)
      .map(creator => [creator.mid, creator]),
  );
  const recordsByCreator = groupRecordsByCreator(input.historyRecords);
  const favoriteItemsByCreator = groupFavoriteItemsByCreator(input.favoriteItems);
  const rotationsByCreator = new Map(input.rotationRecords.map(record => [record.creatorMid, record]));
  const recentlyWatchedBvids = new Set(
    input.historyRecords
      .filter(record => record.viewAt >= recentSameVideoCutoff)
      .map(record => record.bvid)
      .filter(Boolean),
  );

  let excludedRecentSameVideoCount = 0;
  let excludedByFeedbackCount = 0;
  const newestUnwatchedUpdateByCreator = new Map<number, FollowedVideoUpdate>();

  for (const update of input.updates) {
    if (!activeCreatorsByMid.has(update.authorMid)) continue;
    if (input.pausedCreatorMids.has(update.authorMid)) {
      excludedByFeedbackCount++;
      continue;
    }
    if (recentlyWatchedBvids.has(update.bvid)) {
      excludedRecentSameVideoCount++;
      continue;
    }
    const currentNewest = newestUnwatchedUpdateByCreator.get(update.authorMid);
    if (!currentNewest || compareFollowedVideoUpdatesNewestFirst(update, currentNewest) < 0) {
      newestUnwatchedUpdateByCreator.set(update.authorMid, update);
    }
  }

  const candidates: FixedBillCandidate[] = [];
  let excludedNoLongSignalCount = 0;
  let excludedRecentActiveCount = 0;

  for (const [creatorMid, update] of newestUnwatchedUpdateByCreator) {
    const creator = activeCreatorsByMid.get(creatorMid);
    if (!creator) continue;

    const creatorRecords = recordsByCreator.get(creatorMid) ?? [];
    const longStats = buildWindowStats(
      creatorRecords,
      DYNAMIC_BILL_STRATEGY.longWindowDays,
      longCutoff,
      nowSeconds,
    );
    const recentStats = buildWindowStats(
      creatorRecords.filter(record => record.viewAt >= recentCutoff),
      DYNAMIC_BILL_STRATEGY.recentWindowDays,
      recentCutoff,
      nowSeconds,
    );
    const followAgeDays = getFollowAgeDays(creator, nowSeconds);
    const memorySignals = buildMemorySignals(creator, creatorRecords, followAgeDays, recentCutoff, input.now);
    const favoriteEvidence = (favoriteItemsByCreator.get(creatorMid) ?? [])
      .filter(item => item.bvid !== update.bvid);
    const column = chooseColumn({
      favoriteEvidenceCount: favoriteEvidence.length,
      recentStats,
      memorySignals,
    });

    if (column !== 'buried_follow' && memorySignals.length === 0) {
      excludedNoLongSignalCount++;
    }
    if (column !== 'buried_follow' && isRecentlyActiveForBuriedFollow(recentStats)) {
      excludedRecentActiveCount++;
    }

    candidates.push({
      creator,
      update,
      column,
      longStats,
      recentStats,
      followAgeDays,
      memorySignals,
      daysSinceLastWatch: longStats.lastWatchedAt > 0
        ? Math.floor((nowSeconds - longStats.lastWatchedAt) / SECONDS_PER_DAY)
        : null,
      historyBvids: selectHistoryHighlights(creatorRecords, update.bvid, recentCutoff),
      favoriteEvidenceCount: favoriteEvidence.length,
      rotationLastShownAt: rotationsByCreator.get(creatorMid)?.lastShownAt ?? 0,
    });
  }

  const items = DYNAMIC_BILL_COLUMNS.flatMap((column) => {
    return candidates
      .filter(candidate => candidate.column === column)
      .sort(compareCandidatesByRotation)
      .slice(0, DYNAMIC_BILL_STRATEGY.maxItemsPerColumn)
      .map((candidate, index) => toBillItem(candidate, index + 1, input.now));
  }).slice(0, DYNAMIC_BILL_STRATEGY.maxItemsTotal);

  return {
    items,
    candidatesScanned: input.updates.length,
    eligibleCreatorCount: candidates.length,
    excludedNoLongSignalCount,
    excludedRecentActiveCount,
    excludedRecentSameVideoCount,
    excludedByFeedbackCount,
    columnEligibleCounts: countCandidatesByColumn(candidates),
  };
}

function chooseColumn(input: {
  favoriteEvidenceCount: number;
  recentStats: CreatorWindowStats;
  memorySignals: DynamicBillFollowMemorySignal[];
}): DynamicBillColumn {
  if (input.favoriteEvidenceCount > 0) return 'favorite_related';
  if (
    input.memorySignals.length > 0
    && !isRecentlyActiveForBuriedFollow(input.recentStats)
  ) {
    return 'buried_follow';
  }
  return 'follow_rotation';
}

function isRecentlyActiveForBuriedFollow(recentStats: CreatorWindowStats): boolean {
  return recentStats.watchedCount > DYNAMIC_BILL_STRATEGY.maxBuriedRecentWatchCount
    || recentStats.positiveWatchCount > DYNAMIC_BILL_STRATEGY.maxBuriedRecentPositiveWatchCount;
}

function buildMemorySignals(
  creator: FollowedCreator,
  records: WatchHistoryRecord[],
  followAgeDays: number | undefined,
  recentCutoff: number,
  now: number,
): DynamicBillFollowMemorySignal[] {
  const signals: DynamicBillFollowMemorySignal[] = [];
  if (followAgeDays !== undefined && followAgeDays >= DYNAMIC_BILL_STRATEGY.minBuriedFollowAgeDays) {
    signals.push('long_follow');
  }
  if (creator.special) {
    signals.push('special_follow');
  }
  if (hasObservedFollowForMinimumDays(creator, now)) {
    signals.push('observed_follow');
  }
  if (records.filter(record => record.viewAt < recentCutoff).length >= DYNAMIC_BILL_STRATEGY.minBuriedWeakWatchCount) {
    signals.push('weak_watch');
  }
  return signals;
}

function hasObservedFollowForMinimumDays(creator: FollowedCreator, now: number): boolean {
  const firstSeenAt = normalizeMilliseconds(creator.firstSeenAt ?? creator.syncedAt);
  const lastSeenAt = normalizeMilliseconds(creator.lastSeenAt || now);
  return firstSeenAt > 0
    && lastSeenAt >= firstSeenAt
    && lastSeenAt - firstSeenAt >= DYNAMIC_BILL_STRATEGY.minObservedFollowDays * MILLISECONDS_PER_DAY;
}

function groupRecordsByCreator(records: WatchHistoryRecord[]): Map<number, WatchHistoryRecord[]> {
  const groups = new Map<number, WatchHistoryRecord[]>();
  for (const record of records) {
    if (!record.authorMid) continue;
    const bucket = groups.get(record.authorMid) ?? [];
    bucket.push(record);
    groups.set(record.authorMid, bucket);
  }
  return groups;
}

function groupFavoriteItemsByCreator(items: FavoriteItem[]): Map<number, FavoriteItem[]> {
  const groups = new Map<number, FavoriteItem[]>();
  for (const item of items) {
    if (!item.authorMid) continue;
    const bucket = groups.get(item.authorMid) ?? [];
    bucket.push(item);
    groups.set(item.authorMid, bucket);
  }
  return groups;
}

function buildWindowStats(
  records: WatchHistoryRecord[],
  windowDays: number,
  startedAt: number,
  endedAt: number,
): CreatorWindowStats {
  const watchedCount = records.length;
  const positiveWatchCount = records.filter(isPositiveWatch).length;
  const totalWatchTimeSeconds = records.reduce((sum, record) => sum + positiveProgress(record), 0);
  const avgCompletion = watchedCount > 0
    ? records.reduce((sum, record) => sum + completionRate(record), 0) / watchedCount
    : 0;
  const lastWatchedAt = records.reduce((latest, record) => Math.max(latest, record.viewAt), 0);

  return {
    windowDays,
    startedAt,
    endedAt,
    watchedCount,
    positiveWatchCount,
    totalWatchTimeSeconds,
    avgCompletion,
    lastWatchedAt,
    records,
  };
}

function compareCandidatesByRotation(a: FixedBillCandidate, b: FixedBillCandidate): number {
  const rotationDelta = a.rotationLastShownAt - b.rotationLastShownAt;
  if (rotationDelta !== 0) return rotationDelta;
  const updateDelta = compareFollowedVideoUpdatesNewestFirst(a.update, b.update);
  if (updateDelta !== 0) return updateDelta;
  return a.creator.mid - b.creator.mid;
}

function toBillItem(candidate: FixedBillCandidate, localRank: number, generatedAt: number): DynamicBillItem {
  const thresholds = getDynamicBillThresholdEvidence();
  const facts = buildFacts(candidate);

  return {
    billKey: `${candidate.column}:${candidate.update.updateKey}`,
    column: candidate.column,
    status: 'unopened',
    updateKey: candidate.update.updateKey,
    creatorMid: candidate.creator.mid,
    creatorName: candidate.creator.name || candidate.update.authorName,
    creatorFace: candidate.creator.face || candidate.update.authorFace,
    historyBvids: candidate.historyBvids,
    localRank,
    score: candidate.rotationLastShownAt,
    generatedAt,
    evidence: {
      kind: candidate.column,
      longWindow: stripRecords(candidate.longStats),
      recentWindow: stripRecords(candidate.recentStats),
      newVideo: {
        updateKey: candidate.update.updateKey,
        dynamicId: candidate.update.dynamicId,
        bvid: candidate.update.bvid,
        avid: candidate.update.avid,
        title: candidate.update.title,
        cover: candidate.update.cover,
        duration: candidate.update.duration,
        pubtime: candidate.update.pubtime,
        dynamicTime: candidate.update.dynamicTime,
        tagName: candidate.update.tagName,
        tags: candidate.update.tags,
      },
      follow: {
        followedAt: candidate.creator.followedAt,
        followAgeKnown: candidate.creator.followAgeKnown,
        followAgeDays: candidate.followAgeDays,
        special: candidate.creator.special,
        memorySignals: candidate.memorySignals,
      },
      cooldownRatio: 0,
      daysSinceLastWatch: candidate.daysSinceLastWatch,
      facts,
      thresholds,
    },
  };
}

function buildFacts(candidate: FixedBillCandidate): string[] {
  const title = candidate.update.title || candidate.update.bvid;
  const creatorName = candidate.creator.name || candidate.update.authorName;
  const baseFacts = [
    `最近 ${DYNAMIC_BILL_STRATEGY.updateWindowDays} 天，已关注 UP「${creatorName}」发布了新视频《${title}》。`,
    `本地最近 ${DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays} 天未发现同一新视频 ${candidate.update.bvid} 的观看记录。`,
    '本轮先为每位 UP 选择最新一条尚未观看投稿，再按固定三栏唯一归属展示；AI 不参与入选、归属、轮换或状态。',
  ];

  if (candidate.column === 'favorite_related') {
    return [
      `本地已同步收藏中有 ${candidate.favoriteEvidenceCount} 条来自这个 UP 的既有作品；收藏只作为关系证据，不作为点击预测分数。`,
      ...baseFacts,
      rotationFact(candidate),
    ];
  }

  if (candidate.column === 'buried_follow') {
    return [
      `关注记忆证据：${formatMemorySignals(candidate.memorySignals)}。`,
      `最近 ${candidate.recentStats.windowDays} 天观看 ${candidate.recentStats.watchedCount} 次、有效观看 ${candidate.recentStats.positiveWatchCount} 次，符合缺席或近乎缺席条件。`,
      ...baseFacts,
      rotationFact(candidate),
    ];
  }

  return [
    '这条来自剩余已关注 UP 的最近新投稿，用全局轮换扩大创作者覆盖。',
    ...baseFacts,
    rotationFact(candidate),
  ];
}

function rotationFact(candidate: FixedBillCandidate): string {
  if (candidate.rotationLastShownAt <= 0) {
    return '全局轮换记录中尚未展示过这个 UP，本轮优先给它一次展示机会。';
  }
  return `全局轮换记录显示这个 UP 上次进入动态账单为 ${new Date(candidate.rotationLastShownAt).toLocaleString('zh-CN')}，本轮按最久未展示优先继续轮换。`;
}

function formatMemorySignals(signals: DynamicBillFollowMemorySignal[]): string {
  if (signals.length === 0) return '当前没有足够的关注记忆信号';
  return signals.map(signal => {
    switch (signal) {
      case 'long_follow':
        return `已关注不少于 ${DYNAMIC_BILL_STRATEGY.minBuriedFollowAgeDays} 天`;
      case 'special_follow':
        return '特别关注';
      case 'observed_follow':
        return `本地连续观察不少于 ${DYNAMIC_BILL_STRATEGY.minObservedFollowDays} 天`;
      case 'weak_watch':
        return '近期窗口以前有本地观看记录';
      default:
        return signal;
    }
  }).join('、');
}

function selectHistoryHighlights(
  records: WatchHistoryRecord[],
  currentBvid: string,
  recentCutoff: number,
): string[] {
  const seen = new Set<string>();
  return records
    .filter(record => record.bvid && record.bvid !== currentBvid && record.viewAt < recentCutoff)
    .sort((a, b) => {
      const positiveDelta = Number(isPositiveWatch(b)) - Number(isPositiveWatch(a));
      if (positiveDelta !== 0) return positiveDelta;
      const completionDelta = completionRate(b) - completionRate(a);
      if (completionDelta !== 0) return completionDelta;
      const progressDelta = positiveProgress(b) - positiveProgress(a);
      if (progressDelta !== 0) return progressDelta;
      return b.viewAt - a.viewAt;
    })
    .map(record => record.bvid)
    .filter((bvid) => {
      if (seen.has(bvid)) return false;
      seen.add(bvid);
      return true;
    })
    .slice(0, DYNAMIC_BILL_STRATEGY.maxHighlightsPerItem);
}

function isPositiveWatch(record: WatchHistoryRecord): boolean {
  return record.isFavorite
    || completionRate(record) >= DYNAMIC_BILL_STRATEGY.positiveCompletionRate
    || positiveProgress(record) >= DYNAMIC_BILL_STRATEGY.minPositiveWatchSeconds;
}

function completionRate(record: WatchHistoryRecord): number {
  if (Number.isFinite(record.actualCompletion)) {
    return clamp01(record.actualCompletion);
  }
  return record.duration > 0 ? clamp01(record.progress / record.duration) : 0;
}

function positiveProgress(record: WatchHistoryRecord): number {
  return Math.max(0, Number(record.progress ?? 0));
}

function stripRecords(stats: CreatorWindowStats): DynamicBillWindowEvidence {
  const { records: _records, ...evidence } = stats;
  return evidence;
}

function getFollowAgeDays(creator: FollowedCreator, nowSeconds: number): number | undefined {
  if (!creator.followAgeKnown || !creator.followedAt) return undefined;
  return Math.max(0, Math.floor((nowSeconds - creator.followedAt) / SECONDS_PER_DAY));
}

function countCandidatesByColumn(candidates: FixedBillCandidate[]): Record<DynamicBillColumn, number> {
  return DYNAMIC_BILL_COLUMNS.reduce((counts, column) => {
    counts[column] = candidates.filter(candidate => candidate.column === column).length;
    return counts;
  }, emptyColumnCounts());
}

function emptyColumnCounts(): Record<DynamicBillColumn, number> {
  return {
    buried_follow: 0,
    favorite_related: 0,
    follow_rotation: 0,
  };
}

function normalizeMilliseconds(value: number | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}
