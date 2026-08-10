import { createHash } from "node:crypto";

import {
  PUBLIC_SAFE_ID_PATTERN,
  SENSITIVE_RECEIPT_TOKEN_PATTERN,
} from "./gate-014-receipt-helpers.mjs";
import { restorePreflightAllows } from "../tests/fixtures/gate-014/b1-extension/restore-preflight.js";

export const B1_RECEIPT_CONTRACT = "gate-014-b1-operation-v1";
export const B1_ENVIRONMENT_CONTRACT = "gate-014-b1-environment-v1";
export const B1_MAX_HEAP_GROWTH_BYTES = 256 * 1024 * 1024;
export const B1_RECORD_CAPS = deepFreeze([256, 512, 1024]);
export const B1_BYTE_CAPS = deepFreeze(
  [1, 2, 4].map((value) => value * 1024 * 1024),
);
export const B1_REQUIRED_FIXTURE_IDS = deepFreeze([
  "managed-full-text-100mib",
  "managed-full-text-400mib",
  "managed-full-text-500mib",
  "single-version-64mib",
  "high-fragmentation-pathological",
]);
export const B1_OPERATION_KINDS = deepFreeze([
  "admission",
  "ordered_read",
  "selected_version_removal",
  "ledger_repair",
  "full_clear",
  "restore_staging",
  "commit_visibility",
  "marker_normalization",
  "restart",
  "cancellation",
  "quota_failure",
  "atomic_version",
  "capacity_boundary",
]);
export const B1_RUN_COUNTS = deepFreeze({ cold: 3, warm: 5 });

const MAX_BATCH_P95_MS = 2_000;
const MAX_BATCH_DURATION_MS = 5_000;
const MAX_PROGRESS_GAP_MS = 2_000;
const MAX_RESTART_VISIBILITY_MS = 5_000;
const MAX_RESTART_PROGRESS_MS = 2_000;
const MAX_CANCELLATION_ACK_MS = 1_000;
const MAX_MAIN_THREAD_TASK_MS = 200;

const TOTAL_DURATION_LIMITS_MS = Object.freeze({
  admission: 15 * 60 * 1_000,
  restore_staging: 15 * 60 * 1_000,
  ordered_read: 10 * 60 * 1_000,
  ledger_repair: 10 * 60 * 1_000,
  full_clear: 10 * 60 * 1_000,
});

const OPERATION_KINDS = new Set(B1_OPERATION_KINDS);

const ASSERTION_FIELDS = Object.freeze([
  "atomicVersionCommitOrRollback",
  "ledgerMatchesVersionBytes",
  "exactCapacityBoundaryEnforced",
  "stagedRowsInvisible",
  "committedRowsVisibleTogether",
  "orphanRowsHiddenAndCleanable",
  "cleanupReadbackVerified",
  "restorePreflightBoundaryVerified",
  "warmStartCompleteGenerationVerified",
]);

export function createB1EnvironmentReceipt(input) {
  assertPlainObject(input, "B1 environment receipt");
  assertAllowedFields(input, [
    "startedAtEpochMs",
    "completedAtEpochMs",
    "repositoryCommitSha",
    "benchmarkSourceSha256",
    "packageLockSha256",
    "productionDistSha256",
    "fixtureGeneratorVersion",
    "operatingSystem",
    "hardware",
    "runtime",
    "browser",
    "execution",
    "a2CalibrationStatus",
    "storesSensitiveText",
  ]);
  const startedAtEpochMs = assertPositiveSafeInteger(
    input.startedAtEpochMs,
    "startedAtEpochMs",
  );
  const completedAtEpochMs = assertPositiveSafeInteger(
    input.completedAtEpochMs,
    "completedAtEpochMs",
  );
  if (completedAtEpochMs < startedAtEpochMs) {
    throw new Error("completedAtEpochMs must not precede startedAtEpochMs");
  }

  assertPlainObject(input.operatingSystem, "operatingSystem");
  assertAllowedFields(input.operatingSystem, [
    "platform",
    "release",
    "architecture",
  ]);
  const operatingSystem = {
    platform: assertEnum(
      input.operatingSystem.platform,
      ["win32"],
      "operatingSystem.platform",
    ),
    release: assertPublicSafeText(
      input.operatingSystem.release,
      "operatingSystem.release",
    ),
    architecture: assertEnum(
      input.operatingSystem.architecture,
      ["x64", "arm64"],
      "operatingSystem.architecture",
    ),
  };

  assertPlainObject(input.hardware, "hardware");
  assertAllowedFields(input.hardware, [
    "cpuModel",
    "logicalCoreCount",
    "totalMemoryBytes",
    "freeDiskBytesAtStart",
    "freeDiskBytesAtEnd",
  ]);
  const hardware = {
    cpuModel: assertPublicSafeText(
      input.hardware.cpuModel,
      "hardware.cpuModel",
    ),
    logicalCoreCount: assertPositiveSafeInteger(
      input.hardware.logicalCoreCount,
      "hardware.logicalCoreCount",
    ),
    totalMemoryBytes: assertPositiveSafeInteger(
      input.hardware.totalMemoryBytes,
      "hardware.totalMemoryBytes",
    ),
    freeDiskBytesAtStart: assertPositiveSafeInteger(
      input.hardware.freeDiskBytesAtStart,
      "hardware.freeDiskBytesAtStart",
    ),
    freeDiskBytesAtEnd: assertPositiveSafeInteger(
      input.hardware.freeDiskBytesAtEnd,
      "hardware.freeDiskBytesAtEnd",
    ),
  };

  assertPlainObject(input.runtime, "runtime");
  assertAllowedFields(input.runtime, ["nodeVersion"]);
  const runtime = {
    nodeVersion: assertPattern(
      input.runtime.nodeVersion,
      /^v\d+\.\d+\.\d+$/,
      "runtime.nodeVersion",
    ),
  };

  assertPlainObject(input.browser, "browser");
  assertAllowedFields(input.browser, [
    "flavor",
    "version",
    "channel",
    "officialStableVersion",
    "stableVersionSource",
    "headlessMode",
    "sandboxEnabled",
  ]);
  const browser = {
    flavor: assertEnum(
      input.browser.flavor,
      ["chrome_for_testing_stable"],
      "browser.flavor",
    ),
    version: assertPattern(
      input.browser.version,
      /^\d+\.\d+\.\d+\.\d+$/,
      "browser.version",
    ),
    channel: assertEnum(input.browser.channel, ["stable"], "browser.channel"),
    officialStableVersion: assertPattern(
      input.browser.officialStableVersion,
      /^\d+\.\d+\.\d+\.\d+$/,
      "browser.officialStableVersion",
    ),
    stableVersionSource: assertEnum(
      input.browser.stableVersionSource,
      ["official_last_known_good_versions_with_downloads_json"],
      "browser.stableVersionSource",
    ),
    headlessMode: assertEnum(
      input.browser.headlessMode,
      ["new"],
      "browser.headlessMode",
    ),
    sandboxEnabled: assertExactBoolean(
      input.browser.sandboxEnabled,
      true,
      "browser.sandboxEnabled",
    ),
  };
  if (browser.version !== browser.officialStableVersion) {
    throw new Error("browser version must match official stable version");
  }

  assertPlainObject(input.execution, "execution");
  assertAllowedFields(input.execution, [
    "commandId",
    "productionExtensionMode",
    "networkPolicy",
    "coldProfilePolicy",
    "warmProfilePolicy",
    "coldRunsPerCandidateFixture",
    "warmRunsPerCandidateFixture",
    "externalNetworkUsed",
    "realUserProfileRead",
    "bilibiliLoginUsed",
    "browserObservation",
  ]);
  const execution = {
    commandId: assertEnum(
      input.execution.commandId,
      ["gate014_b1_full_matrix"],
      "execution.commandId",
    ),
    productionExtensionMode: assertEnum(
      input.execution.productionExtensionMode,
      ["unpacked"],
      "execution.productionExtensionMode",
    ),
    networkPolicy: assertEnum(
      input.execution.networkPolicy,
      ["loopback_only_external_dns_blocked"],
      "execution.networkPolicy",
    ),
    coldProfilePolicy: assertEnum(
      input.execution.coldProfilePolicy,
      ["fresh_temporary_profile_per_run"],
      "execution.coldProfilePolicy",
    ),
    warmProfilePolicy: assertEnum(
      input.execution.warmProfilePolicy,
      ["opened_complete_seed_generation_with_group_profile_reuse"],
      "execution.warmProfilePolicy",
    ),
    coldRunsPerCandidateFixture: assertExactInteger(
      input.execution.coldRunsPerCandidateFixture,
      B1_RUN_COUNTS.cold,
      "execution.coldRunsPerCandidateFixture",
    ),
    warmRunsPerCandidateFixture: assertExactInteger(
      input.execution.warmRunsPerCandidateFixture,
      B1_RUN_COUNTS.warm,
      "execution.warmRunsPerCandidateFixture",
    ),
    externalNetworkUsed: assertExactBoolean(
      input.execution.externalNetworkUsed,
      false,
      "execution.externalNetworkUsed",
    ),
    realUserProfileRead: assertExactBoolean(
      input.execution.realUserProfileRead,
      false,
      "execution.realUserProfileRead",
    ),
    bilibiliLoginUsed: assertExactBoolean(
      input.execution.bilibiliLoginUsed,
      false,
      "execution.bilibiliLoginUsed",
    ),
    browserObservation: validateBrowserObservation(
      input.execution.browserObservation,
    ),
  };

  const receipt = {
    contract: B1_ENVIRONMENT_CONTRACT,
    startedAtEpochMs,
    completedAtEpochMs,
    repositoryCommitSha: assertGitSha(
      input.repositoryCommitSha,
      "repositoryCommitSha",
    ),
    benchmarkSourceSha256: assertSha256(
      input.benchmarkSourceSha256,
      "benchmarkSourceSha256",
    ),
    packageLockSha256: assertSha256(
      input.packageLockSha256,
      "packageLockSha256",
    ),
    productionDistSha256: assertSha256(
      input.productionDistSha256,
      "productionDistSha256",
    ),
    fixtureGeneratorVersion: assertPublicSafeId(
      input.fixtureGeneratorVersion,
      "fixtureGeneratorVersion",
    ),
    operatingSystem,
    hardware,
    runtime,
    browser,
    execution,
    a2CalibrationStatus: assertEnum(
      input.a2CalibrationStatus,
      ["insufficient_evidence"],
      "a2CalibrationStatus",
    ),
    storesSensitiveText: assertExactBoolean(
      input.storesSensitiveText,
      false,
      "storesSensitiveText",
    ),
  };
  assertPublicSafeValue(receipt);
  return deepFreeze(receipt);
}

