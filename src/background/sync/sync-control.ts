let activeHistorySyncController: AbortController | null = null;
let activeHistoryDataOperation: 'sync' | 'clear' | null = null;
let activeHistoryPlayerEventWrites = 0;
const historyPlayerEventIdleWaiters = new Set<() => void>();

export function runHistorySyncDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  return runExclusiveHistoryDataOperation('sync', operation);
}

export function runHistoryClearDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  return runExclusiveHistoryDataOperation('clear', operation);
}

export function runHistoryPlayerEventDataOperation(
  operation: () => Promise<void>,
): Promise<boolean> {
  if (activeHistoryDataOperation === 'clear') return Promise.resolve(false);

  activeHistoryPlayerEventWrites++;
  return Promise.resolve()
    .then(operation)
    .then(() => true)
    .finally(() => {
      activeHistoryPlayerEventWrites--;
      if (activeHistoryPlayerEventWrites === 0) {
        for (const resolve of historyPlayerEventIdleWaiters) resolve();
        historyPlayerEventIdleWaiters.clear();
      }
    });
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
    .then(async () => {
      if (kind === 'clear') await waitForHistoryPlayerEventWrites();
      return operation();
    })
    .finally(() => {
      if (activeHistoryDataOperation === kind) {
        activeHistoryDataOperation = null;
      }
    });
}

function waitForHistoryPlayerEventWrites(): Promise<void> {
  if (activeHistoryPlayerEventWrites === 0) return Promise.resolve();
  return new Promise(resolve => historyPlayerEventIdleWaiters.add(resolve));
}

