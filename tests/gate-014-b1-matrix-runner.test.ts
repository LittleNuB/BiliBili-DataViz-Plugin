import assert from "node:assert/strict";
import test from "node:test";

import {
  createB1RestorePreflightValidationFromLifecycle,
  mapB1LifecycleToRawOperations,
} from "../scripts/gate-014-b1-matrix-runner.mjs";
import {
  B1_OPERATION_KINDS,
  createB1OperationReceipt,
} from "../scripts/gate-014-b1-receipt.mjs";

const FIXTURE_SHA = "a".repeat(64);
const ENVIRONMENT_SHA = "b".repeat(64);

function lifecycleResult() {
  return {
    fixtureId: "managed-full-text-100mib",
    candidate: { recordCap: 1024, byteCapBytes: 4 * 1024 * 1024 },
    sourceCanonicalBytes: 1_000,
    operations: B1_OPERATION_KINDS.map((operation) => ({
      operation,
      expectedDirection: ["admission", "restore_staging"].includes(operation)
        ? "increase"
        : "stable",
      totalDurationMs: 1_000,
      committedBatchCount: ["admission", "restore_staging"].includes(operation)
        ? 1
        : 0,
      committedBatchDurationsMs: ["admission", "restore_staging"].includes(
        operation,
      )
        ? [10]
        : [],
      readBatchDurationsMs: [],
      batchDurationsMs: [10],
      progressEventOffsetsMs: [],
      restart:
        operation === "restart"
          ? {
              attempted: true,
              stateVisibleMs: 500,
              remainingWork: true,
              nextProgressMs: 250,
              readbackVerified: true,
            }
          : { attempted: false },
      cancellation:
        operation === "cancellation"
          ? { attempted: true, acknowledgementMs: 10, writesAfterTwoSeconds: 0 }
          : { attempted: false },
      mainThread: { metricAvailable: true, maximumTaskMs: 50 },
      memory: { metricAvailable: true, peakHeapGrowthBytes: 1_000 },
      storageBefore: { usageBytes: 1_000, quotaBytes: 10_000 },
      storageAfter: {
        usageBytes: ["admission", "restore_staging"].includes(operation)
          ? 2_000
          : 1_000,
        quotaBytes: 10_000,
      },
      readbackVerified: true,
      detail: { mustNotLeak: true },
    })),
    assertions: {
      atomicVersionCommitOrRollback: true,
      ledgerMatchesVersionBytes: true,
      exactCapacityBoundaryEnforced: true,
      stagedRowsInvisible: true,
      committedRowsVisibleTogether: true,
      orphanRowsHiddenAndCleanable: true,
      cleanupReadbackVerified: true,
      restorePreflightBoundaryVerified: true,
      warmStartCompleteGenerationVerified: true,
    },
    finalCleanupStorage: { usageBytes: 1_000, quotaBytes: 10_000 },
  };
}

test("GATE-014-B1 lifecycle mapping emits exactly one strict input per required operation", () => {
  const rawOperations = mapB1LifecycleToRawOperations(lifecycleResult(), {
    fixtureReceiptSha256: FIXTURE_SHA,
    environmentReceiptSha256: ENVIRONMENT_SHA,
    runMode: "cold",
    runOrdinal: 1,
  });

  assert.equal(rawOperations.length, B1_OPERATION_KINDS.length);
  assert.deepEqual(
    rawOperations.map((operation) => operation.operation).sort(),
    [...B1_OPERATION_KINDS].sort(),
  );
  assert.equal(Object.hasOwn(rawOperations[0], "detail"), false);
  assert.equal(rawOperations[0].indexedDb.sourceCanonicalBytes, 1_000);
  assert.equal(
    rawOperations.find((operation) => operation.operation === "ordered_read")
      .committedBatchCount,
    0,
  );
  assert.equal(createB1OperationReceipt(rawOperations[0]).status, "pass");
});

test("GATE-014-B1 lifecycle mapping fails closed when browser storage metrics are absent", () => {
  const lifecycle = lifecycleResult();
  lifecycle.operations[0].storageBefore = null;
  const [rawOperation] = mapB1LifecycleToRawOperations(lifecycle, {
    fixtureReceiptSha256: FIXTURE_SHA,
    environmentReceiptSha256: ENVIRONMENT_SHA,
    runMode: "warm",
    runOrdinal: 1,
  });

  assert.deepEqual(rawOperation.indexedDb, {
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
  });
  assert.equal(
    createB1OperationReceipt(rawOperation).status,
    "insufficient_evidence",
  );
});

test("GATE-014-B1 restore preflight validation is derived from a passing browser lifecycle", () => {
  const requiredFreeQuotaBytes = 1_000;
  const lifecycle = {
    status: "pass",
    readbackVerified: true,
    assertions: {
      committedRowsVisibleTogether: true,
      cleanupReadbackVerified: true,
    },
    operations: [
      {
        operation: "restore_staging",
        readbackVerified: true,
        detail: {
          receivedRecordCount: 100,
          visibleRead: { versionCount: 1 },
          restorePreflightEvidence: {
            measuredAvailableFreeQuotaBytes: 10_000,
            exactBoundaryAvailableFreeQuotaBytes: requiredFreeQuotaBytes,
            requiredFreeQuotaBytes,
            exactBoundaryAllowed: true,
            artifactFetchAttempted: true,
          },
        },
      },
      {
        operation: "quota_failure",
        detail: {
          availableBytes: requiredFreeQuotaBytes - 1,
          requestedBytes: requiredFreeQuotaBytes,
          refusedBeforeWrite: true,
          artifactFetchAttempted: false,
          writesObserved: 0,
        },
      },
    ],
  };
  const options = {
    fixtureId: "managed-full-text-500mib",
    fixtureReceiptSha256: FIXTURE_SHA,
    environmentReceiptSha256: ENVIRONMENT_SHA,
    candidate: { recordCap: 1024, byteCapBytes: 4 * 1024 * 1024 },
    startedAtEpochMs: 1,
    completedAtEpochMs: 2,
    requiredFreeQuotaBytes,
  };

  const receipt = createB1RestorePreflightValidationFromLifecycle(
    lifecycle,
    options,
  );
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.insufficientProbe.allowed, false);
  assert.equal(receipt.exactProbe.writesObserved, 101);

  assert.throws(
    () =>
      createB1RestorePreflightValidationFromLifecycle(
        { ...lifecycle, status: "fail" },
        options,
      ),
    /lifecycle failed/,
  );
  lifecycle.operations[1].detail.refusedBeforeWrite = false;
  assert.equal(
    createB1RestorePreflightValidationFromLifecycle(lifecycle, options).status,
    "fail",
  );
});
