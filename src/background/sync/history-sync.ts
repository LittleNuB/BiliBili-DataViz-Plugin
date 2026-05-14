import { runInitialBackfill, type BackfillResult } from './initial-backfill';

export async function syncLatestHistory(): Promise<BackfillResult> {
  return runInitialBackfill('incremental', true);
}
