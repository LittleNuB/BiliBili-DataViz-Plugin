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

export type DynamicBillColumn = 'afk_update' | 'variety';
export type DynamicBillStatus = 'unopened' | 'opened' | 'consumed' | 'processed';
export type DynamicBillInterestKind = 'category' | 'tag';

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

export interface DynamicBillWindowEvidence {
  windowDays: number;
  startedAt: number;
  endedAt: number;
  watchedCount: number;
  positiveWatchCount: number;
  totalWatchTimeSeconds: number;
  avgCompletion: number;
  lastWatchedAt: number;
}

export interface DynamicBillNewVideoEvidence {
  updateKey: string;
  dynamicId: string;
  bvid: string;
  avid: number;
  title: string;
  cover: string;
  duration: number;
  pubtime: number;
  dynamicTime: number;
  tagName: string;
  tags: string[];
}

export interface DynamicBillFollowEvidence {
  followedAt?: number;
  followAgeKnown: boolean;
  followAgeDays?: number;
}

export interface DynamicBillThresholdEvidence {
  longWindowDays: number;
  recentWindowDays: number;
  updateWindowDays: number;
  recentSameVideoWindowDays: number;
  minCreatorPositiveViews: number;
  minInterestPositiveViews: number;
  minInterestLongPositiveShare: number;
  maxInterestRecentPositiveRatio: number;
  positiveCompletionRate: number;
  minPositiveWatchSeconds: number;
  recentCooldownRatio: number;
}

export interface DynamicBillInterestEvidence {
  key: string;
  kind: DynamicBillInterestKind;
  label: string;
  longPositiveShare: number;
  recentPositiveShare: number;
  positiveDropRatio: number;
  matchedNewVideoLabels: string[];
}

export interface DynamicBillEvidence {
  kind: DynamicBillColumn;
  longWindow: DynamicBillWindowEvidence;
  recentWindow: DynamicBillWindowEvidence;
  newVideo: DynamicBillNewVideoEvidence;
  follow: DynamicBillFollowEvidence;
  interest?: DynamicBillInterestEvidence;
  cooldownRatio: number;
  daysSinceLastWatch: number | null;
  facts: string[];
  thresholds: DynamicBillThresholdEvidence;
}

export interface DynamicBillItem {
  id?: number;
  billKey: string;
  column: DynamicBillColumn;
  status: DynamicBillStatus;
  updateKey: string;
  creatorMid: number;
  creatorName: string;
  creatorFace: string;
  historyBvids: string[];
  evidence: DynamicBillEvidence;
  localRank: number;
  score: number;
  openedAt?: number;
  consumedAt?: number;
  processedAt?: number;
  generatedAt: number;
}

export interface DynamicBillGenerateResult {
  generatedAt: number;
  itemCount: number;
  candidatesScanned: number;
  eligibleCreatorCount: number;
  excludedNoLongSignalCount: number;
  excludedRecentActiveCount: number;
  excludedRecentSameVideoCount: number;
  columnItemCounts: Record<DynamicBillColumn, number>;
  columnEligibleCounts: Record<DynamicBillColumn, number>;
  items: DynamicBillItem[];
  thresholds: DynamicBillThresholdEvidence;
  overview: DynamicBillOverview;
}
