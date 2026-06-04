import type {
  DynamicBillGenerateResult,
  DynamicBillInterestKind,
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
const VARIETY_COLUMN = 'variety';

interface InterestSignal {
  key: string;
  kind: DynamicBillInterestKind;
  label: string;
}

interface InterestWindowStats extends DynamicBillWindowEvidence {
  records: WatchHistoryRecord[];
  positiveShare: number;
}

interface EligibleInterest {
  key: string;
  kind: DynamicBillInterestKind;
  label: string;
  longStats: InterestWindowStats;
  recentStats: InterestWindowStats;
  cooldownRatio: number;
  positiveDropRatio: number;
  longPositiveShare: number;
  recentPositiveShare: number;
  expectedRecentPositive: number;
}

interface InterestSelection {
  interests: EligibleInterest[];
  excludedNoLongSignalCount: number;
  excludedRecentActiveCount: number;
}

interface VarietyCandidate {
  creator: FollowedCreator;
  update: FollowedVideoUpdate;
  interest: EligibleInterest;
  matchedNewVideoLabels: string[];
  daysSinceLastWatch: number | null;
  historyBvids: string[];
  score: number;
}

export async function generateVarietyBillItems(): Promise<DynamicBillGenerateResult> {
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
  const recentlyWatchedBvids = new Set(
    longRecords
      .filter(record => record.viewAt >= recentSameVideoCutoff)
      .map(record => record.bvid)
      .filter(Boolean),
  );

  let excludedRecentSameVideoCount = 0;
  const unwatchedUpdates: FollowedVideoUpdate[] = [];
  for (const update of updates) {
    if (!activeCreatorsByMid.has(update.authorMid)) continue;
    if (recentlyWatchedBvids.has(update.bvid)) {
      excludedRecentSameVideoCount++;
      continue;
    }
    unwatchedUpdates.push(update);
  }

  const recentRecords = longRecords.filter(record => record.viewAt >= recentCutoff);
  const totalLongPositiveCount = longRecords.filter(isPositiveWatch).length;
  const totalRecentPositiveCount = recentRecords.filter(isPositiveWatch).length;
  const interestSelection = buildEligibleInterests(
    longRecords,
    recentCutoff,
    nowSeconds,
    totalLongPositiveCount,
    totalRecentPositiveCount,
  );
  const eligibleInterestsByKey = new Map(
    interestSelection.interests.map(interest => [interest.key, interest]),
  );

  const candidates: VarietyCandidate[] = [];
  let excludedNoMatchingInterestUpdateCount = 0;

  for (const update of unwatchedUpdates) {
    const creator = activeCreatorsByMid.get(update.authorMid);
    if (!creator) continue;

    const updateSignals = getUpdateInterestSignals(update);
    const matchedInterests = updateSignals
      .map(signal => eligibleInterestsByKey.get(signal.key))
      .filter((interest): interest is EligibleInterest => Boolean(interest));

    if (matchedInterests.length === 0) {
      excludedNoMatchingInterestUpdateCount++;
      continue;
    }

    const interest = selectBestInterestForUpdate(matchedInterests, updateSignals);
    const daysSinceLastWatch = interest.longStats.lastWatchedAt > 0
      ? Math.floor((nowSeconds - interest.longStats.lastWatchedAt) / SECONDS_PER_DAY)
      : null;
    const matchedNewVideoLabels = updateSignals
      .filter(signal => signal.key === interest.key)
      .map(signal => signal.label);
    const historyBvids = selectHistoryHighlights(interest.longStats.records, update.bvid, recentCutoff);

    const candidate: Omit<VarietyCandidate, 'score'> = {
      creator,
      update,
      interest,
      matchedNewVideoLabels,
      daysSinceLastWatch,
      historyBvids,
    };

    candidates.push({
      ...candidate,
      score: scoreVarietyCandidate(candidate, nowSeconds),
    });
  }

  const items = candidates
    .sort((a, b) => b.score - a.score || b.update.dynamicTime - a.update.dynamicTime)
    .slice(0, DYNAMIC_BILL_STRATEGY.maxItemsPerColumn)
    .map((candidate, index) => toBillItem(candidate, index + 1, generatedAt));

  const storedItems = await replaceDynamicBillItemsForColumn(VARIETY_COLUMN, items);
  const overview = await getDynamicBillOverview(DYNAMIC_BILL_STRATEGY.updateWindowDays);

  return {
    generatedAt,
    itemCount: storedItems.length,
    candidatesScanned: updates.length,
    eligibleCreatorCount: candidates.length,
    excludedNoLongSignalCount:
      interestSelection.excludedNoLongSignalCount + excludedNoMatchingInterestUpdateCount,
    excludedRecentActiveCount: interestSelection.excludedRecentActiveCount,
    excludedRecentSameVideoCount,
    columnItemCounts: {
      afk_update: 0,
      variety: storedItems.length,
    },
    columnEligibleCounts: {
      afk_update: 0,
      variety: candidates.length,
    },
    items: storedItems,
    thresholds,
    overview,
  };
}

function buildEligibleInterests(
  records: WatchHistoryRecord[],
  recentCutoff: number,
  nowSeconds: number,
  totalLongPositiveCount: number,
  totalRecentPositiveCount: number,
): InterestSelection {
  const recordsByInterest = groupRecordsByInterest(records);
  const interests: EligibleInterest[] = [];
  let excludedNoLongSignalCount = 0;
  let excludedRecentActiveCount = 0;

  for (const [key, interestRecords] of recordsByInterest) {
    const signal = parseInterestKey(key);
    if (!signal) continue;

    const longStats = buildWindowStats(
      interestRecords,
      DYNAMIC_BILL_STRATEGY.longWindowDays,
      nowSeconds - DYNAMIC_BILL_STRATEGY.longWindowDays * SECONDS_PER_DAY,
      nowSeconds,
      totalLongPositiveCount,
    );

    if (
      longStats.positiveWatchCount < DYNAMIC_BILL_STRATEGY.minInterestPositiveViews
      || longStats.positiveShare < DYNAMIC_BILL_STRATEGY.minInterestLongPositiveShare
    ) {
      excludedNoLongSignalCount++;
      continue;
    }

    const recentStats = buildWindowStats(
      interestRecords.filter(record => record.viewAt >= recentCutoff),
      DYNAMIC_BILL_STRATEGY.recentWindowDays,
      recentCutoff,
      nowSeconds,
      totalRecentPositiveCount,
    );
    const expectedRecentPositive = longStats.positiveWatchCount
      * (DYNAMIC_BILL_STRATEGY.recentWindowDays / DYNAMIC_BILL_STRATEGY.longWindowDays);
    const cooldownRatio = expectedRecentPositive > 0
      ? recentStats.positiveWatchCount / expectedRecentPositive
      : 0;

    if (cooldownRatio > DYNAMIC_BILL_STRATEGY.maxInterestRecentPositiveRatio) {
      excludedRecentActiveCount++;
      continue;
    }

    interests.push({
      ...signal,
      longStats,
      recentStats,
      cooldownRatio,
      positiveDropRatio: 1 - Math.min(cooldownRatio, 1),
      longPositiveShare: longStats.positiveShare,
      recentPositiveShare: recentStats.positiveShare,
      expectedRecentPositive,
    });
  }

  return { interests, excludedNoLongSignalCount, excludedRecentActiveCount };
}

function groupRecordsByInterest(records: WatchHistoryRecord[]): Map<string, WatchHistoryRecord[]> {
  const groups = new Map<string, WatchHistoryRecord[]>();

  for (const record of records) {
    for (const signal of getRecordInterestSignals(record)) {
      const bucket = groups.get(signal.key) ?? [];
      bucket.push(record);
      groups.set(signal.key, bucket);
    }
  }

  return groups;
}

function getRecordInterestSignals(record: WatchHistoryRecord): InterestSignal[] {
  return uniqueSignals([
    toInterestSignal('category', record.tagName),
    ...(record.tags ?? []).map(tag => toInterestSignal('tag', tag)),
  ]);
}

function getUpdateInterestSignals(update: FollowedVideoUpdate): InterestSignal[] {
  return uniqueSignals([
    toInterestSignal('category', update.tagName),
    ...(update.tags ?? []).map(tag => toInterestSignal('tag', tag)),
  ]);
}

function uniqueSignals(signals: Array<InterestSignal | null>): InterestSignal[] {
  const result: InterestSignal[] = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    if (!signal || seen.has(signal.key)) continue;
    seen.add(signal.key);
    result.push(signal);
  }

  return result;
}

