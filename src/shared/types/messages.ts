import type {
  QuickStats,
  DashboardOverview,
  PreferenceAnalytics,
  CreatorFollowDataCoverage,
  CreatorFollowStatusGroup,
  CreatorRanking,
  NewCreator,
  BehaviorMetrics,
  WeeklyTip,
  BlindBoxItem,
} from './analytics';
import type {
  DynamicBillExplanationResult,
  DynamicBillFeedbackResult,
  DynamicBillFilterPreference,
  DynamicBillGenerateResult,
  DynamicBillItem,
  DynamicBillOverview,
  DynamicSyncResult,
} from './dynamic-bill';
import type { FavoriteSyncResult, SmartFavoriteOverview, SmartFavoriteResult, SmartFavoriteSearchResponse, SmartIndexResult } from './favorite';
import type { CurrentVideoContextResult } from './current-video-context';
import type { CurrentVideoSummaryResult } from './current-video-summary';

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
  | 'GET_CURRENT_VIDEO_CONTEXT'
  | 'GET_CURRENT_VIDEO_SUMMARY'
  | 'GET_SMART_FAVORITES'
  | 'GET_SMART_FAVORITES_BY_PATH'
  | 'SYNC_FAVORITES'
  | 'BUILD_SMART_FAVORITE_INDEX'
  | 'SEARCH_SMART_FAVORITES'
  | 'GET_DYNAMIC_BILL_OVERVIEW'
  | 'SYNC_DYNAMIC_UPDATES'
  | 'GENERATE_DYNAMIC_BILL'
  | 'BUILD_DYNAMIC_BILL_EXPLANATIONS'
  | 'GET_DYNAMIC_BILL_ITEMS'
  | 'GET_DYNAMIC_BILL_FILTER'
  | 'UPDATE_DYNAMIC_BILL_FILTER'
  | 'ADD_DYNAMIC_BILL_FEEDBACK'
  | 'OPEN_DYNAMIC_BILL_VIDEO'
  | 'MARK_DYNAMIC_BILL_ITEM_PROCESSED';

// Content Script → Service Worker
export type ContentAction =
  | 'PLAYER_HEARTBEAT'
  | 'PLAYER_ACTION'
  | 'PAGE_NAVIGATION'
  | 'CURRENT_VIDEO_CONTEXT_UPDATE';

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
  payload: PlayerHeartbeatPayload | PlayerActionPayload | PageNavigationPayload | CurrentVideoContextResult;
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
export type PreferenceResponse = BiliVizResponse<PreferenceAnalytics>;
export type CreatorResponse = BiliVizResponse<{
  topCreators: CreatorRanking[];
  deepBondCreators: CreatorRanking[];
  newCreators: NewCreator[];
  followGroups: CreatorFollowStatusGroup[];
  followDataCoverage: CreatorFollowDataCoverage;
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
export type CurrentVideoContextResponse = BiliVizResponse<CurrentVideoContextResult>;
export type CurrentVideoSummaryResponse = BiliVizResponse<CurrentVideoSummaryResult>;
export type DynamicBillOverviewResponse = BiliVizResponse<DynamicBillOverview>;
export type DynamicSyncResponse = BiliVizResponse<DynamicSyncResult>;
export type DynamicBillGenerateResponse = BiliVizResponse<DynamicBillGenerateResult>;
export type DynamicBillExplanationResponse = BiliVizResponse<DynamicBillExplanationResult>;
export type DynamicBillItemsResponse = BiliVizResponse<DynamicBillItem[]>;
export type DynamicBillItemResponse = BiliVizResponse<DynamicBillItem | null>;
export type DynamicBillFilterResponse = BiliVizResponse<DynamicBillFilterPreference>;
export type DynamicBillFeedbackResponse = BiliVizResponse<DynamicBillFeedbackResult>;
