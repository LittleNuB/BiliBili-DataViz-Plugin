import assert from "node:assert/strict";
import test from "node:test";

import {
  B1_BYTE_CAPS,
  B1_OPERATION_KINDS,
  B1_RECORD_CAPS,
  B1_REQUIRED_FIXTURE_IDS,
  B1_MAX_HEAP_GROWTH_BYTES,
  createB1EnvironmentReceipt,
  createB1OperationReceipt,
  evaluateB1Report,
  hashB1EnvironmentReceipt,
  serializeB1EnvironmentReceipt,
  serializeB1Report,
} from "../scripts/gate-014-b1-receipt.mjs";

const SHA_256 = "0123456789abcdef".repeat(4);
const ENVIRONMENT_INPUT = {
  startedAtEpochMs: 1_000,
  completedAtEpochMs: 2_000,
  repositoryCommitSha: "a".repeat(40),
  benchmarkSourceSha256: "b".repeat(64),
  packageLockSha256: "c".repeat(64),
  productionDistSha256: "d".repeat(64),
  fixtureGeneratorVersion: "gate-014-fixture-generator-v5",
  operatingSystem: { platform: "win32", release: "10.0.26200", architecture: "x64" },
  hardware: {
    cpuModel: "Synthetic CPU",
    logicalCoreCount: 24,
    totalMemoryBytes: 24_000_000_000,
    freeDiskBytesAtStart: 200_000_000_000,
    freeDiskBytesAtEnd: 199_000_000_000,
  },
  runtime: { nodeVersion: "v24.14.1" },
  browser: {
    flavor: "chrome_for_testing_stable",
    version: "151.0.7922.77",
    channel: "stable",
    headlessMode: "new",
    sandboxEnabled: true,
  },
  execution: {
    commandId: "gate014_b1_full_matrix",
    productionExtensionMode: "unpacked",
    networkPolicy: "loopback_only_external_dns_blocked",
    coldProfilePolicy: "fresh_temporary_profile_per_run",
    warmProfilePolicy: "temporary_profile_reused_for_five_runs_per_candidate_fixture",
    coldRunsPerCandidateFixture: 3,
    warmRunsPerCandidateFixture: 5,
    externalNetworkUsed: false,
    realUserProfileRead: false,
    bilibiliLoginUsed: false,
  },
  a2CalibrationStatus: "insufficient_evidence",
  storesSensitiveText: false,
};
const ENVIRONMENT_SHA_256 = hashB1EnvironmentReceipt(createB1EnvironmentReceipt(ENVIRONMENT_INPUT));

test("GATE-014-B1 environment receipt is deterministic and rejects local paths", () => {
  const receipt = createB1EnvironmentReceipt(ENVIRONMENT_INPUT);

  assert.equal(receipt.contract, "gate-014-b1-environment-v1");
  assert.equal(hashB1EnvironmentReceipt(receipt), ENVIRONMENT_SHA_256);
  assert.equal(serializeB1EnvironmentReceipt(receipt).endsWith("\n"), true);
  assert.throws(
    () => createB1EnvironmentReceipt({
      ...structuredClone(ENVIRONMENT_INPUT),
      hardware: {
        ...ENVIRONMENT_INPUT.hardware,
        cpuModel: "C:\\Users\\person\\cpu",
      },
    }),
    /public-safe text/,
  );
});

