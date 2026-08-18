export const B1_RESTART_BROWSER_LIFECYCLE_DIAGNOSTIC_MAX_MS =
  45 * 60 * 1_000;

export function createRestartMeasurementBoundary(
  browserLifecycleStartedEpochMs,
  operationStartedEpochMs,
) {
  if (
    !Number.isSafeInteger(browserLifecycleStartedEpochMs) ||
    browserLifecycleStartedEpochMs < 1 ||
    !Number.isSafeInteger(operationStartedEpochMs) ||
    operationStartedEpochMs < browserLifecycleStartedEpochMs
  ) {
    throw new Error("restart_measurement_epoch_invalid");
  }
  const browserLifecycleReadyMs =
    operationStartedEpochMs - browserLifecycleStartedEpochMs;
  if (
    browserLifecycleReadyMs >
    B1_RESTART_BROWSER_LIFECYCLE_DIAGNOSTIC_MAX_MS
  ) {
    throw new Error("restart_browser_lifecycle_diagnostic_out_of_bounds");
  }
  return Object.freeze({
    restartOperationStartedEpochMs: operationStartedEpochMs,
    restartBrowserLifecycleReadyMs: browserLifecycleReadyMs,
  });
}

export function measureRestartOperationOffset(
  operationStartedEpochMs,
  observedEpochMs,
) {
  if (
    !Number.isSafeInteger(operationStartedEpochMs) ||
    operationStartedEpochMs < 1 ||
    !Number.isSafeInteger(observedEpochMs)
  ) {
    throw new Error("restart_operation_epoch_invalid");
  }
  return Math.max(0, observedEpochMs - operationStartedEpochMs);
}