function toInterestSignal(kind: DynamicBillInterestKind, rawLabel: string | undefined): InterestSignal | null {
  const label = rawLabel?.trim();
  if (!label) return null;
  return {
    key: `${kind}:${label}`,
    kind,
    label,
  };
}

function parseInterestKey(key: string): InterestSignal | null {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex <= 0) return null;

  const kind = key.slice(0, separatorIndex);
  const label = key.slice(separatorIndex + 1);
  if ((kind !== 'category' && kind !== 'tag') || !label) return null;

  return {
    key,
    kind,
    label,
  };
}

function buildWindowStats(
  records: WatchHistoryRecord[],
  windowDays: number,
  startedAt: number,
  endedAt: number,
  totalPositiveCount: number,
): InterestWindowStats {
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
    positiveShare: totalPositiveCount > 0 ? positiveWatchCount / totalPositiveCount : 0,
    records,
  };
}

function selectBestInterestForUpdate(
  interests: EligibleInterest[],
  updateSignals: InterestSignal[],
): EligibleInterest {
  const updateSignalOrder = new Map(updateSignals.map((signal, index) => [signal.key, index]));

  return [...interests].sort((a, b) => {
    const scoreDelta = scoreInterest(b) - scoreInterest(a);
    if (scoreDelta !== 0) return scoreDelta;
    return (updateSignalOrder.get(a.key) ?? 999) - (updateSignalOrder.get(b.key) ?? 999);
  })[0];
}

function scoreInterest(interest: EligibleInterest): number {
  const kindBoost = interest.kind === 'tag' ? 1.5 : 0;
  return interest.longStats.positiveWatchCount * 4
    + interest.longPositiveShare * 35
    + interest.positiveDropRatio * 18
    + kindBoost;
}

