let activeHistorySyncController: AbortController | null = null;

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

