import { signal } from '@preact/signals';
import type {
  DashboardOverview,
  CategoryDistribution, InterestDrift, DurationBucket,
  CreatorFollowDataCoverage, CreatorFollowStatusGroup, CreatorRanking, NewCreator,
  BehaviorMetrics,
  WeeklyTip, BlindBoxItem,
} from '../src/shared/types/analytics';

// Module 1: Overview
export const overviewData = signal<DashboardOverview | null>(null);
export const overviewLoading = signal(true);
export const overviewError = signal<string | null>(null);

// Module 2: Preference
export const prefData = signal<{
  categories: CategoryDistribution[];
  drift: InterestDrift[];
  durationBuckets: DurationBucket[];
  topTags: { name: string; count: number }[];
} | null>(null);
export const prefLoading = signal(true);
export const prefError = signal<string | null>(null);

// Module 3: Creator
export const creatorData = signal<{
  topCreators: CreatorRanking[];
  deepBondCreators: CreatorRanking[];
  newCreators: NewCreator[];
  followGroups: CreatorFollowStatusGroup[];
  followDataCoverage: CreatorFollowDataCoverage;
  overDependency: { creator: CreatorRanking; percentage: number } | null;
} | null>(null);
export const creatorLoading = signal(true);
export const creatorError = signal<string | null>(null);

// Module 4: Behavior
export const behaviorData = signal<BehaviorMetrics | null>(null);
export const behaviorLoading = signal(true);
export const behaviorError = signal<string | null>(null);

// Module 5: Experiments
export const expData = signal<{
  tips: WeeklyTip[];
  blindBox: BlindBoxItem[];
} | null>(null);
export const expLoading = signal(true);
export const expError = signal<string | null>(null);

// Tab navigation
export const activeTab = signal(0);
