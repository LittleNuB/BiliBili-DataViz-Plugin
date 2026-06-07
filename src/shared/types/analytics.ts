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
}

export interface CategoryDistribution {
  name: string;
  watchTime: number;
  percentage: number;
}

export type InterestDriftGranularity = 'daily' | 'weekly' | 'monthly';

export interface HistoryCoverage {
  earliestDate: string | null;
  latestDate: string | null;
  activeDays: number;
  totalRecords: number;
  coveredDays: number;
}

export interface InterestDrift {
  month: string;
  period: string;
  label: string;
  granularity: InterestDriftGranularity;
  startDate: string;
  endDate: string;
  categories: Record<string, number>;
  recordCount: number;
  activeDays: number;
  totalWatchTime: number;
}

export interface DurationBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface PreferenceAnalytics {
  categories: CategoryDistribution[];
  drift: InterestDrift[];
  driftByGranularity: Record<InterestDriftGranularity, InterestDrift[]>;
  defaultDriftGranularity: InterestDriftGranularity;
  coverage: HistoryCoverage;
  durationBuckets: DurationBucket[];
  topTags: { name: string; count: number }[];
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

export interface WeeklyTip {
  category: 'completion' | 'diversity' | 'creator' | 'habit';
  title: string;
  description: string;
}

export interface BlindBoxItem {
  bvid?: string;
  mid?: number;
  name: string;
  reason: string;
  type: 'video' | 'creator' | 'category';
}
