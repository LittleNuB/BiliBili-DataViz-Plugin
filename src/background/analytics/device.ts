import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { dateKey, startOfMonth } from '../../shared/utils/time';
import { clamp } from '../../shared/utils/math';
import { getEffectiveWatchRecordsByDateRange } from './effective-watch';

const DEVICE_LABELS: Record<number, string> = {
  0: '其他',
  1: '手机',
  2: 'PC',
  4: '平板',
  33: 'TV',
};

const MOBILE_DEVICE_TYPES = new Set([1, 3, 5, 7]);
const PAD_DEVICE_TYPES = new Set([4, 6]);
const PC_DEVICE_TYPES = new Set([2]);
const TV_DEVICE_TYPES = new Set([33]);

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

export function computeDeviceBreakdown(records: WatchHistoryRecord[]): DeviceBreakdown[] {
  const map = new Map<number, { watchTime: number; videoCount: number; totalCompletion: number }>();

  for (const r of records) {
    const dt = normalizeDeviceType(r.deviceType ?? 0);
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
  const { records } = await getEffectiveWatchRecordsByDateRange(startDate, endDate);

  const breakdown = computeDeviceBreakdown(records);
  const hourly = computeDeviceHourly(records);

  const mobileRecords = records.filter(r => isMobileLikeDevice(r.deviceType));
  const pcRecords = records.filter(r => isPcLikeDevice(r.deviceType));

  return {
    breakdown,
    hourly,
    deviceCompletion: {
      mobile: computeAvgCompletion(mobileRecords),
      pc: computeAvgCompletion(pcRecords),
    },
  };
}

function isMobileLikeDevice(deviceType: number): boolean {
  return MOBILE_DEVICE_TYPES.has(deviceType) || PAD_DEVICE_TYPES.has(deviceType);
}

function isPcLikeDevice(deviceType: number): boolean {
  return PC_DEVICE_TYPES.has(deviceType);
}

function computeAvgCompletion(records: WatchHistoryRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((s, r) => s + (r.duration > 0 ? clamp(r.progress / r.duration, 0, 1) : 0), 0) / records.length;
}

function normalizeDeviceType(deviceType: number): number {
  if (MOBILE_DEVICE_TYPES.has(deviceType)) return 1;
  if (PAD_DEVICE_TYPES.has(deviceType)) return 4;
  if (PC_DEVICE_TYPES.has(deviceType)) return 2;
  if (TV_DEVICE_TYPES.has(deviceType)) return 33;
  return 0;
}
