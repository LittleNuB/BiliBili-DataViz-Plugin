import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type {
  CreatorFollowDataCoverage,
  CreatorFollowDataCoverageReason,
  CreatorFollowStatus,
  CreatorFollowStatusGroup,
  CreatorRanking,
  NewCreator,
} from '../../shared/types/analytics';
import type { FollowedCreator } from '../../shared/types/dynamic-bill';
import { getRecordsByDateRange } from '../storage/watch-history-repo';
import { dateKey, startOfMonth } from '../../shared/utils/time';
import { loadConfig } from '../storage/config-store';
import { getDynamicSyncState, getFollowedCreatorSnapshot } from '../storage/dynamic-bill-repo';

interface CreatorStats {
  mid: number;
  name: string;
  face: string;
  videoCount: number;
  totalWatchTime: number;
  totalCompletion: number;
  records: WatchHistoryRecord[];
}

export function computeCreatorRanking(records: WatchHistoryRecord[]): CreatorRanking[] {
  const map = new Map<number, CreatorStats>();

  for (const r of records) {
    if (!r.authorMid) continue;
    let stat = map.get(r.authorMid);
    if (!stat) {
      stat = { mid: r.authorMid, name: r.authorName, face: '', videoCount: 0, totalWatchTime: 0, totalCompletion: 0, records: [] };
      map.set(r.authorMid, stat);
    }
    // Keep the latest name
    stat.name = r.authorName || stat.name;
    stat.videoCount++;
    stat.totalWatchTime += r.progress > 0 ? r.progress : 0;
    stat.totalCompletion += r.duration > 0 ? r.progress / r.duration : 0;
    stat.records.push(r);
  }

  const results: CreatorRanking[] = [];
  for (const [, s] of map) {
    results.push({
      mid: s.mid,
      name: s.name,
      face: s.face,
      videoCount: s.videoCount,
      totalWatchTime: s.totalWatchTime,
      avgCompletion: s.videoCount > 0 ? s.totalCompletion / s.videoCount : 0,
      isDeepBond: false,
    });
  }

  results.sort((a, b) => b.totalWatchTime - a.totalWatchTime);
  return results;
}

export function detectDeepBond(records: WatchHistoryRecord[]): CreatorRanking[] {
  const ranking = computeCreatorRanking(records);

  return ranking.filter(c => {
    if (c.avgCompletion < 0.8) return false;
    if (c.videoCount < 5) return false;

    // Check if there are 5+ consecutive views of this creator
    const creatorRecords = records
      .filter(r => r.authorMid === c.mid && r.authorMid > 0)
      .sort((a, b) => a.viewAt - b.viewAt);

    let maxConsecutive = 1;
    let current = 1;
    for (let i = 1; i < creatorRecords.length; i++) {
      const gap = creatorRecords[i].viewAt - creatorRecords[i - 1].viewAt;
      if (gap < 86_400 * 7) { // Within 7 days = consecutive engagement
        current++;
        maxConsecutive = Math.max(maxConsecutive, current);
      } else {
        current = 1;
      }
    }

    return maxConsecutive >= 5;
  }).map(c => ({ ...c, isDeepBond: true }));
}

export async function computeNewCreators(records: WatchHistoryRecord[]): Promise<NewCreator[]> {
  const monthStart = startOfMonth();
  const monthStartKey = dateKey(monthStart);

  // Records from this month vs before this month
  const thisMonth = records.filter(r => dateKey(new Date(r.viewAt * 1000)) >= monthStartKey);
  const beforeThisMonth = records.filter(r => dateKey(new Date(r.viewAt * 1000)) < monthStartKey);

  const knownCreators = new Set(beforeThisMonth.map(r => r.authorMid).filter(Boolean));

  const newMap = new Map<number, { name: string; face: string; firstDate: string; count: number }>();
  for (const r of thisMonth) {
    if (!r.authorMid || knownCreators.has(r.authorMid)) continue;
    const existing = newMap.get(r.authorMid);
    if (existing) {
      existing.count++;
    } else {
      newMap.set(r.authorMid, {
        name: r.authorName,
        face: '',
        firstDate: dateKey(new Date(r.viewAt * 1000)),
        count: 1,
      });
    }
  }

  const results: NewCreator[] = [];
  for (const [mid, info] of newMap) {
    results.push({
      mid,
      name: info.name,
      face: info.face,
      firstWatchDate: info.firstDate,
      subsequentViews: info.count - 1,
      retained: info.count > 1,
    });
  }
  results.sort((a, b) => b.subsequentViews - a.subsequentViews);
  return results;
}

export async function detectOverDependency(
  ranking: CreatorRanking[],
): Promise<{ creator: CreatorRanking; percentage: number } | null> {
  const config = await loadConfig();
  const threshold = config.overDependencyThreshold;

  if (ranking.length === 0) return null;

  const totalTime = ranking.reduce((s, c) => s + c.totalWatchTime, 0);
  if (totalTime === 0) return null;

  const top = ranking[0];
  const share = top.totalWatchTime / totalTime;

  if (share >= threshold) {
    return { creator: top, percentage: Math.round(share * 1000) / 10 };
  }

  return null;
}

