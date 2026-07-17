import type {
  LocalDataOperationResult,
  LocalDataPrivacySummary,
  SmartFavoriteIndexRebuildResult,
} from './types/local-data-privacy';

export const LOCAL_DATA_CLEAR_CONFIRMATION = '清理本地数据';

export interface LocalDataSummaryCard {
  id: 'history' | 'favorites' | 'subtitles' | 'dynamicBill';
  title: string;
  value: string;
  detail: string;
  meta: string;
}

export function buildLocalDataSummaryCards(summary: LocalDataPrivacySummary): LocalDataSummaryCard[] {
  return [
    {
      id: 'history',
      title: '观看历史',
      value: `${summary.history.totalRecords} 条`,
      detail: summary.history.totalRecords > 0
        ? `覆盖 ${formatLocalDate(summary.history.oldestViewAt, 'seconds')} 至 ${formatLocalDate(summary.history.newestViewAt, 'seconds')}`
        : '还没有本地观看记录。',
      meta: summary.history.syncing
        ? '正在同步观看历史。'
        : `最近同步：${formatLocalDate(summary.history.lastSyncedAt, 'milliseconds')}`,
    },
    {
      id: 'favorites',
      title: '收藏与智能索引',
      value: `${summary.favorites.storedItems} 条`,
      detail: `B 站报告 ${summary.favorites.reportedItems} 条，本地保存 ${summary.favorites.storedItems} 条，已索引 ${summary.favorites.indexedItems} 条。`,
      meta: summary.favorites.incompleteFolders > 0
        ? `有 ${summary.favorites.incompleteFolders} 个收藏夹可能未同步完整。`
        : `最近同步：${formatLocalDate(summary.favorites.lastSyncedAt, 'milliseconds')}`,
    },
    {
      id: 'subtitles',
      title: '当前视频字幕缓存',
      value: `${summary.currentVideoSubtitles.segmentCount} 段`,
      detail: summary.currentVideoSubtitles.segmentCount > 0
        ? `已缓存 ${summary.currentVideoSubtitles.cachedVideoCount} 个视频的字幕正文证据。`
        : '还没有缓存的字幕正文。',
      meta: `最近缓存：${formatLocalDate(summary.currentVideoSubtitles.lastUpdatedAt, 'milliseconds')}`,
    },
    {
      id: 'dynamicBill',
      title: '动态账单',
      value: `${summary.dynamicBill.billItemCount} 项`,
      detail: `关注快照 ${summary.dynamicBill.activeFollowedCreatorCount} 位，最近视频投稿 ${summary.dynamicBill.followedVideoUpdateCount} 条，轮换记录 ${summary.dynamicBill.rotationRecordCount} 位。`,
      meta: `暂停提醒 ${summary.dynamicBill.creatorPauseCount} 位；最近生成：${formatLocalDate(summary.dynamicBill.lastGeneratedAt, 'milliseconds')}`,
    },
  ];
}

export function buildLocalDataOperationMessage(result: LocalDataOperationResult): string {
  if (result.operation === 'clear_current_video_subtitle_cache') {
    const sourceCount = result.cleared.currentVideoSubtitleSources ?? 0;
    const segmentCount = result.cleared.currentVideoSubtitleSegments ?? 0;
    return `已清理当前视频字幕缓存：移除 ${sourceCount} 条来源记录和 ${segmentCount} 段字幕正文。`;
  }
  if (result.operation === 'clear_dynamic_bill_data') {
    return `已清理动态账单本地数据：账单 ${result.cleared.dynamicBillItems ?? 0} 项、解释 ${result.cleared.dynamicBillExplanations ?? 0} 条、暂停提醒 ${result.cleared.dynamicBillCreatorPauses ?? 0} 位、轮换记录 ${result.cleared.dynamicBillRotationRecords ?? 0} 位。`;
  }

  return [
    `已清理本地数据：观看历史 ${result.cleared.historyRecords ?? 0} 条、收藏 ${result.cleared.favoriteItems ?? 0} 条、字幕正文 ${result.cleared.currentVideoSubtitleSegments ?? 0} 段、动态账单 ${result.cleared.dynamicBillItems ?? 0} 项、轮换记录 ${result.cleared.dynamicBillRotationRecords ?? 0} 位。`,
    result.cleared.localSettings ? '本地 AI 设置和功能开关也已恢复为默认状态。' : '',
  ].filter(Boolean).join(' ');
}

export function buildSmartFavoriteRebuildMessage(result: SmartFavoriteIndexRebuildResult): string {
  return [
    `智能收藏索引已重新生成：本地收藏 ${result.totalItems} 条，处理 ${result.processed} 条，成功 ${result.indexed} 条，失败 ${result.failed} 条，跳过 ${result.skipped} 条。`,
    result.failed > 0 ? '失败项可在确认 AI 设置后再次重建。' : '',
  ].filter(Boolean).join(' ');
}

export function dangerousLocalDataClearScope(): string[] {
  return [
    '观看历史、播放器事件和统计聚合。',
    '收藏夹快照、智能收藏索引和收藏问答本地依据。',
    '当前视频字幕缓存、动态账单记录、动态账单反馈和解释。',
    '本地 AI 服务设置、API Key 保存状态和功能开关。',
  ];
}

export function formatLocalDataError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'LOCAL_DATA_CLEAR_CONFIRMATION_REQUIRED') {
    return `请输入“${LOCAL_DATA_CLEAR_CONFIRMATION}”后再确认清理。`;
  }
  if (message === 'HISTORY_SYNC_IN_PROGRESS') {
    return '观看历史正在同步中。请先停止或等待同步结束，再清理本地数据。';
  }
  return '本地数据操作失败，请稍后重试。';
}

function formatLocalDate(value: number | null, unit: 'milliseconds' | 'seconds'): string {
  if (!value || value <= 0) return '暂无记录';
  const timestamp = unit === 'seconds' ? value * 1000 : value;
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
