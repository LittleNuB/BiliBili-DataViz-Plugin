export interface FollowedCreator {
  id?: number;
  mid: number;
  name: string;
  face: string;
  sign: string;
  followedAt?: number;
  followAgeKnown: boolean;
  special: boolean;
  attribute: number;
  tagId: number;
  isActive: boolean;
  syncedAt: number;
  lastSeenAt: number;
}

export interface FollowedVideoUpdate {
  id?: number;
  updateKey: string;
  dynamicId: string;
  bvid: string;
  avid: number;
  title: string;
  intro: string;
  cover: string;
  duration: number;
  pubtime: number;
  dynamicTime: number;
  authorMid: number;
  authorName: string;
  authorFace: string;
  tagName: string;
  tags: string[];
  syncedAt: number;
}

export type DynamicSyncStatus = 'idle' | 'syncing' | 'success' | 'not_logged_in' | 'failed';
export type DynamicSyncStage = 'idle' | 'following' | 'dynamic-feed' | 'video-detail' | 'storage' | 'complete';

export interface DynamicSyncState {
  status: DynamicSyncStatus;
  stage: DynamicSyncStage;
  lastStartedAt: number;
  lastFinishedAt: number;
  lastSuccessAt: number;
  lastError?: string;
}

export interface DynamicBillOverview {
  syncState: DynamicSyncState;
  followedCreatorCount: number;
  activeFollowedCreatorCount: number;
  followAgeKnownCount: number;
  followAgeUnknownCount: number;
  recentVideoUpdateCount: number;
  lastVideoDynamicTime: number;
  updateWindowDays: number;
}

export interface DynamicSyncResult {
  status: DynamicSyncStatus;
  stage: DynamicSyncStage;
  startedAt: number;
  finishedAt: number;
  followedCreatorsFetched: number;
  followedCreatorsStored: number;
  followAgeKnownCount: number;
  followAgeUnknownCount: number;
  followingPagesFetched: number;
  dynamicPagesFetched: number;
  dynamicItemsScanned: number;
  videoUpdatesFetched: number;
  videoUpdatesStored: number;
  filteredNonVideoCount: number;
  filteredNonFollowedCount: number;
  filteredOutsideWindowCount: number;
  detailEnrichedCount: number;
  error?: string;
  overview: DynamicBillOverview;
}
