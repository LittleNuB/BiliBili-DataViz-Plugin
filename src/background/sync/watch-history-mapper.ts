import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type { HistoryCursorItem, VideoInfo } from '../../shared/types/video-info';
import { buildWatchSessionKey } from '../../shared/utils/session-key';

export function getHistoryAvid(item: HistoryCursorItem): number {
  return item.avid ?? item.history?.oid ?? 0;
}

export function getHistoryBvid(item: HistoryCursorItem): string {
  return item.bvid || item.history?.bvid || '';
}

export function getHistoryCid(item: HistoryCursorItem): number {
  return item.cid ?? item.history?.cid ?? 0;
}

export function getHistoryBusiness(item: HistoryCursorItem): string {
  return item.business || item.history?.business || '';
}

export function getHistoryDeviceType(item: HistoryCursorItem): number {
  return item.history?.dt ?? item.dt ?? item.device ?? 0;
}

export function toWatchHistoryRecord(item: HistoryCursorItem, info?: VideoInfo): WatchHistoryRecord {
  const duration = item.duration || info?.duration || 0;
  const tags = item.tags ? item.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  return {
    sessionKey: buildWatchSessionKey(item.kid, item.view_at, getHistoryBvid(item) || info?.bvid || '', getHistoryCid(item)),
    kid: item.kid,
    avid: getHistoryAvid(item) || info?.avid || 0,
    bvid: getHistoryBvid(item) || info?.bvid || '',
    cid: getHistoryCid(item),
    title: item.title || info?.title || '',
    authorName: item.author_name || info?.owner?.name || '',
    authorMid: item.author_mid || info?.owner?.mid || 0,
    tagName: item.tag_name || info?.tname || '',
    tags: tags.length > 0 ? tags : Array.isArray(info?.tags) ? info.tags : [],
    cover: item.cover || info?.pic || '',
    viewAt: item.view_at,
    progress: item.progress,
    duration,
    actualCompletion: duration > 0 ? Math.min(item.progress / duration, 1) : 0,
    deviceType: getHistoryDeviceType(item),
    isFavorite: item.is_fav !== 0,
    business: getHistoryBusiness(item),
    dt: item.dt ?? 0,
    syncedAt: Date.now(),
  };
}
