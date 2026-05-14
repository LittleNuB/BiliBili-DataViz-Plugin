import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { getRecordsByDateRange } from '../storage/watch-history-repo';
import { dateKey, startOfMonth } from '../../shared/utils/time';
import { clamp } from '../../shared/utils/math';
import { db } from '../storage/db';

const DEVICE_LABELS: Record<number, string> = {
  0: '其他',
  1: '手机',
  2: 'PC',
  3: '手机',
  4: '平板',
  5: '手机',
  6: '平板',
  7: '手机',
  33: 'TV',
};

const MOBILE_DEVICE_TYPES = new Set([1, 3, 5, 7]);
const PAD_DEVICE_TYPES = new Set([4, 6]);
const PC_DEVICE_TYPES = new Set([2]);
const TV_DEVICE_TYPES = new Set([33]);
const LOCAL_PC_DEVICE_TYPE = 2;
const LOCAL_PC_MATCH_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface DeviceBreakdown {
  label: string;
  deviceType: number;
  watchTime: number;
  videoCount: number;
  avgCompletion: number;
  percentage: number;
}

export interface DeviceHourlyData {
  mobile: number[];
  pc: number[];
}

interface LocalPcSession {
  bvid: string;
  cid: number;
  date: string;
  firstTimestamp: number;
  watchTime: number;
  duration: number;
}

export function computeDeviceBreakdown(records: WatchHistoryRecord[]): DeviceBreakdown[] {
  const map = new Map<number, { watchTime: number; videoCount: number; totalCompletion: number }>();

  for (const r of records) {
    const dt = r.deviceType ?? 0;
    let entry = map.get(dt);
    if (!entry) {
      entry = { watchTime: 0, videoCount: 0, totalCompletion: 0 };
      map.set(dt, entry);
    }
    entry.watchTime += r.progress > 0 ? r.progress : 0;
    entry.videoCount++;
    entry.totalCompletion += r.duration > 0 ? clamp(r.progress / r.duration, 0, 1) : 0;
  }

  const totalTime = Array.from(map.values()).reduce((s, e) => s + e.watchTime, 0);

  return Array.from(map.entries())
    .map(([dt, e]) => ({
      label: DEVICE_LABELS[dt] || '未知',
      deviceType: dt,
      watchTime: e.watchTime,
      videoCount: e.videoCount,
      avgCompletion: e.videoCount > 0 ? e.totalCompletion / e.videoCount : 0,
      percentage: totalTime > 0 ? e.watchTime / totalTime : 0,
    }))
    .sort((a, b) => b.watchTime - a.watchTime);
}

export function computeDeviceHourly(records: WatchHistoryRecord[]): DeviceHourlyData {
  const mobile = new Array(24).fill(0);
  const pc = new Array(24).fill(0);

  for (const r of records) {
    const hour = new Date(r.viewAt * 1000).getHours();
    const watchTime = r.progress > 0 ? r.progress : 0;
    if (isMobileLikeDevice(r.deviceType)) {
      mobile[hour] += watchTime;
    } else if (isPcLikeDevice(r.deviceType)) {
      pc[hour] += watchTime;
    }
  }

  return { mobile, pc };
}

export async function getDeviceData(): Promise<{
  breakdown: DeviceBreakdown[];
  hourly: DeviceHourlyData;
  deviceCompletion: { mobile: number; pc: number };
}> {
  const now = new Date();

  const startDate = dateKey(startOfMonth(now));
  const endDate = dateKey(now);
  const records = await getRecordsByDateRange(startDate, endDate);
  const recordsWithLocalPcEvidence = await applyLocalPcEvidence(records, startDate, endDate);

  const breakdown = computeDeviceBreakdown(recordsWithLocalPcEvidence);
  const hourly = computeDeviceHourly(recordsWithLocalPcEvidence);

  const mobileRecords = recordsWithLocalPcEvidence.filter(r => isMobileLikeDevice(r.deviceType));
  const pcRecords = recordsWithLocalPcEvidence.filter(r => isPcLikeDevice(r.deviceType));

  return {
    breakdown,
    hourly,
    deviceCompletion: {
      mobile: computeAvgCompletion(mobileRecords),
      pc: computeAvgCompletion(pcRecords),
    },
  };
}

async function applyLocalPcEvidence(
  records: WatchHistoryRecord[],
  startDate: string,
  endDate: string,
): Promise<WatchHistoryRecord[]> {
  const sessions = await getLocalPcSessions(startDate, endDate);
  if (sessions.length === 0) return records;

  const adjusted = records.map(r => ({ ...r }));

  for (const session of sessions) {
    const existingIndex = adjusted.findIndex(r => (
      r.bvid === session.bvid &&
      r.cid === session.cid &&
      dateKey(new Date(r.viewAt * 1000)) === session.date &&
      Math.abs(r.viewAt * 1000 - session.firstTimestamp) <= LOCAL_PC_MATCH_WINDOW_MS
    ));

    if (existingIndex >= 0) {
      adjusted[existingIndex] = {
        ...adjusted[existingIndex],
        deviceType: LOCAL_PC_DEVICE_TYPE,
      };
      continue;
    }

    adjusted.push(createLocalPcRecord(session));
  }

  return adjusted;
}

async function getLocalPcSessions(startDate: string, endDate: string): Promise<LocalPcSession[]> {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const startMs = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0).getTime();
  const endMs = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999).getTime();

  const events = await db.playerEvents.where('timestamp').between(startMs, endMs, true, true).toArray();
  const sessions = new Map<string, LocalPcSession>();

  for (const event of events) {
    if (!event.bvid || !event.cid || event.currentTime <= 0) continue;

    const eventDate = dateKey(new Date(event.timestamp));
    const key = `${event.bvid}:${event.cid}:${eventDate}`;
    const watchTime = Math.max(0, event.seekTo ?? event.currentTime);
    const duration = Math.max(0, event.duration);
    const existing = sessions.get(key);

    if (!existing) {
      sessions.set(key, {
        bvid: event.bvid,
        cid: event.cid,
        date: eventDate,
        firstTimestamp: event.timestamp,
        watchTime,
        duration,
      });
      continue;
    }

    existing.firstTimestamp = Math.min(existing.firstTimestamp, event.timestamp);
    existing.watchTime = Math.max(existing.watchTime, watchTime);
    existing.duration = Math.max(existing.duration, duration);
  }

  return Array.from(sessions.values()).map(session => ({
    ...session,
    watchTime: session.duration > 0 ? Math.min(session.watchTime, session.duration) : session.watchTime,
  }));
}

function createLocalPcRecord(session: LocalPcSession): WatchHistoryRecord {
  const duration = session.duration || session.watchTime;
  const progress = duration > 0 ? Math.min(session.watchTime, duration) : session.watchTime;

  return {
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
    progress,
    duration,
    actualCompletion: duration > 0 ? Math.min(progress / duration, 1) : 0,
    deviceType: LOCAL_PC_DEVICE_TYPE,
    isFavorite: false,
    business: 'archive',
    dt: 0,
    syncedAt: session.firstTimestamp,
  };
}

function isMobileLikeDevice(deviceType: number): boolean {
  return MOBILE_DEVICE_TYPES.has(deviceType) || PAD_DEVICE_TYPES.has(deviceType);
}

function isPcLikeDevice(deviceType: number): boolean {
  return PC_DEVICE_TYPES.has(deviceType) || TV_DEVICE_TYPES.has(deviceType) || deviceType === 0;
}

function computeAvgCompletion(records: WatchHistoryRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((s, r) => s + (r.duration > 0 ? clamp(r.progress / r.duration, 0, 1) : 0), 0) / records.length;
}