export function serializeB1EnvironmentReceipt(receipt) {
  if (!receipt || receipt.contract !== B1_ENVIRONMENT_CONTRACT) {
    throw new Error(
      "serializeB1EnvironmentReceipt requires a validated environment receipt",
    );
  }
  assertPublicSafeValue(receipt);
  return `${JSON.stringify(sortObjectKeys(receipt), null, 2)}\n`;
}

export function hashB1EnvironmentReceipt(receipt) {
  return createHash("sha256")
    .update(serializeB1EnvironmentReceipt(receipt), "utf8")
    .digest("hex");
}

export function createB1RestorePreflightValidationReceipt(input) {
  assertPlainObject(input, "B1 restore preflight validation");
  assertAllowedFields(input, [
    "fixtureId",
    "fixtureReceiptSha256",
    "environmentReceiptSha256",
    "candidate",
    "startedAtEpochMs",
    "completedAtEpochMs",
    "requiredFreeQuotaBytes",
    "physicalQuota",
    "insufficientProbe",
    "exactProbe",
    "cleanupReadbackVerified",
  ]);
  const fixtureId = assertPublicSafeId(input.fixtureId, "fixtureId");
  const fixtureReceiptSha256 = assertSha256(
    input.fixtureReceiptSha256,
    "fixtureReceiptSha256",
  );
  const environmentReceiptSha256 = assertSha256(
    input.environmentReceiptSha256,
    "environmentReceiptSha256",
  );
  const candidate = validateCandidate(input.candidate);
  const startedAtEpochMs = assertPositiveSafeInteger(
    input.startedAtEpochMs,
    "startedAtEpochMs",
  );
  const completedAtEpochMs = assertPositiveSafeInteger(
    input.completedAtEpochMs,
    "completedAtEpochMs",
  );
  if (completedAtEpochMs < startedAtEpochMs) {
    throw new Error("completedAtEpochMs must not precede startedAtEpochMs");
  }
  const requiredFreeQuotaBytes = assertPositiveSafeInteger(
    input.requiredFreeQuotaBytes,
    "requiredFreeQuotaBytes",
  );
  const physicalQuota = validateRestorePhysicalQuota(input.physicalQuota);
  const insufficientProbe = validateRestoreBoundaryProbe(
    input.insufficientProbe,
    "insufficientProbe",
  );
  const exactProbe = validateRestoreBoundaryProbe(
    input.exactProbe,
    "exactProbe",
    { requireWriteReadback: true },
  );
  const cleanupReadbackVerified = assertBoolean(
    input.cleanupReadbackVerified,
    "cleanupReadbackVerified",
  );
  const failures = [];
  const insufficientEvidence = [];
  if (!physicalQuota.metricAvailable) {
    insufficientEvidence.push("physical_quota_metric_unavailable");
  } else if (physicalQuota.availableFreeQuotaBytes < requiredFreeQuotaBytes) {
    failures.push("physical_quota_below_required");
  }
  if (
    insufficientProbe.availableFreeQuotaBytes !== requiredFreeQuotaBytes - 1 ||
    insufficientProbe.requiredFreeQuotaBytes !== requiredFreeQuotaBytes ||
    insufficientProbe.allowed !== false ||
    insufficientProbe.artifactFetchAttempted !== false ||
    insufficientProbe.writesObserved !== 0
  ) {
    failures.push("insufficient_boundary_probe_failed");
  }
  if (
    exactProbe.availableFreeQuotaBytes !== requiredFreeQuotaBytes ||
    exactProbe.requiredFreeQuotaBytes !== requiredFreeQuotaBytes ||
    exactProbe.allowed !== true ||
    exactProbe.artifactFetchAttempted !== true ||
    exactProbe.writesObserved < 1 ||
    exactProbe.writeReadbackVerified !== true
  ) {
    failures.push("exact_boundary_probe_failed");
  }
  if (!cleanupReadbackVerified) {
    failures.push("restore_validation_cleanup_failed");
  }
  const status =
    failures.length > 0
      ? "fail"
      : insufficientEvidence.length > 0
        ? "insufficient_evidence"
        : "pass";
  const receipt = {
    contract: "gate-014-b1-restore-preflight-validation-v1",
    status,
    storesSensitiveText: false,
    fixtureId,
    fixtureReceiptSha256,
    environmentReceiptSha256,
    candidate,
    startedAtEpochMs,
    completedAtEpochMs,
    requiredFreeQuotaBytes,
    physicalQuota,
    insufficientProbe,
    exactProbe,
    cleanupReadbackVerified,
    failures: deepFreeze([...new Set(failures)]),
    insufficientEvidence: deepFreeze([...new Set(insufficientEvidence)]),
  };
  assertPublicSafeValue(receipt);
  return deepFreeze(receipt);
}

