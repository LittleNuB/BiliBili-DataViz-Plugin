import type { HistorySyncProgress } from './history-sync';

export interface QuickStats {
  todayWatchTime: number;
  dailyGoal: number;
  streakDays: number;
  avgCompletion: number;
  efficiencyScore: number;
  weeklyWatchTime: number;
  weeklyLocalPcWatchTime: number;
  weeklyLocalPcDays: number;
}

export interface DashboardOverview {
  weeklyWatchTime: number;
  monthlyWatchTime: number;
  weeklyChange: number;
  monthlyChange: number;
  avgCompletion: number;
  streakDays: number;
  streakStartDate: string | null;
  streakEndDate: string | null;
  longestStreak: number;
  longestStreakStartDate: string | null;
  longestStreakEndDate: string | null;
  hourlyHeatmap: number[][];
  efficiencyScore: number;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  weeklyRecordCount: number;
  monthlyRecordCount: number;
  weeklyLocalPcWatchTime: number;
  weeklyLocalPcDays: number;
  oldestRecordDate: string | null;
  newestRecordDate: string | null;
  historyCoverageStatus: 'not_started' | 'partial' | 'complete';
  historyCoverageNote: string;
  streakTrustworthy: boolean;
  streakCoverageNote: string;
  historySyncDiagnostics: HistorySyncProgress | null;
}

export interface CategoryDistribution {
  name: string;
  watchTime: number;
  percentage: number;
}

export type InterestDriftGranularity = 'daily' | 'weekly' | 'monthly';

export interface PreferenceWindowOption {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  granularity: InterestDriftGranularity;
  recordCount: number;
  activeDays: number;
  totalWatchTime: number;
  partialCoverage: boolean;
}

export type PreferenceWindowState = 'empty' | 'insufficient_sample' | 'ready';

export type PreferenceWindowStateReason =
  | 'no_records'
  | 'no_watch_time'
  | 'too_few_records'
  | 'too_little_watch_time';

export interface HistoryCoverage {
  earliestDate: string | null;
  latestDate: string | null;
  activeDays: number;
  totalRecords: number;
  coveredDays: number;
}

export interface PreferenceWindowSummary {
  window: PreferenceWindowOption;
  state: PreferenceWindowState;
  stateReason: PreferenceWindowStateReason | null;
  categories: CategoryDistribution[];
  durationBuckets: DurationBucket[];
  topTags: { name: string; count: number }[];
}

export interface DurationBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface PreferenceAnalytics {
  windows: Record<InterestDriftGranularity, PreferenceWindowOption[]>;
  selectedWindow: PreferenceWindowSummary | null;
  defaultGranularity: InterestDriftGranularity;
  coverage: HistoryCoverage;
}

export interface CreatorRanking {
  mid: number;
  name: string;
  face: string;
  videoCount: number;
  totalWatchTime: number;
  avgCompletion: number;
  isDeepBond: boolean;
  followStatus?: CreatorFollowStatus;
}

export interface NewCreator {
  mid: number;
  name: string;
  face: string;
  firstWatchDate: string;
  subsequentViews: number;
  retained: boolean;
  followStatus?: CreatorFollowStatus;
}

export type CreatorFollowStatus = 'followed' | 'not_followed' | 'unknown';

export type CreatorFollowDataCoverageReason =
  | 'snapshot_available'
  | 'not_synced'
  | 'syncing'
  | 'not_logged_in'
  | 'sync_failed';

export interface CreatorFollowDataCoverage {
  hasSnapshot: boolean;
  reason: CreatorFollowDataCoverageReason;
  activeFollowedCreatorCount: number;
  snapshotSyncedAt: number | null;
  lastError?: string;
}

export interface CreatorFollowStatusGroup {
  status: CreatorFollowStatus;
  creators: CreatorRanking[];
  count: number;
}

export interface SessionPattern {
  avgVideosPerSession: number;
  avgSessionDuration: number;
  weekdayAvg: number;
  weekendAvg: number;
  peakHours: number[];
}

export interface CompletionBucket {
  label: string;
  range: [number, number];
  count: number;
}

export interface BehaviorMetrics {
  completionDistribution: CompletionBucket[];
  totalSeeks: number;
  avgSeeksPerVideo: number;
  commonSeekRange: [number, number];
  sessionPattern: SessionPattern;
  avgDecisionTime: number;
  totalPauses: number;
}

export type ExperimentBlindBoxId =
  | 'random_explore'
  | 'cross_region'
  | 'hidden_favorite'
  | 'creator_archive';

export type ExperimentBlindBoxState = 'ready' | 'empty';

export interface ExperimentVideoCandidate {
  bvid: string;
  avid?: number;
  cid?: number;
  title: string;
  authorName: string;
  authorMid?: number;
  cover: string;
  duration?: number;
  pubtime?: number;
  tagName?: string;
  url: string;
  publishedAt?: number;
  sourceKind?: 'local_history' | 'local_favorite' | 'bilibili_related' | 'bili_region_dynamic' | 'bili_space_archive';
  sourceLabel?: string;
  regionRid?: number;
  regionName?: string;
  cooldownLabel?: string;
}

export type ExperimentRealCandidateSourceKind = 'bilibili_related' | 'bili_region_dynamic' | 'bili_space_archive';

export type ExperimentCandidateFailureKind =
  | 'no_seed'
  | 'no_real_candidates'
  | 'upstream_failed'
  | 'no_openable_candidates';

export interface ExperimentRealVideoCandidate extends ExperimentVideoCandidate {
  sourceKind: ExperimentRealCandidateSourceKind;
  sourceLabel: string;
  seedBvid?: string;
  seedTitle?: string;
}

export interface ExperimentRealCandidateFailure {
  seedBvid: string;
  seedTitle: string;
  reason: 'request_failed' | 'empty_response' | 'no_valid_candidates';
}

export interface ExperimentRealCandidatePool {
  sourceKind: ExperimentRealCandidateSourceKind;
  sourceLabel: string;
  seedCount: number;
  candidates: ExperimentRealVideoCandidate[];
  failures: ExperimentRealCandidateFailure[];
  failureKind?: ExperimentCandidateFailureKind;
}

export interface ExperimentBlindBox {
  id: ExperimentBlindBoxId;
  title: string;
  teaser: string;
  candidateSource: string;
  realCandidateLabel: string;
  usesRealBilibiliCandidates: boolean;
  source: string;
  reason: string;
  evidence: string[];
  state: ExperimentBlindBoxState;
  statusLabel?: string;
  video?: ExperimentVideoCandidate;
  emptyTitle?: string;
  emptyDescription?: string;
}

export interface ExperimentData {
  blindBoxes: ExperimentBlindBox[];
  generatedAt: number;
}
