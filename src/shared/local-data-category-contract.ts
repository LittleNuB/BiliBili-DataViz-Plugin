export type LocalDataCategoryId =
  | 'history'
  | 'favorites'
  | 'currentVideoSubtitles'
  | 'dynamicBill'
  | 'localSettings';

export interface LocalDataClearedCounts {
  historyRecords?: number;
  playerEvents?: number;
  dailyAggregates?: number;
  favoriteFolders?: number;
  favoriteItems?: number;
  smartFavoriteIndexes?: number;
  followedCreators?: number;
  followedVideoUpdates?: number;
  dynamicBillItems?: number;
  dynamicBillExplanations?: number;
  dynamicBillFeedback?: number;
  currentVideoSubtitleSources?: number;
  currentVideoSubtitleSegments?: number;
  localSettings?: boolean;
}

export interface LocalDataCategoryUsage {
  count: number;
  usageBytes: number;
}

export interface LocalDataCategoryClearResult {
  cleared: LocalDataClearedCounts;
}

export interface LocalDataCategoryReadback extends LocalDataCategoryUsage {
  empty: boolean;
}

export interface LocalDataCategoryRegistration {
  id: LocalDataCategoryId;
  label: string;
  includeInClearAll: boolean;
  collectUsage: () => Promise<LocalDataCategoryUsage>;
  clear: () => Promise<LocalDataCategoryClearResult>;
  readAfterClear: () => Promise<LocalDataCategoryReadback>;
}

export type LocalDataCategoryFailureStage = 'collect_usage' | 'clear' | 'readback';

export interface LocalDataCategoryLifecycleSuccess {
  status: 'success';
  id: LocalDataCategoryId;
  label: string;
  before: LocalDataCategoryUsage;
  clearResult: LocalDataCategoryClearResult;
  after: LocalDataCategoryReadback;
}

export interface LocalDataCategoryLifecycleFailure {
  status: 'failure';
  id: LocalDataCategoryId;
  label: string;
  failedStage: LocalDataCategoryFailureStage;
  message: string;
  before: LocalDataCategoryUsage | null;
  clearResult: LocalDataCategoryClearResult | null;
  after: null;
}

export type LocalDataCategoryLifecycleResult =
  | LocalDataCategoryLifecycleSuccess
  | LocalDataCategoryLifecycleFailure;

export async function runLocalDataCategoryLifecycle(
  registration: LocalDataCategoryRegistration,
): Promise<LocalDataCategoryLifecycleResult> {
  let before: LocalDataCategoryUsage;
  try {
    before = await registration.collectUsage();
  } catch {
    return lifecycleFailure(registration, 'collect_usage', null, null);
  }

  let clearResult: LocalDataCategoryClearResult;
  try {
    clearResult = await registration.clear();
  } catch {
    return lifecycleFailure(registration, 'clear', before, null);
  }

  try {
    const after = await registration.readAfterClear();
    return {
      status: 'success',
      id: registration.id,
      label: registration.label,
      before,
      clearResult,
      after,
    };
  } catch {
    return lifecycleFailure(registration, 'readback', before, clearResult);
  }
}

export async function runLocalDataCategoryLifecycles(
  registrations: LocalDataCategoryRegistration[],
): Promise<LocalDataCategoryLifecycleResult[]> {
  const results: LocalDataCategoryLifecycleResult[] = [];
  for (const registration of registrations) {
    results.push(await runLocalDataCategoryLifecycle(registration));
  }
  return results;
}

export function validateLocalDataCategoryRegistration(
  registration: LocalDataCategoryRegistration,
): string[] {
  const issues: string[] = [];
  if (!registration.id) issues.push('missing_id');
  if (!registration.label.trim()) issues.push('missing_label');
  if (typeof registration.collectUsage !== 'function') issues.push('missing_collect_usage');
  if (typeof registration.clear !== 'function') issues.push('missing_clear');
  if (typeof registration.readAfterClear !== 'function') issues.push('missing_readback');
  if (typeof registration.includeInClearAll !== 'boolean') issues.push('missing_clear_all_hook');
  return issues;
}

function lifecycleFailure(
  registration: LocalDataCategoryRegistration,
  failedStage: LocalDataCategoryFailureStage,
  before: LocalDataCategoryUsage | null,
  clearResult: LocalDataCategoryClearResult | null,
): LocalDataCategoryLifecycleFailure {
  return {
    status: 'failure',
    id: registration.id,
    label: registration.label,
    failedStage,
    message: lifecycleFailureMessage(registration.label, failedStage),
    before,
    clearResult,
    after: null,
  };
}

function lifecycleFailureMessage(label: string, stage: LocalDataCategoryFailureStage): string {
  if (stage === 'collect_usage') return `${label}的数据统计失败，暂时无法开始清理。`;
  if (stage === 'readback') return `${label}已执行清理，但结果回读失败，请刷新后核对。`;
  return `${label}清理失败，已完成的其他类别不会受影响。`;
}
