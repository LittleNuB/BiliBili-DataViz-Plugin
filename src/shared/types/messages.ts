import type { QuickStats, DashboardOverview, CategoryDistribution, InterestDrift, DurationBucket, CreatorRanking, NewCreator, BehaviorMetrics, WeeklyTip, BlindBoxItem } from './analytics';

// Popup / Dashboard → Service Worker
export type RequestAction =
  | 'GET_QUICK_STATS'
  | 'GET_DASHBOARD_DATA'
  | 'GET_PREFERENCE_DATA'
  | 'GET_CREATOR_DATA'
  | 'GET_BEHAVIOR_DATA'
  | 'GET_EXPERIMENT_DATA'
  | 'SYNC_NOW'
  | 'UPDATE_CONFIG'
  | 'EXPORT_DATA'
  | 'GET_SYNC_STATUS';

// Content Script → Service Worker
export type ContentAction =
  | 'PLAYER_HEARTBEAT'
  | 'PLAYER_ACTION'
  | 'PAGE_NAVIGATION';

// Player events from content script
export interface PlayerHeartbeatPayload {
  bvid: string;
  cid: number;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

export interface PlayerActionPayload {
  action: 'play' | 'pause' | 'seek' | 'complete' | 'ratechange';
  bvid: string;
  cid: number;
  currentTime: number;
  duration: number;
  seekFrom?: number;
  seekTo?: number;
  playbackRate?: number;
}

export interface PageNavigationPayload {
  page: 'homepage' | 'video' | 'space' | 'other';
  url: string;
}

// Request/Response protocol
export interface BiliVizRequest {
  action: RequestAction;
  params?: Record<string, unknown>;
}

export interface BiliVizContentMessage {
  action: ContentAction;
  payload: PlayerHeartbeatPayload | PlayerActionPayload | PageNavigationPayload;
}

export interface BiliVizResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Typed response data
export type QuickStatsResponse = BiliVizResponse<QuickStats>;
export type DashboardResponse = BiliVizResponse<DashboardOverview>;
export type PreferenceResponse = BiliVizResponse<{
  categories: CategoryDistribution[];
  drift: InterestDrift[];
  durationBuckets: DurationBucket[];
  topTags: { name: string; count: number }[];
}>;
export type CreatorResponse = BiliVizResponse<{
  topCreators: CreatorRanking[];
  deepBondCreators: CreatorRanking[];
  newCreators: NewCreator[];
  overDependency: { creator: CreatorRanking; percentage: number } | null;
}>;
export type BehaviorResponse = BiliVizResponse<BehaviorMetrics>;
export type ExperimentResponse = BiliVizResponse<{
  tips: WeeklyTip[];
  blindBox: BlindBoxItem[];
}>;
