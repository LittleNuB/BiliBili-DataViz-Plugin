import type {
  DynamicBillFollowMemorySignal,
  DynamicBillGenerateResult,
  DynamicBillItem,
  DynamicBillWindowEvidence,
  FollowedCreator,
  FollowedVideoUpdate,
} from '../../shared/types/dynamic-bill';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { getRecordsSince } from '../storage/watch-history-repo';
import {
  getActiveFollowedCreators,
  getDynamicBillOverview,
  getRecentFollowedVideoUpdates,
  replaceDynamicBillItemsForColumn,
} from '../storage/dynamic-bill-repo';
import { DYNAMIC_BILL_STRATEGY, getDynamicBillThresholdEvidence } from './strategy';

const SECONDS_PER_DAY = 86_400;
const BURIED_FOLLOW_COLUMN = 'buried_follow';

interface CreatorWindowStats extends DynamicBillWindowEvidence {
  records: WatchHistoryRecord[];
}

interface Candidate {
  creator: FollowedCreator;
  update: FollowedVideoUpdate;
  longStats: CreatorWindowStats;
  recentStats: CreatorWindowStats;
  cooldownRatio: number;
  daysSinceLastWatch: number | null;
  followAgeDays?: number;
  memorySignals: DynamicBillFollowMemorySignal[];
  historicalWeakWatchCount: number;
  historyBvids: string[];
  score: number;
}

export async function generateBuriedFollowBillItems(): Promise<DynamicBillGenerateResult> {
  const generatedAt = Date.now();
  const nowSeconds = Math.floor(generatedAt / 1000);
  const thresholds = getDynamicBillThresholdEvidence();
  const longCutoff = nowSeconds - DYNAMIC_BILL_STRATEGY.longWindowDays * SECONDS_PER_DAY;
  const recentCutoff = nowSeconds - DYNAMIC_BILL_STRATEGY.recentWindowDays * SECONDS_PER_DAY;
  const recentSameVideoCutoff = nowSeconds - DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays * SECONDS_PER_DAY;

  const [creators, updates, longRecords] = await Promise.all([
    getActiveFollowedCreators(),
    getRecentFollowedVideoUpdates(DYNAMIC_BILL_STRATEGY.updateWindowDays),
    getRecordsSince(longCutoff),
  ]);

  const activeCreatorsByMid = new Map(creators.map(creator => [creator.mid, creator]));
  const recordsByCreator = groupRecordsByCreator(longRecords);
  const recentlyWatchedBvids = new Set(
    longRecords
      .filter(record => record.viewAt >= recentSameVideoCutoff)
      .map(record => record.bvid)
      .filter(Boolean),
  );

  let excludedRecentSameVideoCount = 0;
  const newestUnwatchedUpdateByCreator = new Map<number, FollowedVideoUpdate>();
  for (const update of updates) {
    if (!activeCreatorsByMid.has(update.authorMid)) continue;
    if (recentlyWatchedBvids.has(update.bvid)) {
      excludedRecentSameVideoCount++;
      continue;
    }

    const existing = newestUnwatchedUpdateByCreator.get(update.authorMid);
    if (!existing || update.dynamicTime > existing.dynamicTime) {
      newestUnwatchedUpdateByCreator.set(update.authorMid, update);
    }
  }

  const candidates: Candidate[] = [];
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

    if (
      recentStats.watchedCount > DYNAMIC_BILL_STRATEGY.maxBuriedRecentWatchCount
      || recentStats.positiveWatchCount > DYNAMIC_BILL_STRATEGY.maxBuriedRecentPositiveWatchCount
    ) {
      excludedRecentActiveCount++;
      continue;
    }

    const followAgeDays = getFollowAgeDays(creator, nowSeconds);
    const historicalWeakWatchCount = creatorRecords.filter(record => record.viewAt < recentCutoff).length;
    const memorySignals = buildMemorySignals(creator, followAgeDays, historicalWeakWatchCount);
    if (memorySignals.length === 0) {
      excludedNoLongSignalCount++;
      continue;
    }

    const daysSinceLastWatch = longStats.lastWatchedAt > 0
      ? Math.floor((nowSeconds - longStats.lastWatchedAt) / SECONDS_PER_DAY)
      : null;
    const cooldownRatio = DYNAMIC_BILL_STRATEGY.maxBuriedRecentWatchCount > 0
      ? recentStats.watchedCount / DYNAMIC_BILL_STRATEGY.maxBuriedRecentWatchCount
      : 0;
    const historyBvids = selectHistoryHighlights(creatorRecords, update.bvid, recentCutoff);

    const candidate: Omit<Candidate, 'score'> = {
      creator,
      update,
      longStats,
      recentStats,
      cooldownRatio,
      daysSinceLastWatch,
      followAgeDays,
      memorySignals,
      historicalWeakWatchCount,
      historyBvids,
    };

    candidates.push({
      ...candidate,
      score: scoreCandidate(candidate, nowSeconds),
    });
  }

  const items = candidates
    .sort((a, b) => b.score - a.score || b.update.dynamicTime - a.update.dynamicTime)
    .slice(0, DYNAMIC_BILL_STRATEGY.maxItemsPerColumn)
    .map((candidate, index) => toBillItem(candidate, index + 1, generatedAt));

  const storedItems = await replaceDynamicBillItemsForColumn(BURIED_FOLLOW_COLUMN, items);
  const overview = await getDynamicBillOverview(DYNAMIC_BILL_STRATEGY.updateWindowDays);

  return {
    generatedAt,
    itemCount: storedItems.length,
    candidatesScanned: updates.length,
    eligibleCreatorCount: candidates.length,
    excludedNoLongSignalCount,
    excludedRecentActiveCount,
    excludedRecentSameVideoCount,
    columnItemCounts: {
      afk_update: 0,
      variety: 0,
      buried_follow: storedItems.length,
    },
    columnEligibleCounts: {
      afk_update: 0,
      variety: 0,
      buried_follow: candidates.length,
    },
    items: storedItems,
    thresholds,
    overview,
  };
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