function passingOperation(overrides = {}) {
  return {
    fixtureId: "managed-full-text-500mib",
    fixtureReceiptSha256: SHA_256,
    environmentReceiptSha256: ENVIRONMENT_SHA_256,
    candidate: {
      recordCap: 1024,
      byteCapBytes: 4 * 1024 * 1024,
    },
    runMode: "cold",
    runOrdinal: 1,
    operation: "admission",
    totalDurationMs: 900_000,
    batchDurationsMs: [...Array.from({ length: 19 }, () => 2_000), 5_000],
    progressEventOffsetsMs: Array.from({ length: 450 }, (_, index) => (index + 1) * 2_000),
    restart: {
      attempted: false,
    },
    cancellation: {
      attempted: false,
    },
    mainThread: {
      metricAvailable: true,
      maximumTaskMs: 200,
    },
    memory: {
      metricAvailable: true,
      peakHeapGrowthBytes: B1_MAX_HEAP_GROWTH_BYTES,
    },
    indexedDb: {
      metricAvailable: true,
      expectedDirection: "increase",
      sourceCanonicalBytes: 524_288_000,
      usageBeforeBytes: 1_000,
      quotaBeforeBytes: 2_000_000_000,
      usageAfterBytes: 524_289_000,
      quotaAfterBytes: 2_000_000_000,
      cleanupUsageBytes: 1_000,
      cleanupQuotaBytes: 2_000_000_000,
      readbackVerified: true,
    },
    assertions: {
      atomicVersionCommitOrRollback: true,
      ledgerMatchesVersionBytes: true,
      exactCapacityBoundaryEnforced: true,
      stagedRowsInvisible: true,
      committedRowsVisibleTogether: true,
      orphanRowsHiddenAndCleanable: true,
      cleanupReadbackVerified: true,
    },
    ...overrides,
  };
}

test("GATE-014-B1 operation receipt passes at every inclusive numeric boundary", () => {
  const receipt = createB1OperationReceipt(passingOperation());

  assert.equal(receipt.status, "pass");
  assert.equal(receipt.committedBatchCount, 20);
  assert.equal(receipt.batchDurationMedianMs, 2_000);
  assert.equal(receipt.batchDurationP95Ms, 2_000);
  assert.equal(receipt.batchDurationMaximumMs, 5_000);
  assert.equal(receipt.firstProgressEventLatencyMs, 2_000);
  assert.equal(receipt.maximumProgressEventGapMs, 2_000);
  assert.equal(receipt.storesSensitiveText, false);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.candidate), true);
});

test("GATE-014-B1 records delayed quota reclamation without overriding cleanup readback", () => {
  const receipt = createB1OperationReceipt(passingOperation({
    indexedDb: {
      metricAvailable: true,
      expectedDirection: "increase",
      sourceCanonicalBytes: 524_288_000,
      usageBeforeBytes: 1_000,
      quotaBeforeBytes: 2_000_000_000,
      usageAfterBytes: 524_289_000,
      quotaAfterBytes: 2_000_000_000,
      cleanupUsageBytes: 524_300_000,
      cleanupQuotaBytes: 2_000_000_000,
      readbackVerified: true,
    },
  }));

  assert.equal(receipt.status, "pass");
  assert.equal(receipt.indexedDb.cleanupUsageBytes, 524_300_000);
});

test("GATE-014-B1 operation receipt fails when any measured threshold is exceeded", () => {
  const cases = [
    { totalDurationMs: 900_001 },
    { batchDurationsMs: Array.from({ length: 20 }, () => 2_001) },
    { batchDurationsMs: [...Array.from({ length: 19 }, () => 1), 5_001] },
    {
      progressEventOffsetsMs: [2_001, ...Array.from({ length: 449 }, (_, index) => 4_000 + index * 1_999)],
    },
    {
      mainThread: {
        metricAvailable: true,
        maximumTaskMs: 201,
      },
    },
    {
      memory: {
        metricAvailable: true,
        peakHeapGrowthBytes: B1_MAX_HEAP_GROWTH_BYTES + 1,
      },
    },
  ];

  for (const overrides of cases) {
    assert.equal(createB1OperationReceipt(passingOperation(overrides)).status, "fail");
  }
});

test("GATE-014-B1 operation receipt fails closed when a required metric is unavailable", () => {
  const receipt = createB1OperationReceipt(passingOperation({
    memory: {
      metricAvailable: false,
      reasonCode: "browser_metric_unavailable",
    },
  }));

  assert.equal(receipt.status, "insufficient_evidence");
  assert.deepEqual(receipt.insufficientEvidence, ["memory_metric_unavailable"]);
});

