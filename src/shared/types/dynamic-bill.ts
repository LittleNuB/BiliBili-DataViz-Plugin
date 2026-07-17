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
  firstSeenAt?: number;
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

export type DynamicBillColumn = 'buried_follow' | 'favorite_related' | 'follow_rotation';
export type DynamicBillStatus = 'unopened' | 'opened' | 'consumed' | 'processed';
export type DynamicBillStatusFilter = 'active' | DynamicBillStatus;
export type DynamicBillInterestKind = 'category' | 'tag';
export type DynamicBillCreatorPauseSource = 'migration' | 'user';
export type DynamicBillFeedbackActionState = 'pending_undo' | 'undone' | 'finalized';
export type DynamicBillCreatorReviewPromptState = 'pending' | 'opened' | 'dismissed';
export type DynamicBillCreatorReviewPromptDecision = 'open_space' | 'dismiss';
export type DynamicBillFollowMemorySignal =
  | 'long_follow'
  | 'special_follow'
  | 'observed_follow'
  | 'weak_watch';
export type DynamicBillFeedbackScope = 'creator' | 'topic';
export type DynamicBillExplanationStatus = 'generated' | 'failed' | 'not_configured' | 'disabled';
export type DynamicBillExplanationRunStatus = 'idle' | DynamicBillExplanationStatus;

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

export interface DynamicBillFilterPreference {
  status: DynamicBillStatusFilter;
  updatedAt: number;
}

export interface DynamicBillFeedbackRecord {
  id?: number;
  scope: DynamicBillFeedbackScope;
  key: string;
  label: string;
  billKey: string;
  column: DynamicBillColumn | string;
  creatorMid: number;
  creatorName: string;
  topicKind?: DynamicBillInterestKind;
  topicLabel?: string;
  createdAt: number;
}