export function validateB1RestorePreflightValidationReceipt(input) {
  assertPlainObject(input, "B1 restore preflight validation receipt");
  assertAllowedFields(input, [
    "contract",
    "status",
    "storesSensitiveText",
    "fixtureId",
    "fixtureReceiptSha256",
    "environmentReceiptSha256",
    "candidate",
    "startedAtEpochMs",
    "completedAtEpochMs",
    "requiredFreeQuotaBytes",
    "physicalQuota",
    "insufficientProbe",
    "exactProbe",
    "cleanupReadbackVerified",
    "failures",
    "insufficientEvidence",
  ]);
  const {
    contract,
    status,
    storesSensitiveText,
    failures,
    insufficientEvidence,
    ...source
  } = input;
  if (
    contract !== "gate-014-b1-restore-preflight-validation-v1" ||
    storesSensitiveText !== false ||
    !["pass", "fail", "insufficient_evidence"].includes(status) ||
    !Array.isArray(failures) ||
    !Array.isArray(insufficientEvidence)
  ) {
    throw new Error("B1 restore preflight validation receipt is invalid");
  }
  const recomputed = createB1RestorePreflightValidationReceipt(source);
  if (
    JSON.stringify(sortObjectKeys(recomputed)) !==
    JSON.stringify(sortObjectKeys(input))
  ) {
    throw new Error("B1 restore preflight validation receipt drift detected");
  }
  return recomputed;
}

