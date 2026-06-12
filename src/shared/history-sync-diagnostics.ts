import type { HistorySyncProgress } from './types/history-sync';

export type HistoryCoverageStatus = 'not_started' | 'partial' | 'complete';

export interface HistoryCoverageAssessment {
  status: HistoryCoverageStatus;
  trustworthy: boolean;
  note: string;
}

export function assessHistoryCoverage(
  progress: HistorySyncProgress | null,
  backfillComplete: boolean,
  totalRecords: number,
): HistoryCoverageAssessment {
  if (!progress) {
    if (backfillComplete && totalRecords > 0) {
      return {
        status: 'complete',
        trustworthy: true,
        note: 'Full history coverage was previously confirmed.',
      };
    }

    return {
      status: totalRecords > 0 ? 'partial' : 'not_started',
      trustworthy: false,
      note: totalRecords > 0
        ? 'Only local partial history is available; full backfill has not been confirmed.'
        : 'No history sync diagnostic is available yet.',
    };
  }

  if (progress.reachedEnd && isTerminalCompleteReason(progress.stoppedReason)) {
    return {
      status: 'complete',
      trustworthy: true,
      note: 'History sync reached the upstream end cursor.',
    };
  }

  const suffix = historyStopReasonExplanation(progress.stoppedReason);
  return {
    status: totalRecords > 0 ? 'partial' : 'not_started',
    trustworthy: false,
    note: suffix,
  };
}

export function isTerminalCompleteReason(reason: string): boolean {
  return reason === 'api_end' || reason === 'api_end_empty_page';
}

export function historyStopReasonExplanation(reason: string): string {
  switch (reason) {
    case 'page_limit':
      return 'Stopped at the configured page limit before the upstream end was confirmed.';
    case 'empty_page_cursor_anomaly':
      return 'The API returned an empty page before the end cursor; coverage is incomplete.';
    case 'cancelled':
      return 'The sync was cancelled before full coverage was confirmed.';
    case 'service_worker_restarted':
      return 'The service worker restarted during sync; coverage may be incomplete.';
    case 'stale_lock_cleared':
      return 'A stale sync lock was cleared; the previous run did not finish cleanly.';
    case 'sync_started':
      return 'A sync was started but no terminal diagnostic has been written yet.';
    case 'already_complete':
      return 'Full history had already been marked complete before this run.';
    case 'no_new_records':
      return 'Incremental sync found no new rows; this does not confirm older coverage.';
    case 'boundary_records_seen':
      return 'Incremental sync reached local boundary rows; this does not confirm older coverage.';
    case 'api_end':
    case 'api_end_empty_page':
      return 'History sync reached the upstream end cursor.';
    default:
      return `History coverage is incomplete or unknown (reason: ${reason}).`;
  }
}
