export type LocalDataCategoryId =
  | 'history'
  | 'favorites'
  | 'currentVideoSubtitles'
  | 'dynamicBill'
  | 'localSettings';

export interface LocalDataCategoryUsage {
  count: number;
  usageBytes: number;
}

export interface LocalDataCategoryReadback {
  count: number;
  usageBytes: number;
  empty: boolean;
}

export interface LocalDataCategoryRegistration {
  id: LocalDataCategoryId;
  label: string;
  includeInClearAll: boolean;
  collectUsage: () => Promise<LocalDataCategoryUsage>;
  clear: () => Promise<unknown>;
  readAfterClear: () => Promise<LocalDataCategoryReadback>;
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