export function createB1OperationReceipt(input) {
  assertPlainObject(input, "B1 operation receipt");
  assertAllowedFields(input, [
    "fixtureId",
    "fixtureReceiptSha256",
    "environmentReceiptSha256",
    "candidate",
    "runMode",
    "runOrdinal",
    "operation",
    "totalDurationMs",
    "committedBatchCount",
    "committedBatchDurationsMs",
    "batchDurationsMs",
    "progressEventOffsetsMs",
    "restart",
    "cancellation",
    "mainThread",
    "memory",
    "indexedDb",
    "assertions",
  ]);

  const fixtureId = assertPublicSafeId(input.fixtureId, "fixtureId");
  const fixtureReceiptSha256 = assertSha256(
    input.fixtureReceiptSha256,
    "fixtureReceiptSha256",
  );
  const environmentReceiptSha256 = assertSha256(
    input.environmentReceiptSha256,
    "environmentReceiptSha256",
  );
  const candidate = validateCandidate(input.candidate);
  const runMode = assertEnum(input.runMode, ["cold", "warm"], "runMode");
  const runOrdinal = assertPositiveSafeInteger(input.runOrdinal, "runOrdinal");
  const operation = assertEnum(
    input.operation,
    [...OPERATION_KINDS],
    "operation",
  );
  const totalDurationMs = assertNonNegativeFiniteNumber(
    input.totalDurationMs,
    "totalDurationMs",
  );
  const committedBatchCount = assertNonNegativeSafeInteger(
    input.committedBatchCount,
    "committedBatchCount",
  );
  const committedBatchDurationsMs = validateNumberArray(
    input.committedBatchDurationsMs,
    "committedBatchDurationsMs",
    { minimumLength: 0 },
  );
  if (committedBatchDurationsMs.length !== committedBatchCount) {
    throw new Error(
      "committedBatchCount must match committedBatchDurationsMs length",
    );
  }
  const batchDurationsMs = validateNumberArray(
    input.batchDurationsMs,
    "batchDurationsMs",
    {
      minimumLength: 1,
    },
  );
  assertNumberMultisetSubset(
    committedBatchDurationsMs,
    batchDurationsMs,
    "committedBatchDurationsMs",
  );
  const progressEventOffsetsMs = validateNumberArray(
    input.progressEventOffsetsMs,
    "progressEventOffsetsMs",
    { minimumLength: 0 },
  );
  assertStrictlyIncreasingOffsets(progressEventOffsetsMs, totalDurationMs);
  const restart = validateRestart(input.restart, operation);
  const cancellation = validateCancellation(input.cancellation, operation);
  const mainThread = validateMainThread(input.mainThread);
  const memory = validateMemory(input.memory);
  const indexedDb = validateIndexedDb(input.indexedDb);
  const assertions = validateAssertions(input.assertions);

  const sortedCommittedBatchDurations = [...committedBatchDurationsMs].sort(
    (left, right) => left - right,
  );
  const sortedInstrumentedBatchDurations = [...batchDurationsMs].sort(
    (left, right) => left - right,
  );
  const batchDurationMedianMs =
    sortedCommittedBatchDurations.length === 0
      ? null
      : percentile(sortedCommittedBatchDurations, 0.5);
  const batchDurationP95Ms =
    sortedCommittedBatchDurations.length === 0
      ? null
      : percentile(sortedCommittedBatchDurations, 0.95);
  const batchDurationMaximumMs =
    sortedCommittedBatchDurations.at(-1) ?? null;
  const instrumentedBatchDurationMedianMs = percentile(
    sortedInstrumentedBatchDurations,
    0.5,
  );
  const instrumentedBatchDurationP95Ms = percentile(
    sortedInstrumentedBatchDurations,
    0.95,
  );
  const instrumentedBatchDurationMaximumMs =
    sortedInstrumentedBatchDurations.at(-1);
  const progress = calculateProgressMetrics(
    progressEventOffsetsMs,
    totalDurationMs,
  );

  const failures = [];
  const insufficientEvidence = [];
  const totalDurationLimitMs = TOTAL_DURATION_LIMITS_MS[operation] ?? null;
  if (totalDurationLimitMs !== null && totalDurationMs > totalDurationLimitMs) {
    failures.push("total_duration_exceeded");
  }
  if (
    batchDurationP95Ms !== null &&
    batchDurationP95Ms > MAX_BATCH_P95_MS
  ) {
    failures.push("batch_p95_exceeded");
  }
  if (
    batchDurationMaximumMs !== null &&
    batchDurationMaximumMs > MAX_BATCH_DURATION_MS
  ) {
    failures.push("batch_maximum_exceeded");
  }
  if (totalDurationMs > MAX_PROGRESS_GAP_MS) {
    if (progressEventOffsetsMs.length === 0) {
      insufficientEvidence.push("progress_metric_unavailable");
    } else {
      if (progress.firstLatencyMs > MAX_PROGRESS_GAP_MS) {
        failures.push("first_progress_late");
      }
      if (progress.maximumGapMs > MAX_PROGRESS_GAP_MS) {
        failures.push("progress_gap_exceeded");
      }
    }
  }
  if (restart.attempted) {
    if (restart.stateVisibleMs > MAX_RESTART_VISIBILITY_MS) {
      failures.push("restart_state_visibility_exceeded");
    }
    if (
      restart.remainingWork &&
      restart.nextProgressMs > MAX_RESTART_PROGRESS_MS
    ) {
      failures.push("restart_progress_exceeded");
    }
    if (!restart.readbackVerified) {
      failures.push("restart_readback_failed");
    }
  }
  if (cancellation.attempted) {
    if (cancellation.acknowledgementMs > MAX_CANCELLATION_ACK_MS) {
      failures.push("cancellation_ack_exceeded");
    }
    if (cancellation.writesAfterTwoSeconds !== 0) {
      failures.push("post_cancellation_write_detected");
    }
  }
  if (!mainThread.metricAvailable) {
    insufficientEvidence.push("main_thread_metric_unavailable");
  } else if (mainThread.maximumTaskMs > MAX_MAIN_THREAD_TASK_MS) {
    failures.push("main_thread_task_exceeded");
  }
  if (!memory.metricAvailable) {
    insufficientEvidence.push("memory_metric_unavailable");
  } else if (memory.peakHeapGrowthBytes > B1_MAX_HEAP_GROWTH_BYTES) {
    failures.push("heap_growth_exceeded");
  }
  if (!indexedDb.metricAvailable) {
    insufficientEvidence.push("indexeddb_metric_unavailable");
  } else if (!indexedDb.metricsConsistent) {
    failures.push("indexeddb_measurement_inconsistent");
  }
  for (const field of ASSERTION_FIELDS) {
    if (!assertions[field]) {
      failures.push(`assertion_failed:${field}`);
    }
  }

  const status =
    failures.length > 0
      ? "fail"
      : insufficientEvidence.length > 0
        ? "insufficient_evidence"
        : "pass";
  const receipt = {
    contract: B1_RECEIPT_CONTRACT,
    fixtureId,
    fixtureReceiptSha256,
    environmentReceiptSha256,
    candidate,
    runMode,
    runOrdinal,
    operation,
    status,
    storesSensitiveText: false,
    totalDurationMs,
    totalDurationLimitMs,
    committedBatchCount,
    batchDurationMedianMs,
    batchDurationP95Ms,
    batchDurationMaximumMs,
    instrumentedBatchCount: batchDurationsMs.length,
    instrumentedBatchDurationMedianMs,
    instrumentedBatchDurationP95Ms,
    instrumentedBatchDurationMaximumMs,
    firstProgressEventLatencyMs: progress.firstLatencyMs,
    maximumProgressEventGapMs: progress.maximumGapMs,
    restart,
    cancellation,
    mainThread,
    mainThreadMaxTaskMs: mainThread.metricAvailable
      ? mainThread.maximumTaskMs
      : null,
    memory,
    indexedDb,
    assertions,
    failures: deepFreeze([...new Set(failures)]),
    insufficientEvidence: deepFreeze([...new Set(insufficientEvidence)]),
  };
  assertPublicSafeValue(receipt);
  return deepFreeze(receipt);
}