test("GATE-014-B1 operation receipt rejects an unavailable main-thread metric", () => {
  const receipt = createB1OperationReceipt(passingOperation({
    mainThread: {
      metricAvailable: false,
      reasonCode: "browser_metric_unavailable",
    },
  }));

  assert.equal(receipt.status, "insufficient_evidence");
  assert.deepEqual(receipt.insufficientEvidence, ["main_thread_metric_unavailable"]);
});

test("GATE-014-B1 receipt rejects unknown fields, unsafe identities, and non-plain input", () => {
  assert.throws(
    () => createB1OperationReceipt(passingOperation({ unexpected: true })),
    /unsupported field: unexpected/,
  );
  assert.throws(
    () => createB1OperationReceipt(passingOperation({ fixtureId: "C:\\Users\\person\\fixture" })),
    /fixtureId/,
  );
  assert.throws(
    () => createB1OperationReceipt(Object.assign(Object.create({ polluted: true }), passingOperation())),
    /plain object/,
  );
});

function reportOperation({
  fixtureId,
  fixtureReceiptSha256,
  recordCap,
  byteCapBytes,
  runMode,
  runOrdinal,
  operation,
}) {
  return passingOperation({
    fixtureId,
    fixtureReceiptSha256,
    candidate: { recordCap, byteCapBytes },
    runMode,
    runOrdinal,
    operation,
    totalDurationMs: 1_000,
    batchDurationsMs: [100],
    progressEventOffsetsMs: [],
    restart: operation === "restart"
      ? {
          attempted: true,
          stateVisibleMs: 5_000,
          remainingWork: true,
          nextProgressMs: 2_000,
          readbackVerified: true,
        }
      : { attempted: false },
    cancellation: operation === "cancellation"
      ? {
          attempted: true,
          acknowledgementMs: 1_000,
          writesAfterTwoSeconds: 0,
        }
      : { attempted: false },
    indexedDb: {
      metricAvailable: true,
      expectedDirection: ["admission", "restore_staging"].includes(operation)
        ? "increase"
        : ["selected_version_removal", "full_clear"].includes(operation)
          ? "decrease"
          : "stable",
      sourceCanonicalBytes: 1_000,
      usageBeforeBytes: 1_000,
      quotaBeforeBytes: 100_000_000,
      usageAfterBytes: ["admission", "restore_staging"].includes(operation)
        ? 2_000
        : ["selected_version_removal", "full_clear"].includes(operation)
          ? 500
          : 1_000,
      quotaAfterBytes: 100_000_000,
      cleanupUsageBytes: ["admission", "restore_staging"].includes(operation) ? 1_000 : 500,
      cleanupQuotaBytes: 100_000_000,
      readbackVerified: true,
    },
  });
}

function completeReportInput() {
  const fixtureReceipts = Object.fromEntries(
    B1_REQUIRED_FIXTURE_IDS.map((fixtureId, index) => [
      fixtureId,
      `${index}`.repeat(64),
    ]),
  );
  const rawOperations = [];
  for (const recordCap of B1_RECORD_CAPS) {
    for (const byteCapBytes of B1_BYTE_CAPS) {
      for (const fixtureId of B1_REQUIRED_FIXTURE_IDS) {
        for (const [runMode, count] of [["cold", 3], ["warm", 5]]) {
          for (let runOrdinal = 1; runOrdinal <= count; runOrdinal += 1) {
            for (const operation of B1_OPERATION_KINDS) {
              rawOperations.push(reportOperation({
                fixtureId,
                fixtureReceiptSha256: fixtureReceipts[fixtureId],
                recordCap,
                byteCapBytes,
                runMode,
                runOrdinal,
                operation,
              }));
            }
          }
        }
      }
    }
  }
  return {
    environment: structuredClone(ENVIRONMENT_INPUT),
    environmentReceiptSha256: ENVIRONMENT_SHA_256,
    fixtureReceipts,
    rawOperations,
  };
}

