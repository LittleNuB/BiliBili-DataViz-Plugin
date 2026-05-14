import type { WatchHistoryRecord, PlayerEvent } from '../../shared/types/watch-event';
import type { CompletionBucket, SessionPattern, BehaviorMetrics } from '../../shared/types/analytics';
import { COMPLETION_BUCKETS } from '../../shared/constants';
import { getRecordsByDateRange } from '../storage/watch-history-repo';
import { dateKey } from '../../shared/utils/time';
import { clamp } from '../../shared/utils/math';
import { db } from '../storage/db';

export function computeCompletionDistribution(records: WatchHistoryRecord[]): CompletionBucket[] {
  const buckets = new Map<string, number>();
  for (const b of COMPLETION_BUCKETS) buckets.set(b.label, 0);

  for (const r of records) {
    const rate = r.duration > 0 ? clamp(r.progress / r.duration, 0, 1) : 0;
    for (let i = 0; i < COMPLETION_BUCKETS.length; i++) {
      const b = COMPLETION_BUCKETS[i];
      const isLast = i === COMPLETION_BUCKETS.length - 1;
      if (rate >= b.range[0] && (rate < b.range[1] || (isLast && rate <= b.range[1]))) {
        buckets.set(b.label, (buckets.get(b.label) ?? 0) + 1);
        break;
      }
    }
  }

  return COMPLETION_BUCKETS.map(b => ({
    label: b.label,
    range: b.range,
    count: buckets.get(b.label) ?? 0,
  }));
}

export function detectSessionPatterns(records: WatchHistoryRecord[]): SessionPattern {
  if (records.length === 0) {
    return { avgVideosPerSession: 0, avgSessionDuration: 0, weekdayAvg: 0, weekendAvg: 0, peakHours: [] };
  }

  // Sort by view time
  const sorted = [...records].sort((a, b) => a.viewAt - b.viewAt);

  // Split into sessions: gap > 30 minutes = new session
  const SESSION_GAP = 1800; // 30 minutes in seconds
  const sessions: WatchHistoryRecord[][] = [];
  let currentSession: WatchHistoryRecord[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].viewAt - sorted[i - 1].viewAt;
    if (gap > SESSION_GAP) {
      sessions.push(currentSession);
      currentSession = [sorted[i]];
    } else {
      currentSession.push(sorted[i]);
    }
  }
  sessions.push(currentSession);

  // Compute session metrics
  const videosPerSession = sessions.map(s => s.length);
  const avgVideos = videosPerSession.reduce((a, b) => a + b, 0) / sessions.length;

  // Session duration (first to last view in each session)
  const durations = sessions.map(s => {
    if (s.length === 1) return 0;
    return s[s.length - 1].viewAt - s[0].viewAt;
  });
  const avgDuration = durations.reduce((a, b) => a + b, 0) / sessions.length;

  // Weekday vs weekend
  let weekdayTotal = 0;
  let weekdayCount = 0;
  let weekendTotal = 0;
  let weekendCount = 0;

  // Peak hours
  const hourCounts = new Array(24).fill(0);

  for (const r of records) {
    const d = new Date(r.viewAt * 1000);
    const day = d.getDay();
    const hour = d.getHours();
    hourCounts[hour]++;

    if (day === 0 || day === 6) {
      weekendTotal += r.progress;
      weekendCount++;
    } else {
      weekdayTotal += r.progress;
      weekdayCount++;
    }
  }

  // Top 3 peak hours
  const hourPairs = hourCounts.map((count, hour) => ({ hour, count }));
  hourPairs.sort((a, b) => b.count - a.count);
  const peakHours = hourPairs.slice(0, 3).map(h => h.hour);

  return {
    avgVideosPerSession: Math.round(avgVideos * 10) / 10,
    avgSessionDuration: Math.round(avgDuration),
    weekdayAvg: weekdayCount > 0 ? weekdayTotal / weekdayCount : 0,
    weekendAvg: weekendCount > 0 ? weekendTotal / weekendCount : 0,
    peakHours,
  };
}

export async function getBehaviorData(): Promise<BehaviorMetrics> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const records = await getRecordsByDateRange(dateKey(thirtyDaysAgo), dateKey(now));
  const events = await db.playerEvents
    .where('timestamp')
    .between(thirtyDaysAgo.getTime(), now.getTime(), true, true)
    .toArray();
  const seekEvents = events.filter(e => e.eventType === 'seek');
  const pauseEvents = events.filter(e => e.eventType === 'pause');
  const seekFromValues = seekEvents.map(e => e.seekFrom).filter((v): v is number => typeof v === 'number');
  const seekToValues = seekEvents.map(e => e.seekTo).filter((v): v is number => typeof v === 'number');

  return {
    completionDistribution: computeCompletionDistribution(records),
    totalSeeks: seekEvents.length,
    avgSeeksPerVideo: records.length > 0 ? Math.round((seekEvents.length / records.length) * 10) / 10 : 0,
    commonSeekRange: [averageNumber(seekFromValues), averageNumber(seekToValues)] as [number, number],
    sessionPattern: detectSessionPatterns(records),
    avgDecisionTime: computeAvgDecisionTime(records, events),
    totalPauses: pauseEvents.length,
  };
}

function averageNumber(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function computeAvgDecisionTime(records: WatchHistoryRecord[], events: PlayerEvent[]): number {
  const values: number[] = [];

  for (const r of records) {
    const firstPlay = events
      .filter(e => e.eventType === 'play' && e.bvid === r.bvid && e.cid === r.cid)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    if (!firstPlay) continue;

    const seconds = Math.round(firstPlay.timestamp / 1000 - r.viewAt);
    if (seconds >= 0 && seconds <= 600) {
      values.push(seconds);
    }
  }

  return averageNumber(values);
}
