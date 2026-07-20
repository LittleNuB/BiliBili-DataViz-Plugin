let activeHistorySyncController: AbortController | null = null;
let activeHistoryDataOperation: 'sync' | 'clear' | null = null;

export function runHistorySyncDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  return runExclusiveHistoryDataOperation('sync', operation);
}

export function runHistoryClearDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  return runExclusiveHistoryDataOperation('clear', operation);
}

export function hasActiveHistoryDataOperation(): boolean {
  return activeHistoryDataOperation !== null;
}

export function beginHistorySyncAbortScope(): AbortSignal {
  activeHistorySyncController = new AbortController();
  return activeHistorySyncController.signal;
}

export function endHistorySyncAbortScope(signal: AbortSignal): void {
  if (activeHistorySyncController?.signal === signal) {
    activeHistorySyncController = null;
  }
}

export function abortCurrentHistorySync(): boolean {
  if (!activeHistorySyncController) return false;
  activeHistorySyncController.abort();
  return true;
}

export function hasActiveHistorySyncAbortScope(): boolean {
  return activeHistorySyncController !== null;
}

function runExclusiveHistoryDataOperation<T>(
  kind: 'sync' | 'clear',
  operation: () => Promise<T>,
): Promise<T> {
  if (activeHistoryDataOperation !== null) {
    return Promise.reject(new Error('HISTORY_SYNC_IN_PROGRESS'));
  }
  activeHistoryDataOperation = kind;
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      if (activeHistoryDataOperation === kind) {
        activeHistoryDataOperation = null;
      }
    });
}