export function evaluateB1Report(input) {
  assertPlainObject(input, "B1 report input");
  assertAllowedFields(input, [
    "environment",
    "environmentReceiptSha256",
    "fixtureReceipts",
    "rawOperations",
    "restorePreflightValidation",
  ]);
  const environment = createB1EnvironmentReceipt(input.environment);
  const environmentReceiptSha256 = assertSha256(
    input.environmentReceiptSha256,
    "environmentReceiptSha256",
  );
  if (hashB1EnvironmentReceipt(environment) !== environmentReceiptSha256) {
    throw new Error("environment receipt SHA-256 mismatch");
  }
  const fixtureReceipts = validateFixtureReceiptMap(input.fixtureReceipts);
  const restorePreflightValidation =
    input.restorePreflightValidation === null ||
    input.restorePreflightValidation === undefined
      ? null
      : validateB1RestorePreflightValidationReceipt(
          input.restorePreflightValidation,
        );
  if (restorePreflightValidation !== null) {
    if (
      restorePreflightValidation.environmentReceiptSha256 !==
      environmentReceiptSha256
    ) {
      throw new Error("restore preflight environment receipt SHA-256 mismatch");
    }
    if (
      fixtureReceipts[restorePreflightValidation.fixtureId] !==
      restorePreflightValidation.fixtureReceiptSha256
    ) {
      throw new Error("restore preflight fixture receipt SHA-256 mismatch");
    }
    if (
      restorePreflightValidation.startedAtEpochMs <
        environment.startedAtEpochMs ||
      restorePreflightValidation.completedAtEpochMs >
        environment.completedAtEpochMs
    ) {
      throw new Error("restore preflight validation is outside run window");
    }
  }
  if (!Array.isArray(input.rawOperations)) {
    throw new Error("rawOperations must be an array");
  }

  const expectedIdentities = createExpectedOperationIdentities();
  const seen = new Set();
  const operations = [];
  for (const rawOperation of input.rawOperations) {
    const receipt = createB1OperationReceipt(rawOperation);
    if (fixtureReceipts[receipt.fixtureId] !== receipt.fixtureReceiptSha256) {
      throw new Error(
        `fixture receipt SHA-256 mismatch for ${receipt.fixtureId}`,
      );
    }
    if (receipt.environmentReceiptSha256 !== environmentReceiptSha256) {
      throw new Error("operation environment receipt SHA-256 mismatch");
    }
    const identity = operationIdentity(receipt);
    if (!expectedIdentities.has(identity)) {
      throw new Error(
        `B1 operation identity is outside the required matrix: ${identity}`,
      );
    }
    if (seen.has(identity)) {
      throw new Error(`duplicate B1 operation identity: ${identity}`);
    }
    seen.add(identity);
    operations.push(receipt);
  }

  const missingOperationIdentities = [...expectedIdentities].filter(
    (identity) => !seen.has(identity),
  );
  const candidates = [];
  for (const recordCap of B1_RECORD_CAPS) {
    for (const byteCapBytes of B1_BYTE_CAPS) {
      const candidateOperations = operations.filter(
        (receipt) =>
          receipt.candidate.recordCap === recordCap &&
          receipt.candidate.byteCapBytes === byteCapBytes,
      );
      const missingOperationCount = missingOperationIdentities.filter(
        (identity) => identity.startsWith(`${recordCap}:${byteCapBytes}:`),
      ).length;
      const failedOperationCount = candidateOperations.filter(
        (receipt) => receipt.status === "fail",
      ).length;
      const insufficientOperationCount = candidateOperations.filter(
        (receipt) => receipt.status === "insufficient_evidence",
      ).length;
      const status =
        missingOperationCount > 0 || insufficientOperationCount > 0
          ? "insufficient_evidence"
          : failedOperationCount > 0
            ? "fail"
            : "pass";
      candidates.push(
        deepFreeze({
          recordCap,
          byteCapBytes,
          status,
          measuredOperationCount: candidateOperations.length,
          missingOperationCount,
          failedOperationCount,
          insufficientOperationCount,
        }),
      );
    }
  }

  const coverageComplete = missingOperationIdentities.length === 0;
  const candidateEvidenceComplete = candidates.every(
    (candidate) => candidate.status !== "insufficient_evidence",
  );
  const passingCandidates = candidates
    .filter((candidate) => candidate.status === "pass")
    .sort(
      (left, right) =>
        right.recordCap - left.recordCap ||
        right.byteCapBytes - left.byteCapBytes,
    );
  const baseStatus =
    !coverageComplete || !candidateEvidenceComplete
      ? "insufficient_evidence"
      : passingCandidates.length === 0
        ? "fail"
        : "pass";
  const performanceCandidate =
    baseStatus === "pass"
      ? deepFreeze({
          recordCap: passingCandidates[0].recordCap,
          byteCapBytes: passingCandidates[0].byteCapBytes,
        })
      : null;
  const provisionalRestoreHeadroom = deriveB1RestoreHeadroom(
    operations,
    performanceCandidate,
    restorePreflightValidation,
  );
  const status =
    baseStatus === "pass" && provisionalRestoreHeadroom.status !== "pass"
      ? "insufficient_evidence"
      : baseStatus;
  const selectedCandidate = status === "pass" ? performanceCandidate : null;
  const report = {
    contract: "gate-014-b1-report-v1",
    status,
    storesSensitiveText: false,
    declaredLoad: "deterministic_public_safe_synthetic",
    realBilibiliSubtitleRepresentativeness: "insufficient_evidence",
    maximumMeasuredSegmentCountTail: "insufficient_evidence",
    environmentReceiptSha256,
    environment,
    fixtureReceipts,
    coverage: deepFreeze({
      requiredFixtureCount: B1_REQUIRED_FIXTURE_IDS.length,
      candidateCount: B1_RECORD_CAPS.length * B1_BYTE_CAPS.length,
      coldRunsPerCandidateFixture: B1_RUN_COUNTS.cold,
      warmRunsPerCandidateFixture: B1_RUN_COUNTS.warm,
      operationKindsPerRun: B1_OPERATION_KINDS.length,
      expectedOperationCount: expectedIdentities.size,
      measuredOperationCount: operations.length,
      missingOperationCount: missingOperationIdentities.length,
      missingOperationIdentities: deepFreeze(missingOperationIdentities),
    }),
    provisionalRestoreHeadroom,
    restorePreflightValidation:
      restorePreflightValidation ??
      deepFreeze({
        status: "insufficient_evidence",
        reasonCode: "browser_preflight_validation_missing",
      }),
    selectedCandidate,
    candidates: deepFreeze(candidates),
    operations: deepFreeze(operations),
  };
  assertPublicSafeValue(report);
  return deepFreeze(report);
}

export function serializeB1Report(report) {
  if (!report || report.contract !== "gate-014-b1-report-v1") {
    throw new Error("serializeB1Report requires an evaluated B1 report");
  }
  assertPublicSafeValue(report);
  return `${JSON.stringify(sortObjectKeys(report), null, 2)}\n`;
}

export function deriveB1RestoreHeadroom(
  operations,
  selectedCandidate,
  restorePreflightValidation = null,
) {
  if (!selectedCandidate) {
    return deepFreeze({
      status: "insufficient_evidence",
      reasonCode: "passing_candidate_unavailable",
    });
  }
  const restoreOperations = operations.filter(
    (receipt) =>
      receipt.operation === "restore_staging" &&
      receipt.candidate.recordCap === selectedCandidate.recordCap &&
      receipt.candidate.byteCapBytes === selectedCandidate.byteCapBytes,
  );
  const expectedRestoreCount =
    B1_REQUIRED_FIXTURE_IDS.length * (B1_RUN_COUNTS.cold + B1_RUN_COUNTS.warm);
  if (
    restoreOperations.length !== expectedRestoreCount ||
    restoreOperations.some(
      (receipt) =>
        receipt.status !== "pass" ||
        !receipt.indexedDb.metricAvailable ||
        !Number.isFinite(receipt.indexedDb.stagingAmplificationRatio) ||
        receipt.indexedDb.stagingAmplificationRatio <= 0,
    )
  ) {
    return deepFreeze({
      status: "insufficient_evidence",
      reasonCode: "restore_measurement_incomplete",
    });
  }

  const highestObservedAmplificationRatio = Math.max(
    ...restoreOperations.map(
      (receipt) => receipt.indexedDb.stagingAmplificationRatio,
    ),
  );
  const roundedAmplificationRatio =
    Math.ceil(highestObservedAmplificationRatio * 4) / 4;
  const safetyMarginRatio = 1.25;
  const provisionalMultiplier = roundedAmplificationRatio * safetyMarginRatio;
  const fixedReserveBytes = 64 * 1024 * 1024;
  const actualRuns = restoreOperations.map((receipt) => {
    const requiredFreeQuotaBytes = Math.ceil(
      receipt.indexedDb.sourceCanonicalBytes * provisionalMultiplier +
        fixedReserveBytes,
    );
    const observedFreeQuotaBytes = receipt.indexedDb.freeQuotaBeforeBytes;
    return {
      fixtureId: receipt.fixtureId,
      runMode: receipt.runMode,
      runOrdinal: receipt.runOrdinal,
      requiredFreeQuotaBytes,
      observedFreeQuotaBytes,
      marginBytes: observedFreeQuotaBytes - requiredFreeQuotaBytes,
      allowed: restorePreflightAllows(
        observedFreeQuotaBytes,
        requiredFreeQuotaBytes,
      ),
    };
  });
  const maximumRequiredFreeQuotaBytes = Math.max(
    ...actualRuns.map((run) => run.requiredFreeQuotaBytes),
  );
  const deliberatelyInsufficientProbe = {
    availableFreeQuotaBytes: maximumRequiredFreeQuotaBytes - 1,
    requiredFreeQuotaBytes: maximumRequiredFreeQuotaBytes,
    allowed: restorePreflightAllows(
      maximumRequiredFreeQuotaBytes - 1,
      maximumRequiredFreeQuotaBytes,
    ),
  };
  const nearLimitProbe = {
    availableFreeQuotaBytes: maximumRequiredFreeQuotaBytes,
    requiredFreeQuotaBytes: maximumRequiredFreeQuotaBytes,
    allowed: restorePreflightAllows(
      maximumRequiredFreeQuotaBytes,
      maximumRequiredFreeQuotaBytes,
    ),
  };
  const allMeasuredRunsAllowed = actualRuns.every((run) => run.allowed);
  const probesVerified =
    deliberatelyInsufficientProbe.allowed === false &&
    nearLimitProbe.allowed === true;
  const browserValidationVerified =
    restorePreflightValidation?.status === "pass" &&
    restorePreflightValidation.fixtureId === "managed-full-text-500mib" &&
    restorePreflightValidation.candidate.recordCap ===
      selectedCandidate.recordCap &&
    restorePreflightValidation.candidate.byteCapBytes ===
      selectedCandidate.byteCapBytes &&
    restorePreflightValidation.requiredFreeQuotaBytes ===
      maximumRequiredFreeQuotaBytes &&
    restorePreflightValidation.insufficientProbe.availableFreeQuotaBytes ===
      deliberatelyInsufficientProbe.availableFreeQuotaBytes &&
    restorePreflightValidation.insufficientProbe.requiredFreeQuotaBytes ===
      deliberatelyInsufficientProbe.requiredFreeQuotaBytes &&
    restorePreflightValidation.exactProbe.availableFreeQuotaBytes ===
      nearLimitProbe.availableFreeQuotaBytes &&
    restorePreflightValidation.exactProbe.requiredFreeQuotaBytes ===
      nearLimitProbe.requiredFreeQuotaBytes;
  return deepFreeze({
    status:
      allMeasuredRunsAllowed && probesVerified && browserValidationVerified
        ? "pass"
        : "insufficient_evidence",
    highestObservedAmplificationRatio,
    roundedAmplificationRatio,
    safetyMarginRatio,
    provisionalMultiplier,
    fixedReserveBytes,
    measuredRestoreRunCount: restoreOperations.length,
    maximumTemporaryOverheadBytes: Math.max(
      ...restoreOperations.map(
        (receipt) => receipt.indexedDb.temporaryOverheadBytes,
      ),
    ),
    minimumMeasuredQuotaMarginBytes: Math.min(
      ...actualRuns.map((run) => run.marginBytes),
    ),
    allMeasuredRunsAllowed,
    browserValidationVerified,
    deliberatelyInsufficientProbe,
    nearLimitProbe,
  });
}