function buildMemorySignals(
  creator: FollowedCreator,
  followAgeDays: number | undefined,
  historicalWeakWatchCount: number,
): DynamicBillFollowMemorySignal[] {
  const signals: DynamicBillFollowMemorySignal[] = [];
  if (followAgeDays !== undefined && followAgeDays >= DYNAMIC_BILL_STRATEGY.minBuriedFollowAgeDays) {
    signals.push('long_follow');
  }
  if (creator.special) {
    signals.push('special_follow');
  }
  if (historicalWeakWatchCount >= DYNAMIC_BILL_STRATEGY.minBuriedWeakWatchCount) {
    signals.push('weak_watch');
  }
  return signals;
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

function scoreCandidate(candidate: Omit<Candidate, 'score'>, nowSeconds: number): number {
  const updateAgeDays = Math.max(0, (nowSeconds - candidate.update.dynamicTime) / SECONDS_PER_DAY);
  const followAgeStrength = candidate.followAgeDays !== undefined
    ? Math.min(candidate.followAgeDays / 365, 4) * 5
    : 0;
  const specialBoost = candidate.creator.special ? 10 : 0;
  const weakHistoryBoost = Math.min(candidate.historicalWeakWatchCount, 3) * 3
    + Math.min(candidate.longStats.totalWatchTimeSeconds / 3600, 3);
  const absenceBoost = candidate.recentStats.watchedCount === 0 ? 8 : 3;
  const freshnessBoost = Math.max(0, DYNAMIC_BILL_STRATEGY.updateWindowDays - updateAgeDays)
    / DYNAMIC_BILL_STRATEGY.updateWindowDays
    * 5;

  return Math.round((followAgeStrength + specialBoost + weakHistoryBoost + absenceBoost + freshnessBoost) * 100) / 100;
}

function toBillItem(candidate: Candidate, localRank: number, generatedAt: number): DynamicBillItem {
  const thresholds = getDynamicBillThresholdEvidence();
  const facts = buildFacts(candidate);

  return {
    billKey: `${BURIED_FOLLOW_COLUMN}:${candidate.update.updateKey}`,
    column: BURIED_FOLLOW_COLUMN,
    status: 'unopened',
    updateKey: candidate.update.updateKey,
    creatorMid: candidate.creator.mid,
    creatorName: candidate.creator.name || candidate.update.authorName,
    creatorFace: candidate.creator.face || candidate.update.authorFace,
    historyBvids: candidate.historyBvids,
    localRank,
    score: candidate.score,
    generatedAt,
    evidence: {
      kind: BURIED_FOLLOW_COLUMN,
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
      cooldownRatio: roundRatio(candidate.cooldownRatio),
      daysSinceLastWatch: candidate.daysSinceLastWatch,
      facts,
      thresholds,
    },
  };
}

function buildFacts(candidate: Candidate): string[] {
  const recent = candidate.recentStats;
  const followFact = candidate.followAgeDays !== undefined
    ? `关注关系证据：已关注约 ${candidate.followAgeDays} 天${candidate.creator.special ? '，且为特别关注' : ''}。`
    : `关注关系证据：已关注，关注时长未知${candidate.creator.special ? '，且为特别关注' : ''}。`;
  const facts = [
    followFact,
    `关注记忆信号：${formatMemorySignals(candidate.memorySignals)}；入选至少需要长期关注、特别关注或近期窗口以前 ${DYNAMIC_BILL_STRATEGY.minBuriedWeakWatchCount} 次弱观看之一。`,
    `近期缺席证据：最近 ${recent.windowDays} 天观看 ${recent.watchedCount} 次、正反馈 ${recent.positiveWatchCount} 次；规则要求观看不超过 ${DYNAMIC_BILL_STRATEGY.maxBuriedRecentWatchCount} 次且正反馈为 ${DYNAMIC_BILL_STRATEGY.maxBuriedRecentPositiveWatchCount} 次。`,
    `新投稿证据：最近 ${DYNAMIC_BILL_STRATEGY.updateWindowDays} 天，已关注 UP「${candidate.creator.name || candidate.update.authorName}」发布《${candidate.update.title || candidate.update.bvid}》。`,
    `本地最近 ${DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays} 天未发现同一新视频 ${candidate.update.bvid} 的观看记录。`,
    '入选只使用本地关注快照、观看历史聚合和最近投稿元数据，不接 AI，也不上传完整历史或完整关注列表。',
  ];

  if (candidate.daysSinceLastWatch !== null) {
    facts.push(`距上次观看该 UP 已约 ${candidate.daysSinceLastWatch} 天；本栏目不要求达到久违更新的强历史正反馈阈值。`);
  } else {
    facts.push('本地长期窗口未发现该 UP 的观看记录；本项由关注关系记忆信号支撑，而不是强历史观看正反馈。');
  }

  return facts;
}

function formatMemorySignals(signals: DynamicBillFollowMemorySignal[]): string {
  return signals.map(signal => {
    switch (signal) {
      case 'long_follow':
        return `已关注不少于 ${DYNAMIC_BILL_STRATEGY.minBuriedFollowAgeDays} 天`;
      case 'special_follow':
        return '特别关注';
      case 'weak_watch':
        return '近期窗口以前有本地弱观看';
      default:
        return signal;
    }
  }).join('、');
}

function stripRecords(stats: CreatorWindowStats): DynamicBillWindowEvidence {
  const { records: _records, ...evidence } = stats;
  return evidence;
}

function getFollowAgeDays(creator: FollowedCreator, nowSeconds: number): number | undefined {
  if (!creator.followAgeKnown || !creator.followedAt) return undefined;
  return Math.max(0, Math.floor((nowSeconds - creator.followedAt) / SECONDS_PER_DAY));
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}