test("GATE-014-B1 report requires complete raw coverage and selects the largest passing candidate", () => {
  const input = completeReportInput();
  const report = evaluateB1Report(input);

  assert.equal(report.status, "pass");
  assert.deepEqual(report.selectedCandidate, {
    recordCap: 1024,
    byteCapBytes: 4 * 1024 * 1024,
  });
  assert.equal(report.coverage.expectedOperationCount, input.rawOperations.length);
  assert.equal(report.coverage.missingOperationCount, 0);
  assert.equal(report.realBilibiliSubtitleRepresentativeness, "insufficient_evidence");
  assert.equal(report.maximumMeasuredSegmentCountTail, "insufficient_evidence");
  assert.equal(report.provisionalRestoreHeadroom.status, "pass");
  assert.equal(report.provisionalRestoreHeadroom.roundedAmplificationRatio, 1);
  assert.equal(report.provisionalRestoreHeadroom.provisionalMultiplier, 1.25);
  assert.equal(report.provisionalRestoreHeadroom.fixedReserveBytes, 64 * 1024 * 1024);
  assert.equal(report.provisionalRestoreHeadroom.deliberatelyInsufficientProbe.allowed, false);
  assert.equal(report.provisionalRestoreHeadroom.nearLimitProbe.allowed, true);
  assert.match(serializeB1Report(report), /"selectedCandidate"/);
  assert.equal(serializeB1Report(report).endsWith("\n"), true);
  assert.equal(Object.isFrozen(report), true);
});

test("GATE-014-B1 report stays insufficient when any required raw operation is absent", () => {
  const input = completeReportInput();
  input.rawOperations.pop();
  const report = evaluateB1Report(input);

  assert.equal(report.status, "insufficient_evidence");
  assert.equal(report.selectedCandidate, null);
  assert.equal(report.coverage.missingOperationCount, 1);
});

test("GATE-014-B1 report stays insufficient when provisional restore headroom rejects a measured run", () => {
  const input = completeReportInput();
  const restore = input.rawOperations.find(operation =>
    operation.candidate.recordCap === 1024
      && operation.candidate.byteCapBytes === 4 * 1024 * 1024
      && operation.operation === "restore_staging",
  );
  restore.indexedDb.quotaBeforeBytes = 60_000_000;
  const report = evaluateB1Report(input);

  assert.equal(report.status, "insufficient_evidence");
  assert.equal(report.selectedCandidate, null);
  assert.equal(report.provisionalRestoreHeadroom.status, "insufficient_evidence");
  assert.equal(report.provisionalRestoreHeadroom.allMeasuredRunsAllowed, false);
});

test("GATE-014-B1 candidate tie-break records rejected combinations instead of averaging failures", () => {
  const input = completeReportInput();
  const target = input.rawOperations.find(operation =>
    operation.candidate.recordCap === 1024
      && operation.candidate.byteCapBytes === 4 * 1024 * 1024
      && operation.operation === "admission",
  );
  target.mainThread.maximumTaskMs = 201;
  const report = evaluateB1Report(input);

  assert.equal(report.status, "pass");
  assert.deepEqual(report.selectedCandidate, {
    recordCap: 1024,
    byteCapBytes: 2 * 1024 * 1024,
  });
  assert.equal(
    report.candidates.find(candidate =>
      candidate.recordCap === 1024 && candidate.byteCapBytes === 4 * 1024 * 1024,
    ).status,
    "fail",
  );
});

test("GATE-014-B1 report rejects duplicate run identities and fixture hash drift", () => {
  const duplicate = completeReportInput();
  duplicate.rawOperations.push(duplicate.rawOperations[0]);
  assert.throws(() => evaluateB1Report(duplicate), /duplicate B1 operation identity/);

  const drift = completeReportInput();
  drift.rawOperations[0].fixtureReceiptSha256 = "f".repeat(64);
  assert.throws(() => evaluateB1Report(drift), /fixture receipt SHA-256 mismatch/);

  const environmentDrift = completeReportInput();
  environmentDrift.rawOperations[0].environmentReceiptSha256 = "e".repeat(64);
  assert.throws(
    () => evaluateB1Report(environmentDrift),
    /operation environment receipt SHA-256 mismatch/,
  );
});