function validateFixtureReceiptMap(input) {
  assertPlainObject(input, "fixtureReceipts");
  assertAllowedFields(input, B1_REQUIRED_FIXTURE_IDS);
  return deepFreeze(
    Object.fromEntries(
      B1_REQUIRED_FIXTURE_IDS.map((fixtureId) => [
        fixtureId,
        assertSha256(input[fixtureId], `fixtureReceipts.${fixtureId}`),
      ]),
    ),
  );
}

function createExpectedOperationIdentities() {
  const identities = new Set();
  for (const recordCap of B1_RECORD_CAPS) {
    for (const byteCapBytes of B1_BYTE_CAPS) {
      for (const fixtureId of B1_REQUIRED_FIXTURE_IDS) {
        for (const [runMode, count] of Object.entries(B1_RUN_COUNTS)) {
          for (let runOrdinal = 1; runOrdinal <= count; runOrdinal += 1) {
            for (const operation of B1_OPERATION_KINDS) {
              identities.add(
                [
                  recordCap,
                  byteCapBytes,
                  fixtureId,
                  runMode,
                  runOrdinal,
                  operation,
                ].join(":"),
              );
            }
          }
        }
      }
    }
  }
  return identities;
}

function operationIdentity(receipt) {
  return [
    receipt.candidate.recordCap,
    receipt.candidate.byteCapBytes,
    receipt.fixtureId,
    receipt.runMode,
    receipt.runOrdinal,
    receipt.operation,
  ].join(":");
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObjectKeys(value[key])]),
    );
  }
  return value;
}

function validateCandidate(input) {
  assertPlainObject(input, "candidate");
  assertAllowedFields(input, ["recordCap", "byteCapBytes"]);
  const recordCap = assertPositiveSafeInteger(
    input.recordCap,
    "candidate.recordCap",
  );
  const byteCapBytes = assertPositiveSafeInteger(
    input.byteCapBytes,
    "candidate.byteCapBytes",
  );
  if (!B1_RECORD_CAPS.includes(recordCap)) {
    throw new Error("candidate.recordCap is not part of the B1 matrix");
  }
  if (!B1_BYTE_CAPS.includes(byteCapBytes)) {
    throw new Error("candidate.byteCapBytes is not part of the B1 matrix");
  }
  return deepFreeze({ recordCap, byteCapBytes });
}

function validateRestorePhysicalQuota(input) {
  assertPlainObject(input, "physicalQuota");
  const metricAvailable = assertBoolean(
    input.metricAvailable,
    "physicalQuota.metricAvailable",
  );
  if (!metricAvailable) {
    assertAllowedFields(input, ["metricAvailable", "reasonCode"]);
    return deepFreeze({
      metricAvailable: false,
      reasonCode: assertEnum(
        input.reasonCode,
        ["browser_metric_unavailable"],
        "physicalQuota.reasonCode",
      ),
    });
  }
  assertAllowedFields(input, ["metricAvailable", "availableFreeQuotaBytes"]);
  return deepFreeze({
    metricAvailable: true,
    availableFreeQuotaBytes: assertNonNegativeSafeInteger(
      input.availableFreeQuotaBytes,
      "physicalQuota.availableFreeQuotaBytes",
    ),
  });
}

function validateRestoreBoundaryProbe(input, label, options = {}) {
  assertPlainObject(input, label);
  const fields = [
    "availableFreeQuotaBytes",
    "requiredFreeQuotaBytes",
    "allowed",
    "artifactFetchAttempted",
    "writesObserved",
  ];
  if (options.requireWriteReadback) {
    fields.push("writeReadbackVerified");
  }
  assertAllowedFields(input, fields);
  const result = {
    availableFreeQuotaBytes: assertNonNegativeSafeInteger(
      input.availableFreeQuotaBytes,
      `${label}.availableFreeQuotaBytes`,
    ),
    requiredFreeQuotaBytes: assertPositiveSafeInteger(
      input.requiredFreeQuotaBytes,
      `${label}.requiredFreeQuotaBytes`,
    ),
    allowed: assertBoolean(input.allowed, `${label}.allowed`),
    artifactFetchAttempted: assertBoolean(
      input.artifactFetchAttempted,
      `${label}.artifactFetchAttempted`,
    ),
    writesObserved: assertNonNegativeSafeInteger(
      input.writesObserved,
      `${label}.writesObserved`,
    ),
  };
  if (options.requireWriteReadback) {
    result.writeReadbackVerified = assertBoolean(
      input.writeReadbackVerified,
      `${label}.writeReadbackVerified`,
    );
  }
  return deepFreeze(result);
}

