import type {
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
const AFK_UPDATE_COLUMN = 'afk_update';

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
  score: number;
  historyBvids: string[];
}

export async function generateAfkUpdateBillItems(): Promise<DynamicBillGenerateResult> {
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
    if (longStats.positiveWatchCount < DYNAMIC_BILL_STRATEGY.minCreatorPositiveViews) {
      excludedNoLongSignalCount++;
      continue;
    }

    const recentStats = buildWindowStats(
      creatorRecords.filter(record => record.viewAt >= recentCutoff),
      DYNAMIC_BILL_STRATEGY.recentWindowDays,
      recentCutoff,
      nowSeconds,
    );
    const expectedRecentPositive = longStats.positiveWatchCount
      * (DYNAMIC_BILL_STRATEGY.recentWindowDays / DYNAMIC_BILL_STRATEGY.longWindowDays);
    const recentPositiveLimit = Math.floor(expectedRecentPositive * DYNAMIC_BILL_STRATEGY.recentCooldownRatio);
    if (recentStats.positiveWatchCount > recentPositiveLimit) {
      excludedRecentActiveCount++;
      continue;
    }

    const daysSinceLastWatch = longStats.lastWatchedAt > 0
      ? Math.floor((nowSeconds - longStats.lastWatchedAt) / SECONDS_PER_DAY)
      : null;
    const cooldownRatio = expectedRecentPositive > 0
      ? recentStats.positiveWatchCount / expectedRecentPositive
      : 0;
    const historyBvids = selectHistoryHighlights(creatorRecords, update.bvid, recentCutoff);

    candidates.push({
      creator,
      update,
      longStats,
      recentStats,
      cooldownRatio,
      daysSinceLastWatch,
      historyBvids,
      score: scoreCandidate({
        creator,
        update,
        longStats,
        recentStats,
        cooldownRatio,
        daysSinceLastWatch,
        historyBvids,
      }, nowSeconds),
    });
  }

  const items = candidates
    .sort((a, b) => b.score - a.score || b.update.dynamicTime - a.update.dynamicTime)
    .slice(0, DYNAMIC_BILL_STRATEGY.maxItemsPerColumn)
    .map((candidate, index) => toBillItem(candidate, index + 1, generatedAt));

  const storedItems = await replaceDynamicBillItemsForColumn(AFK_UPDATE_COLUMN, items);
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
      afk_update: storedItems.length,
      variety: 0,
    },
    columnEligibleCounts: {
      afk_update: candidates.length,
      variety: 0,
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
  const followAgeDays = getFollowAgeDays(candidate.creator, nowSeconds) ?? 0;
  const updateAgeDays = Math.max(0, (nowSeconds - candidate.update.dynamicTime) / SECONDS_PER_DAY);
  const watchStrength = candidate.longStats.positiveWatchCount * 10
    + Math.min(candidate.longStats.totalWatchTimeSeconds / 3600, 12)
    + candidate.longStats.avgCompletion * 8;
  const cooldownStrength = (1 - Math.min(candidate.cooldownRatio, 1)) * 18
    + Math.min(candidate.daysSinceLastWatch ?? DYNAMIC_BILL_STRATEGY.longWindowDays, 90) / 6;
  const followAgeBoost = Math.min(followAgeDays / 365, 1) * 4;
  const freshnessBoost = Math.max(0, DYNAMIC_BILL_STRATEGY.updateWindowDays - updateAgeDays)
    / DYNAMIC_BILL_STRATEGY.updateWindowDays
    * 3;

  return Math.round((watchStrength + cooldownStrength + followAgeBoost + freshnessBoost) * 100) / 100;
}

function toBillItem(candidate: Candidate, localRank: number, generatedAt: number): DynamicBillItem {
  const nowSeconds = Math.floor(generatedAt / 1000);
  const followAgeDays = getFollowAgeDays(candidate.creator, nowSeconds);
  const thresholds = getDynamicBillThresholdEvidence();
  const facts = buildFacts(candidate, followAgeDays);

  return {
    billKey: `${AFK_UPDATE_COLUMN}:${candidate.update.updateKey}`,
    column: AFK_UPDATE_COLUMN,
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
      kind: AFK_UPDATE_COLUMN,
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
        followAgeDays,
      },
      cooldownRatio: Math.round(candidate.cooldownRatio * 100) / 100,
      daysSinceLastWatch: candidate.daysSinceLastWatch,
      facts,
      thresholds,
    },
  };
}

function buildFacts(candidate: Candidate, followAgeDays?: number): string[] {
  const long = candidate.longStats;
  const recent = candidate.recentStats;
  const facts = [
    `长期 ${long.windowDays} 天内观看 ${long.watchedCount} 次，正反馈 ${long.positiveWatchCount} 次，平均完成度 ${formatPercent(long.avgCompletion)}。`,
    `近期 ${recent.windowDays} 天内观看 ${recent.watchedCount} 次，正反馈 ${recent.positiveWatchCount} 次，冷却比 ${formatPercent(candidate.cooldownRatio)}。`,
    `最近 ${DYNAMIC_BILL_STRATEGY.updateWindowDays} 天有新投稿《${candidate.update.title || candidate.update.bvid}》。`,
    `本地最近 ${DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays} 天未发现同一新视频 ${candidate.update.bvid} 的观看记录。`,
  ];

  if (candidate.daysSinceLastWatch !== null) {
    facts.push(`距上次观看该 UP 已约 ${candidate.daysSinceLastWatch} 天。`);
  }
  if (followAgeDays !== undefined) {
    facts.push(`已关注约 ${followAgeDays} 天；该信息只参与排序加权，不单独决定入选。`);
  } else {
    facts.push('关注时间未知；入选不依赖关注时长。');
  }

  return facts;
}

function stripRecords(stats: CreatorWindowStats): DynamicBillWindowEvidence {
  const { records: _records, ...evidence } = stats;
  return evidence;
}

function getFollowAgeDays(creator: FollowedCreator, nowSeconds: number): number | undefined {
  if (!creator.followAgeKnown || !creator.followedAt) return undefined;
  return Math.max(0, Math.floor((nowSeconds - creator.followedAt) / SECONDS_PER_DAY));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}