function scoreVarietyCandidate(
  candidate: Omit<VarietyCandidate, 'score'>,
  nowSeconds: number,
): number {
  const followAgeDays = getFollowAgeDays(candidate.creator, nowSeconds) ?? 0;
  const updateAgeDays = Math.max(0, (nowSeconds - candidate.update.dynamicTime) / SECONDS_PER_DAY);
  const interestStrength = candidate.interest.longStats.positiveWatchCount * 7
    + candidate.interest.longPositiveShare * 40
    + candidate.interest.longStats.avgCompletion * 8;
  const dropStrength = candidate.interest.positiveDropRatio * 24;
  const freshnessBoost = Math.max(0, DYNAMIC_BILL_STRATEGY.updateWindowDays - updateAgeDays)
    / DYNAMIC_BILL_STRATEGY.updateWindowDays
    * 5;
  const followAgeBoost = Math.min(followAgeDays / 365, 1) * 2;
  const tagSpecificBoost = candidate.interest.kind === 'tag' ? 2 : 0;

  return Math.round((interestStrength + dropStrength + freshnessBoost + followAgeBoost + tagSpecificBoost) * 100) / 100;
}

function toBillItem(candidate: VarietyCandidate, localRank: number, generatedAt: number): DynamicBillItem {
  const nowSeconds = Math.floor(generatedAt / 1000);
  const followAgeDays = getFollowAgeDays(candidate.creator, nowSeconds);
  const thresholds = getDynamicBillThresholdEvidence();
  const facts = buildFacts(candidate, followAgeDays);

  return {
    billKey: `${VARIETY_COLUMN}:${candidate.interest.key}:${candidate.update.updateKey}`,
    column: VARIETY_COLUMN,
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
      kind: VARIETY_COLUMN,
      longWindow: stripRecords(candidate.interest.longStats),
      recentWindow: stripRecords(candidate.interest.recentStats),
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
      interest: {
        key: candidate.interest.key,
        kind: candidate.interest.kind,
        label: candidate.interest.label,
        longPositiveShare: roundRatio(candidate.interest.longPositiveShare),
        recentPositiveShare: roundRatio(candidate.interest.recentPositiveShare),
        positiveDropRatio: roundRatio(candidate.interest.positiveDropRatio),
        matchedNewVideoLabels: candidate.matchedNewVideoLabels,
      },
      cooldownRatio: roundRatio(candidate.interest.cooldownRatio),
      daysSinceLastWatch: candidate.daysSinceLastWatch,
      facts,
      thresholds,
    },
  };
}

function buildFacts(candidate: VarietyCandidate, followAgeDays?: number): string[] {
  const interest = candidate.interest;
  const long = interest.longStats;
  const recent = interest.recentStats;
  const interestName = `${formatInterestKind(interest.kind)}「${interest.label}」`;
  const expectedRecent = formatCount(interest.expectedRecentPositive);
  const facts = [
    `长期 ${long.windowDays} 天内，${interestName}观看 ${long.watchedCount} 次，正反馈 ${long.positiveWatchCount} 次，占长期正反馈 ${formatPercent(interest.longPositiveShare)}。`,
    `近期 ${recent.windowDays} 天内，${interestName}正反馈 ${recent.positiveWatchCount} 次；按长期节奏预期约 ${expectedRecent} 次，下降 ${formatPercent(interest.positiveDropRatio)}。`,
    `最近 ${DYNAMIC_BILL_STRATEGY.updateWindowDays} 天，已关注 UP「${candidate.creator.name || candidate.update.authorName}」发布新投稿《${candidate.update.title || candidate.update.bvid}》，命中 ${interestName}。`,
    `本地最近 ${DYNAMIC_BILL_STRATEGY.recentSameVideoWindowDays} 天未发现同一新视频 ${candidate.update.bvid} 的观看记录。`,
    '入选只由本地分区/标签落差和已关注 UP 新投稿决定，未使用 AI 主题簇。',
  ];

  if (candidate.daysSinceLastWatch !== null) {
    facts.push(`距上次观看该兴趣约 ${candidate.daysSinceLastWatch} 天。`);
  }
  if (followAgeDays !== undefined) {
    facts.push(`已关注该 UP 约 ${followAgeDays} 天；关注时长只参与排序加权，不单独决定入选。`);
  } else {
    facts.push('关注时间未知；入选不依赖关注时长。');
  }

  return facts;
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

function stripRecords(stats: InterestWindowStats): DynamicBillWindowEvidence {
  const { records: _records, positiveShare: _positiveShare, ...evidence } = stats;
  return evidence;
}

function getFollowAgeDays(creator: FollowedCreator, nowSeconds: number): number | undefined {
  if (!creator.followAgeKnown || !creator.followedAt) return undefined;
  return Math.max(0, Math.floor((nowSeconds - creator.followedAt) / SECONDS_PER_DAY));
}

function formatInterestKind(kind: DynamicBillInterestKind): string {
  return kind === 'category' ? '分区' : '标签';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCount(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}