export async function getCreatorData(): Promise<{
  topCreators: CreatorRanking[];
  deepBondCreators: CreatorRanking[];
  newCreators: NewCreator[];
  followGroups: CreatorFollowStatusGroup[];
  followDataCoverage: CreatorFollowDataCoverage;
  overDependency: { creator: CreatorRanking; percentage: number } | null;
}> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const records = await getRecordsByDateRange(dateKey(thirtyDaysAgo), dateKey(now));
  const [followedSnapshot, syncState] = await Promise.all([
    getFollowedCreatorSnapshot(),
    getDynamicSyncState(),
  ]);
  const followDataCoverage = buildFollowDataCoverage(followedSnapshot, syncState);
  const activeFollowedMids = new Set(
    followedSnapshot
      .filter(creator => creator.isActive !== false)
      .map(creator => creator.mid),
  );
  const ranking = applyFollowStatus(computeCreatorRanking(records), activeFollowedMids, followDataCoverage);
  const deepBond = applyFollowStatus(detectDeepBond(records), activeFollowedMids, followDataCoverage);
  const newCreators = applyNewCreatorFollowStatus(await computeNewCreators(records), activeFollowedMids, followDataCoverage);
  const overDep = await detectOverDependency(ranking);

  return {
    topCreators: ranking.slice(0, 10),
    deepBondCreators: deepBond,
    newCreators,
    followGroups: buildFollowGroups(ranking),
    followDataCoverage,
    overDependency: overDep,
  };
}

function applyFollowStatus(
  creators: CreatorRanking[],
  activeFollowedMids: Set<number>,
  coverage: CreatorFollowDataCoverage,
): CreatorRanking[] {
  return creators.map(creator => ({
    ...creator,
    followStatus: getCreatorFollowStatus(creator.mid, activeFollowedMids, coverage),
  }));
}

function applyNewCreatorFollowStatus(
  creators: NewCreator[],
  activeFollowedMids: Set<number>,
  coverage: CreatorFollowDataCoverage,
): NewCreator[] {
  return creators.map(creator => ({
    ...creator,
    followStatus: getCreatorFollowStatus(creator.mid, activeFollowedMids, coverage),
  }));
}

function getCreatorFollowStatus(
  mid: number,
  activeFollowedMids: Set<number>,
  coverage: CreatorFollowDataCoverage,
): CreatorFollowStatus {
  if (!coverage.hasSnapshot) return 'unknown';
  return activeFollowedMids.has(mid) ? 'followed' : 'not_followed';
}

function buildFollowGroups(creators: CreatorRanking[]): CreatorFollowStatusGroup[] {
  const groups: Record<CreatorFollowStatus, CreatorRanking[]> = {
    followed: [],
    not_followed: [],
    unknown: [],
  };

  for (const creator of creators) {
    groups[creator.followStatus ?? 'unknown'].push(creator);
  }

  return (['followed', 'not_followed', 'unknown'] as const).map(status => ({
    status,
    creators: groups[status],
    count: groups[status].length,
  }));
}

function buildFollowDataCoverage(
  followedSnapshot: FollowedCreator[],
  syncState: Awaited<ReturnType<typeof getDynamicSyncState>>,
): CreatorFollowDataCoverage {
  const activeFollowedCreatorCount = followedSnapshot.filter(creator => creator.isActive !== false).length;
  const snapshotSyncedAt = latestSnapshotSyncedAt(followedSnapshot, syncState.lastSuccessAt);
  const hasSnapshot = snapshotSyncedAt !== null || followedSnapshot.length > 0;

  return {
    hasSnapshot,
    reason: hasSnapshot ? 'snapshot_available' : followDataUnavailableReason(syncState.status),
    activeFollowedCreatorCount,
    snapshotSyncedAt,
    lastError: syncState.lastError,
  };
}

function latestSnapshotSyncedAt(followedSnapshot: FollowedCreator[], lastSuccessAt: number): number | null {
  const latestCreatorSync = followedSnapshot.reduce(
    (latest, creator) => Math.max(latest, creator.syncedAt || creator.lastSeenAt || 0),
    0,
  );
  const latest = Math.max(latestCreatorSync, lastSuccessAt || 0);
  return latest > 0 ? latest : null;
}

function followDataUnavailableReason(
  status: Awaited<ReturnType<typeof getDynamicSyncState>>['status'],
): CreatorFollowDataCoverageReason {
  switch (status) {
    case 'syncing':
      return 'syncing';
    case 'not_logged_in':
      return 'not_logged_in';
    case 'failed':
      return 'sync_failed';
    default:
      return 'not_synced';
  }
}
