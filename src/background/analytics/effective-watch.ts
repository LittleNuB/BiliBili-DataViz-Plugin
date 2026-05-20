import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { dateKey } from '../../shared/utils/time';
import { clamp } from '../../shared/utils/math';
import { db } from '../storage/db';
import { getRecordsByDateRange } from '../storage/watch-history-repo';

const LOCAL_PC_DEVICE_TYPE = 2;
const MAX_EVENT_GAP_SECONDS = 15;
const MAX_PROGRESS_DELTA_SECONDS = 15;

export interface EffectiveWatchResult {
  records: WatchHistoryRecord[];
  localPcWatchTime: number;
  localPcDates: string[];
  localPcRecordCount: number;
}

interface LocalPcSession {
  bvid: string;
  cid: number;
  date: string;
  firstTimestamp: number;
  lastTimestamp: number;
  watchTime: number;
  duration: number;
}

interface EventPoint {
  timestamp: number;
  currentTime: number;
  duration: number;
}

export async function getEffectiveWatchRecordsByDateRange(
  startDate: string,
  endDate: string,
): Promise<EffectiveWatchResult> {
  const records = await getRecordsByDateRange(startDate, endDate);
  const localSessions = await getLocalPcSessions(startDate, endDate);
  if (localSessions.length === 0) {
    return {
      records,
      localPcWatchTime: 0,
      localPcDates: [],
      localPcRecordCount: 0,
    };
  }

  const adjusted = records.map(r => ({ ...r }));
  let localPcWatchTime = 0;

  for (const session of localSessions) {
    localPcWatchTime += session.watchTime;
    const matching = adjusted.filter(r => isSameVideoDate(r, session));

    if (matching.length > 0) {
      const existing = matching.sort((a, b) => b.viewAt - a.viewAt)[0];
      for (let i = adjusted.length - 1; i >= 0; i--) {
        if (isSameVideoDate(adjusted[i], session)) adjusted.splice(i, 1);
      }
      adjusted.push({
        ...existing,
        deviceType: LOCAL_PC_DEVICE_TYPE,
        progress: Math.max(session.watchTime, 0),
        duration: session.duration || existing.duration || session.watchTime,
        actualCompletion: computeCompletion(session.watchTime, session.duration || existing.duration),
        viewAt: Math.floor(session.firstTimestamp / 1000),
        syncedAt: session.lastTimestamp,
      });
      continue;
    }

    adjusted.push(createLocalPcRecord(session));
  }

  return {
    records: adjusted,
    localPcWatchTime,
    localPcDates: Array.from(new Set(localSessions.map(s => s.date))).sort(),
    localPcRecordCount: localSessions.length,
  };
}

export async function getEffectiveWatchDatesByDateRange(
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const result = await getEffectiveWatchRecordsByDateRange(startDate, endDate);
  return Array.from(new Set(result.records.map(r => dateKey(new Date(r.viewAt * 1000))))).sort();
}

async function getLocalPcSessions(startDate: string, endDate: string): Promise<LocalPcSession[]> {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const startMs = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0).getTime();
  const endMs = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999).getTime();
  const events = await db.playerEvents.where('timestamp').between(startMs, endMs, true, true).toArray();
  const groups = new Map<string, EventPoint[]>();

  for (const event of events) {
    if (!event.bvid || event.currentTime <= 0) continue;
    const eventDate = dateKey(new Date(event.timestamp));
    const key = `${event.bvid}:${event.cid}:${eventDate}`;
    const bucket = groups.get(key) ?? [];
    bucket.push({
      timestamp: event.timestamp,
      currentTime: event.seekTo ?? event.currentTime,
      duration: event.duration,
    });
    groups.set(key, bucket);
  }

  const sessions: LocalPcSession[] = [];
  for (const [key, points] of groups) {
    const [bvid, cidText, date] = key.split(':');
    const sorted = points.sort((a, b) => a.timestamp - b.timestamp);
    const watchTime = estimateWatchTime(sorted);
    if (watchTime <= 0) continue;

    sessions.push({
      bvid,
      cid: Number(cidText),
      date,
      firstTimestamp: sorted[0].timestamp,
      lastTimestamp: sorted[sorted.length - 1].timestamp,
      watchTime,
      duration: Math.max(...sorted.map(p => p.duration), 0),
    });
  }

  return sessions;
}

function estimateWatchTime(points: EventPoint[]): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return Math.max(0, Math.min(points[0].currentTime, points[0].duration || points[0].currentTime));

  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const timeDelta = Math.max(0, (curr.timestamp - prev.timestamp) / 1000);
    const progressDelta = curr.currentTime - prev.currentTime;

    if (progressDelta <= 0) continue;
    total += Math.min(timeDelta || progressDelta, progressDelta, MAX_EVENT_GAP_SECONDS, MAX_PROGRESS_DELTA_SECONDS);
  }

  if (total === 0) {
    const maxProgress = Math.max(...points.map(p => p.currentTime));
    const minProgress = Math.min(...points.map(p => p.currentTime));
    total = Math.max(0, maxProgress - minProgress);
  }

  const duration = Math.max(...points.map(p => p.duration), 0);
  return duration > 0 ? clamp(total, 0, duration) : total;
}

function isSameVideoDate(record: WatchHistoryRecord, session: LocalPcSession): boolean {
  if (record.bvid !== session.bvid) return false;
  if (dateKey(new Date(record.viewAt * 1000)) !== session.date) return false;
  return record.cid === session.cid || record.cid === 0 || session.cid === 0;
}

function createLocalPcRecord(session: LocalPcSession): WatchHistoryRecord {
  const duration = session.duration || session.watchTime;

  return {
    sessionKey: `local-pc:${session.bvid}:${session.cid}:${session.date}`,
    kid: -session.firstTimestamp,
    avid: 0,
    bvid: session.bvid,
    cid: session.cid,
    title: '',
    authorName: '',
    authorMid: 0,
    tagName: '',
    tags: [],
    cover: '',
    viewAt: Math.floor(session.firstTimestamp / 1000),
    progress: session.watchTime,
    duration,
    actualCompletion: computeCompletion(session.watchTime, duration),
    deviceType: LOCAL_PC_DEVICE_TYPE,
    isFavorite: false,
    business: 'archive',
    dt: 0,
    syncedAt: session.lastTimestamp,
  };
}

function computeCompletion(progress: number, duration: number): number {
  return duration > 0 ? clamp(progress / duration, 0, 1) : 0;
}
