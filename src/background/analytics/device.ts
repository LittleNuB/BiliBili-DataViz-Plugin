import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { getRecordsByDateRange } from '../storage/watch-history-repo';
import { dateKey } from '../../shared/utils/time';

const DEVICE_LABELS: Record<number, string> = {
  1: '手机',
  2: '平板',
  3: 'PC',
  4: 'TV',
};

export interface DeviceBreakdown {
  label: string;
  deviceType: number;
  watchTime: number;
  videoCount: number;
  avgCompletion: number;
  percentage: number;
}

export interface DeviceHourlyData {
  mobile: number[];  // 24 hours
  pc: number[];      // 24 hours
}

export function computeDeviceBreakdown(records: WatchHistoryRecord[]): DeviceBreakdown[] {
  const map = new Map<number, { watchTime: number; videoCount: number; totalCompletion: number }>();

  for (const r of records) {
    const dt = r.deviceType || 3;
    let entry = map.get(dt);
    if (!entry) {
      entry = { watchTime: 0, videoCount: 0, totalCompletion: 0 };
      map.set(dt, entry);
    }
    entry.watchTime += r.progress > 0 ? r.progress : 0;
    entry.videoCount++;
    entry.totalCompletion += r.duration > 0 ? r.progress / r.duration : 0;
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
    if (r.deviceType === 1 || r.deviceType === 2) {
      mobile[hour] += watchTime;
    } else {
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
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const records = await getRecordsByDateRange(dateKey(thirtyDaysAgo), dateKey(now));
  const breakdown = computeDeviceBreakdown(records);
  const hourly = computeDeviceHourly(records);

  // Completion rate by device category
  const mobileRecords = records.filter(r => r.deviceType === 1 || r.deviceType === 2);
  const pcRecords = records.filter(r => r.deviceType === 3 || r.deviceType === 4 || !r.deviceType);

  const mobileCompletion = mobileRecords.length > 0
    ? mobileRecords.reduce((s, r) => s + (r.duration > 0 ? r.progress / r.duration : 0), 0) / mobileRecords.length
    : 0;
  const pcCompletion = pcRecords.length > 0
    ? pcRecords.reduce((s, r) => s + (r.duration > 0 ? r.progress / r.duration : 0), 0) / pcRecords.length
    : 0;

  return {
    breakdown,
    hourly,
    deviceCompletion: { mobile: mobileCompletion, pc: pcCompletion },
  };
}