export interface DynamicBillCreatorPauseRecord {
  id?: number;
  creatorMid: number;
  creatorName: string;
  startedAt: number;
  expiresAt: number;
  source: DynamicBillCreatorPauseSource;
  billKey?: string;
  actionKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DynamicBillFeedbackActionRecord {
  id?: number;
  actionKey: string;
  billKey: string;
  creatorMid: number;
  creatorName: string;
  state: DynamicBillFeedbackActionState;
  undoToken: string;
  undoDeadlineAt: number;
  previousStatus: DynamicBillStatus;
  previousOpenedAt?: number;
  previousConsumedAt?: number;
  previousProcessedAt?: number;
  previousPause?: DynamicBillCreatorPauseRecord | null;
  appliedProcessedAt: number;
  pauseStartedAt: number;
  pauseExpiresAt: number;
  effectiveCountAfterFinalize?: number;
  createdAt: number;
  updatedAt: number;
  finalizedAt?: number;
  undoneAt?: number;
}

export interface DynamicBillCreatorFeedbackCountRecord {
  id?: number;
  creatorMid: number;
  creatorName: string;
  effectiveCount: number;
  promptCreatedAt?: number;
  promptActionKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DynamicBillCreatorReviewPromptRecord {
  id?: number;
  creatorMid: number;
  creatorName: string;
  state: DynamicBillCreatorReviewPromptState;
  effectiveCount: number;
  actionKey: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  decision?: DynamicBillCreatorReviewPromptDecision;
}

export interface DynamicBillPendingFeedbackActionView {
  actionKey: string;
  billKey: string;
  creatorMid: number;
  creatorName: string;
  undoToken: string;
  undoDeadlineAt: number;
  createdAt: number;
}

export interface DynamicBillCreatorPauseView {
  creatorMid: number;
  creatorName: string;
  startedAt: number;
  expiresAt: number;
  source: DynamicBillCreatorPauseSource;
  remainingDays: number;
}

export interface DynamicBillCreatorReviewPromptView {
  creatorMid: number;
  creatorName: string;
  effectiveCount: number;
  createdAt: number;
}

export interface DynamicBillFeedbackStateView {
  pendingActions: DynamicBillPendingFeedbackActionView[];
  reviewPrompts: DynamicBillCreatorReviewPromptView[];
}

export type DynamicBillLessReminderStatus =
  | 'pending_undo'
  | 'already_pending'
  | 'already_finalized';

export interface DynamicBillLessReminderResult {
  status: DynamicBillLessReminderStatus;
  action: DynamicBillPendingFeedbackActionView | null;
  item: DynamicBillItem;
  reviewPrompt?: DynamicBillCreatorReviewPromptView;
}

export type DynamicBillUndoFeedbackResultStatus =
  | 'undone'
  | 'expired'
  | 'invalid'
  | 'conflict';

export interface DynamicBillUndoFeedbackResult {
  status: DynamicBillUndoFeedbackResultStatus;
  item?: DynamicBillItem;
}

export type DynamicBillReviewPromptResolveAction = 'open_space' | 'dismiss';

export interface DynamicBillReviewPromptResolveResult {
  status: 'resolved' | 'not_found';
  prompt?: DynamicBillCreatorReviewPromptView;
  url?: string;
}

export interface DynamicBillRotationRecord {
  id?: number;
  creatorMid: number;
  creatorName: string;
  lastShownAt: number;
  lastBillKey: string;
  lastColumn: DynamicBillColumn;
  updatedAt: number;
}

export interface DynamicBillMigrationRecord {
  id?: number;
  version: string;
  completedAt: number;
}

export interface DynamicBillFeedbackThresholds {
  dampenCount: number;
  creatorBlockCount: number;
  topicBlockCount: number;
  creatorReviewPromptCount: number;
  scoreMultiplier: number;
}

export interface DynamicBillFeedbackSummary {
  scope: DynamicBillFeedbackScope;
  key: string;
  label: string;
  count: number;
  isDampened: boolean;
  isBlocked: boolean;
  shouldShowCreatorReviewPrompt: boolean;
  thresholds: DynamicBillFeedbackThresholds;
}

export interface DynamicBillFeedbackResult {
  feedback: DynamicBillFeedbackRecord;
  summary: DynamicBillFeedbackSummary;
  item: DynamicBillItem;
}

export interface DynamicBillExplanation {
  id?: number;
  billKey: string;
  status: DynamicBillExplanationStatus;
  summary: string;
  reason: string;
  viewingAngle: string;
  keywords: string[];
  confidence: number;
  model: string;
  generatedAt: number;
  contentHash: string;
  attemptGeneration?: number;
  error?: string;
}

export interface DynamicBillExplanationResult {
  status: DynamicBillExplanationRunStatus;
  processed: number;
  generated: number;
  failed: number;
  skipped: number;
  fallback: number;
  discarded: number;
  pending: number;
  items: DynamicBillItem[];
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
  special?: boolean;
  memorySignals?: DynamicBillFollowMemorySignal[];
}

export interface DynamicBillThresholdEvidence {
  longWindowDays: number;
  recentWindowDays: number;
  updateWindowDays: number;
  positiveCompletionRate: number;
  minPositiveWatchSeconds: number;
  minBuriedFollowAgeDays: number;
  minObservedFollowDays: number;
  minBuriedWeakWatchCount: number;
  maxBuriedRecentWatchCount: number;
  maxBuriedRecentPositiveWatchCount: number;
  maxItemsPerColumn: number;
  maxItemsTotal: number;
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
  explanationAttemptGeneration?: number;
  explanationAttemptContentHash?: string;
  explanationAttemptModel?: string;
  generatedAt: number;
  explanation?: DynamicBillExplanation;
}

export interface DynamicBillGenerateResult {
  generatedAt: number;
  itemCount: number;
  candidatesScanned: number;
  eligibleCreatorCount: number;
  excludedNoLongSignalCount: number;
  excludedRecentActiveCount: number;
  excludedRecentSameVideoCount: number;
  excludedByFeedbackCount: number;
  columnItemCounts: Record<DynamicBillColumn, number>;
  columnEligibleCounts: Record<DynamicBillColumn, number>;
  items: DynamicBillItem[];
  thresholds: DynamicBillThresholdEvidence;
  overview: DynamicBillOverview;
}