function validateRestart(input, operation) {
  assertPlainObject(input, "restart");
  const attempted = assertBoolean(input.attempted, "restart.attempted");
  if (!attempted) {
    assertAllowedFields(input, ["attempted"]);
    if (operation === "restart") {
      throw new Error("restart operation must attempt restart measurement");
    }
    return deepFreeze({ attempted: false });
  }
  assertAllowedFields(input, [
    "attempted",
    "stateVisibleMs",
    "remainingWork",
    "nextProgressMs",
    "readbackVerified",
  ]);
  const remainingWork = assertBoolean(
    input.remainingWork,
    "restart.remainingWork",
  );
  const result = {
    attempted: true,
    stateVisibleMs: assertNonNegativeFiniteNumber(
      input.stateVisibleMs,
      "restart.stateVisibleMs",
    ),
    remainingWork,
    nextProgressMs: assertNonNegativeFiniteNumber(
      input.nextProgressMs,
      "restart.nextProgressMs",
    ),
    readbackVerified: assertBoolean(
      input.readbackVerified,
      "restart.readbackVerified",
    ),
  };
  if (!remainingWork && result.nextProgressMs !== 0) {
    throw new Error("restart.nextProgressMs must be zero when no work remains");
  }
  return deepFreeze(result);
}

function validateCancellation(input, operation) {
  assertPlainObject(input, "cancellation");
  const attempted = assertBoolean(input.attempted, "cancellation.attempted");
  if (!attempted) {
    assertAllowedFields(input, ["attempted"]);
    if (operation === "cancellation") {
      throw new Error(
        "cancellation operation must attempt cancellation measurement",
      );
    }
    return deepFreeze({ attempted: false });
  }
  assertAllowedFields(input, [
    "attempted",
    "acknowledgementMs",
    "writesAfterTwoSeconds",
  ]);
  return deepFreeze({
    attempted: true,
    acknowledgementMs: assertNonNegativeFiniteNumber(
      input.acknowledgementMs,
      "cancellation.acknowledgementMs",
    ),
    writesAfterTwoSeconds: assertNonNegativeSafeInteger(
      input.writesAfterTwoSeconds,
      "cancellation.writesAfterTwoSeconds",
    ),
  });
}

function validateMemory(input) {
  assertPlainObject(input, "memory");
  const metricAvailable = assertBoolean(
    input.metricAvailable,
    "memory.metricAvailable",
  );
  if (!metricAvailable) {
    assertAllowedFields(input, ["metricAvailable", "reasonCode"]);
    return deepFreeze({
      metricAvailable: false,
      reasonCode: assertEnum(
        input.reasonCode,
        ["browser_metric_unavailable", "measurement_interrupted"],
        "memory.reasonCode",
      ),
    });
  }
  assertAllowedFields(input, ["metricAvailable", "peakHeapGrowthBytes"]);
  return deepFreeze({
    metricAvailable: true,
    peakHeapGrowthBytes: assertNonNegativeSafeInteger(
      input.peakHeapGrowthBytes,
      "memory.peakHeapGrowthBytes",
    ),
  });
}

function validateMainThread(input) {
  assertPlainObject(input, "mainThread");
  const metricAvailable = assertBoolean(
    input.metricAvailable,
    "mainThread.metricAvailable",
  );
  if (!metricAvailable) {
    assertAllowedFields(input, ["metricAvailable", "reasonCode"]);
    return deepFreeze({
      metricAvailable: false,
      reasonCode: assertEnum(
        input.reasonCode,
        ["browser_metric_unavailable", "measurement_interrupted"],
        "mainThread.reasonCode",
      ),
    });
  }
  assertAllowedFields(input, ["metricAvailable", "maximumTaskMs"]);
  return deepFreeze({
    metricAvailable: true,
    maximumTaskMs: assertNonNegativeFiniteNumber(
      input.maximumTaskMs,
      "mainThread.maximumTaskMs",
    ),
  });
}

function validateIndexedDb(input) {
  assertPlainObject(input, "indexedDb");
  const metricAvailable = assertBoolean(
    input.metricAvailable,
    "indexedDb.metricAvailable",
  );
  if (!metricAvailable) {
    assertAllowedFields(input, ["metricAvailable", "reasonCode"]);
    return deepFreeze({
      metricAvailable: false,
      reasonCode: assertEnum(
        input.reasonCode,
        ["browser_metric_unavailable", "measurement_interrupted"],
        "indexedDb.reasonCode",
      ),
    });
  }
  assertAllowedFields(input, [
    "metricAvailable",
    "expectedDirection",
    "sourceCanonicalBytes",
    "usageBeforeBytes",
    "quotaBeforeBytes",
    "usageAfterBytes",
    "quotaAfterBytes",
    "cleanupUsageBytes",
    "cleanupQuotaBytes",
    "readbackVerified",
  ]);
  const expectedDirection = assertEnum(
    input.expectedDirection,
    ["increase", "decrease", "stable"],
    "indexedDb.expectedDirection",
  );
  const usageBeforeBytes = assertNonNegativeSafeInteger(
    input.usageBeforeBytes,
    "indexedDb.usageBeforeBytes",
  );
  const quotaBeforeBytes = assertPositiveSafeInteger(
    input.quotaBeforeBytes,
    "indexedDb.quotaBeforeBytes",
  );
  const usageAfterBytes = assertNonNegativeSafeInteger(
    input.usageAfterBytes,
    "indexedDb.usageAfterBytes",
  );
  const quotaAfterBytes = assertPositiveSafeInteger(
    input.quotaAfterBytes,
    "indexedDb.quotaAfterBytes",
  );
  const cleanupUsageBytes = assertNonNegativeSafeInteger(
    input.cleanupUsageBytes,
    "indexedDb.cleanupUsageBytes",
  );
  const cleanupQuotaBytes = assertPositiveSafeInteger(
    input.cleanupQuotaBytes,
    "indexedDb.cleanupQuotaBytes",
  );
  const sourceCanonicalBytes = assertPositiveSafeInteger(
    input.sourceCanonicalBytes,
    "indexedDb.sourceCanonicalBytes",
  );
  const readbackVerified = assertBoolean(
    input.readbackVerified,
    "indexedDb.readbackVerified",
  );
  const usageDeltaBytes = usageAfterBytes - usageBeforeBytes;
  const directionMatches =
    expectedDirection === "increase"
      ? usageDeltaBytes > 0
      : expectedDirection === "decrease"
        ? usageDeltaBytes < 0
        : true;
  const metricsConsistent =
    usageBeforeBytes <= quotaBeforeBytes &&
    usageAfterBytes <= quotaAfterBytes &&
    cleanupUsageBytes <= cleanupQuotaBytes &&
    directionMatches &&
    readbackVerified;
  return deepFreeze({
    metricAvailable: true,
    expectedDirection,
    sourceCanonicalBytes,
    usageBeforeBytes,
    quotaBeforeBytes,
    freeQuotaBeforeBytes: quotaBeforeBytes - usageBeforeBytes,
    usageAfterBytes,
    quotaAfterBytes,
    freeQuotaAfterBytes: quotaAfterBytes - usageAfterBytes,
    usageDeltaBytes,
    stagingAmplificationRatio:
      expectedDirection === "increase"
        ? usageDeltaBytes / sourceCanonicalBytes
        : null,
    temporaryOverheadBytes:
      expectedDirection === "increase"
        ? Math.max(0, usageDeltaBytes - sourceCanonicalBytes)
        : null,
    cleanupUsageBytes,
    cleanupQuotaBytes,
    cleanupFreeQuotaBytes: cleanupQuotaBytes - cleanupUsageBytes,
    readbackVerified,
    metricsConsistent,
  });
}

