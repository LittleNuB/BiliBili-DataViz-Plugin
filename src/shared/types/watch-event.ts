export interface WatchHistoryRecord {
  id?: number;
  sessionKey: string;
  kid: number;
  avid: number;
  bvid: string;
  cid: number;
  title: string;
  authorName: string;
  authorMid: number;
  tagName: string;
  tags: string[];
  cover: string;
  viewAt: number;
  progress: number;
  duration: number;
  actualCompletion: number;
  deviceType: number;
  isFavorite: boolean;
  business: string;
  dt: number;
  syncedAt: number;
}

export interface PlayerEvent {
  id?: number;
  bvid: string;
  cid: number;
  eventType: 'play' | 'pause' | 'seek' | 'complete' | 'heartbeat' | 'ratechange';
  timestamp: number;
  currentTime: number;
  duration: number;
  playbackRate: number;
  seekFrom?: number;
  seekTo?: number;
  tabId: number;
}

export interface DailyAggregate {
  id?: number;
  date: string;
  totalWatchTime: number;
  videoCount: number;
  avgCompletion: number;
  uniqueCreators: number;
  uniqueCategories: number;
  sessions: number;
  totalSeeks: number;
  totalPauses: number;
  avgDecisionTime: number;
  categoryBreakdown: Record<string, number>;
  creatorBreakdown: Record<string, number>;
  durationBreakdown: Record<string, number>;
  hourlyHeatmap: number[][];
  efficiencyScore: number;
}
