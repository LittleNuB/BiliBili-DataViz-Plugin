import type { QuickStats, DashboardOverview, CategoryDistribution, InterestDrift, DurationBucket, CreatorRanking, NewCreator, BehaviorMetrics, WeeklyTip, BlindBoxItem } from './analytics';
import type { FavoriteSyncResult, SmartFavoriteOverview, SmartFavoriteResult, SmartFavoriteSearchResponse, SmartIndexResult } from './favorite';

// Popup / Dashboard → Service Worker
export type RequestAction =
  | 'GET_QUICK_STATS'
  | 'GET_DASHBOARD_DATA'
  | 'GET_PREFERENCE_DATA'
  | 'GET_CREATOR_DATA'
  | 'GET_BEHAVIOR_DATA'
  | 'GET_EXPERIMENT_DATA'
  | 'GET_DEVICE_DATA'
  | 'SYNC_NOW'
  | 'CANCEL_SYNC'
  | 'GET_CONFIG'
  | 'UPDATE_CONFIG'
  | 'EXPORT_DATA'
  | 'EXPORT_DATA_PAGE'
  | 'GET_SYNC_STATUS'
  | 'GET_SMART_FAVORITES'
  | 'GET_SMART_FAVORITES_BY_PATH'
  | 'SYNC_FAVORITES'
  | 'BUILD_SMART_FAVORITE_INDEX'
  | 'SEARCH_SMART_FAVORITES';

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

export type HistorySyncMode = 'full' | 'incremental';

export interface SyncNowResult {
  synced: true;
  mode: HistorySyncMode;
  pageLimit: number;
  currentTask: string;
  fetchedPages: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  stoppedReason: string;
  reachedEnd: boolean;
  oldestFetchedAt: number | null;
  newestFetchedAt: number | null;
}

export interface SyncProgress {
  syncing: boolean;
  mode: HistorySyncMode | null;
  pageLimit: number;
  currentTask: string;
  startedAt: number;
  updatedAt: number;
  fetchedPages: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  stoppedReason: string;
  reachedEnd: boolean;
  oldestFetchedAt: number | null;
  newestFetchedAt: number | null;
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
export type DeviceResponse = BiliVizResponse<{
  breakdown: { label: string; deviceType: number; watchTime: number; videoCount: number; avgCompletion: number; percentage: number }[];
  hourly: { mobile: number[]; pc: number[] };
  deviceCompletion: { mobile: number; pc: number };
}>;
export type SmartFavoritesResponse = BiliVizResponse<SmartFavoriteOverview>;
export type FavoriteSyncResponse = BiliVizResponse<FavoriteSyncResult>;
export type SmartFavoriteIndexResponse = BiliVizResponse<SmartIndexResult>;
export type SmartFavoriteSearchMessageResponse = BiliVizResponse<SmartFavoriteSearchResponse>;
export type SmartFavoritePathResponse = BiliVizResponse<SmartFavoriteResult[]>;