function validateAssertions(input) {
  assertPlainObject(input, "assertions");
  assertAllowedFields(input, ASSERTION_FIELDS);
  return deepFreeze(
    Object.fromEntries(
      ASSERTION_FIELDS.map((field) => [
        field,
        assertBoolean(input[field], `assertions.${field}`),
      ]),
    ),
  );
}

function calculateProgressMetrics(offsets, totalDurationMs) {
  if (offsets.length === 0) {
    return { firstLatencyMs: null, maximumGapMs: null };
  }
  const gaps = [offsets[0]];
  for (let index = 1; index < offsets.length; index += 1) {
    gaps.push(offsets[index] - offsets[index - 1]);
  }
  gaps.push(totalDurationMs - offsets.at(-1));
  return {
    firstLatencyMs: offsets[0],
    maximumGapMs: Math.max(...gaps),
  };
}

function percentile(sortedValues, fraction) {
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index];
}

function assertStrictlyIncreasingOffsets(offsets, totalDurationMs) {
  let previous = -1;
  for (const offset of offsets) {
    if (offset <= previous || offset > totalDurationMs) {
      throw new Error(
        "progressEventOffsetsMs must be strictly increasing and within totalDurationMs",
      );
    }
    previous = offset;
  }
}

function validateNumberArray(value, label, { minimumLength }) {
  if (!Array.isArray(value) || value.length < minimumLength) {
    throw new Error(
      `${label} must be an array with at least ${minimumLength} item(s)`,
    );
  }
  return value.map((item, index) =>
    assertNonNegativeFiniteNumber(item, `${label}[${index}]`),
  );
}

function validateBrowserObservation(value) {
  assertPlainObject(value, "execution.browserObservation");
  assertAllowedFields(value, [
    "contract",
    "browserLaunchCount",
    "networkMetricAvailable",
    "networkRequestCount",
    "loopbackRequestCount",
    "extensionRequestCount",
    "externalRequestCount",
    "consoleMetricAvailable",
    "consoleErrorCount",
  ]);
  const observation = {
    contract: assertEnum(
      value.contract,
      ["gate-014-b1-browser-observation-v1"],
      "execution.browserObservation.contract",
    ),
    browserLaunchCount: assertPositiveSafeInteger(
      value.browserLaunchCount,
      "execution.browserObservation.browserLaunchCount",
    ),
    networkMetricAvailable: assertExactBoolean(
      value.networkMetricAvailable,
      true,
      "execution.browserObservation.networkMetricAvailable",
    ),
    networkRequestCount: assertNonNegativeSafeInteger(
      value.networkRequestCount,
      "execution.browserObservation.networkRequestCount",
    ),
    loopbackRequestCount: assertNonNegativeSafeInteger(
      value.loopbackRequestCount,
      "execution.browserObservation.loopbackRequestCount",
    ),
    extensionRequestCount: assertNonNegativeSafeInteger(
      value.extensionRequestCount,
      "execution.browserObservation.extensionRequestCount",
    ),
    externalRequestCount: assertExactInteger(
      value.externalRequestCount,
      0,
      "execution.browserObservation.externalRequestCount",
    ),
    consoleMetricAvailable: assertExactBoolean(
      value.consoleMetricAvailable,
      true,
      "execution.browserObservation.consoleMetricAvailable",
    ),
    consoleErrorCount: assertExactInteger(
      value.consoleErrorCount,
      0,
      "execution.browserObservation.consoleErrorCount",
    ),
  };
  if (
    observation.loopbackRequestCount + observation.extensionRequestCount >
    observation.networkRequestCount
  ) {
    throw new Error(
      "execution.browserObservation classified requests exceed total",
    );
  }
  return observation;
}

function assertNumberMultisetSubset(subset, superset, label) {
  const available = new Map();
  for (const value of superset) {
    available.set(value, (available.get(value) ?? 0) + 1);
  }
  for (const value of subset) {
    const remaining = available.get(value) ?? 0;
    if (remaining < 1) {
      throw new Error(`${label} must be a subset of batchDurationsMs`);
    }
    available.set(value, remaining - 1);
  }
}

function assertPublicSafeId(value, label) {
  if (typeof value !== "string" || !PUBLIC_SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a public-safe identifier`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value`);
  }
  return value;
}

function assertGitSha(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a lowercase Git commit SHA`);
  }
  return value;
}

function assertPattern(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} has an invalid format`);
  }
  return value;
}

function assertPublicSafeText(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    containsUnsafeLocalPath(value) ||
    SENSITIVE_RECEIPT_TOKEN_PATTERN.test(JSON.stringify(value))
  ) {
    throw new Error(`${label} must be public-safe text`);
  }
  return value;
}

function assertEnum(value, values, label) {
  if (!values.includes(value)) {
    throw new Error(`${label} must be one of ${values.join(", ")}`);
  }
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function assertExactBoolean(value, expected, label) {
  const actual = assertBoolean(value, label);
  if (actual !== expected) {
    throw new Error(`${label} must be ${expected}`);
  }
  return actual;
}

function assertExactInteger(value, expected, label) {
  if (!Number.isSafeInteger(value) || value !== expected) {
    throw new Error(`${label} must be ${expected}`);
  }
  return value;
}

function assertNonNegativeFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

function assertNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
}

function assertAllowedFields(value, fields) {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`unsupported field: ${field}`);
    }
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`missing required field: ${field}`);
    }
  }
}

function assertPublicSafeValue(value) {
  const serialized = JSON.stringify(value);
  if (
    containsUnsafeLocalPath(value) ||
    SENSITIVE_RECEIPT_TOKEN_PATTERN.test(serialized)
  ) {
    throw new Error("B1 receipt contains a sensitive token or path");
  }
}

function containsUnsafeLocalPath(value) {
  if (typeof value === "string") {
    return /(?:[a-z]:[\\/]|^\\\\|\/(?:users|home)\/)/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafeLocalPath);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsUnsafeLocalPath);
  }
  return false;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
