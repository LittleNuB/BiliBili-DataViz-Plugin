import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  combineBrowserExecutionObservations,
  createB1TemporaryProfile,
  readChromeForTestingMetadata,
  removeB1TemporaryProfile,
  runBrowserFixtureLifecycleWithPreparedFixture,
  validateBrowserExecutionObservation,
} from "./gate-014-b1-browser-runner.mjs";
import {
  FIXTURE_DEFINITIONS,
  GENERATOR_VERSION,
  cleanupGeneratedFixtureArtifacts,
  verifyGoldenFixtureReceipts,
  writeFixtureArtifact,
} from "./gate-014-fixture-generator.mjs";

import {
  B1_BYTE_CAPS,
  B1_OPERATION_KINDS,
  B1_RECORD_CAPS,
  B1_REQUIRED_FIXTURE_IDS,
  B1_RUN_COUNTS,
  createB1EnvironmentReceipt,
  createB1OperationReceipt,
  createB1RestorePreflightValidationReceipt,
  evaluateB1Report,
  hashB1EnvironmentReceipt,
  serializeB1EnvironmentReceipt,
  serializeB1Report,
} from "./gate-014-b1-receipt.mjs";

const execFile = promisify(execFileCallback);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const CHECKPOINT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "tests",
  "fixtures",
  "gate-014",
  "b1-runs",
);
const REPORT_DIRECTORY = path.join(REPOSITORY_ROOT, "docs", "benchmarks");
const ENVIRONMENT_REPORT_PATH = path.join(
  REPORT_DIRECTORY,
  "gate-014-b1-environment.json",
);
const RAW_OPERATIONS_REPORT_PATH = path.join(
  REPORT_DIRECTORY,
  "gate-014-b1-raw-operations.jsonl",
);
const REPORT_PATH = path.join(REPORT_DIRECTORY, "gate-014-b1-report.json");
const SUMMARY_PATH = path.join(REPORT_DIRECTORY, "gate-014-b1-summary.md");
const SESSION_PATH = path.join(CHECKPOINT_DIRECTORY, "session.json");
const CHECKPOINT_ENVIRONMENT_SHA = "0".repeat(64);
const FIXTURE_EXECUTION_ORDER = Object.freeze([
  "high-fragmentation-pathological",
  "single-version-64mib",
  "managed-full-text-100mib",
  "managed-full-text-400mib",
  "managed-full-text-500mib",
]);
const BENCHMARK_SOURCE_FILES = Object.freeze([
  "package.json",
  "scripts/gate-014-b1-browser-runner.mjs",
  "scripts/gate-014-b1-matrix-runner.mjs",
  "scripts/gate-014-b1-receipt.mjs",
  "scripts/gate-014-fixture-generator.mjs",
  "scripts/gate-014-receipt-helpers.mjs",
  "tests/fixtures/gate-014/b1-extension/manifest.json",
  "tests/fixtures/gate-014/b1-extension/runner.html",
  "tests/fixtures/gate-014/b1-extension/runner.js",
  "tests/fixtures/gate-014/b1-extension/restore-preflight.js",
  "tests/fixtures/gate-014/b1-extension/service-worker.js",
  "tests/fixtures/gate-014/b1-extension/storage-harness.js",
  "docs/development-plan-0.14.md",
  "docs/benchmarks/gate-014-b1-runbook.md",
  "docs/architecture/gate-contract-0.14-storage-search-and-backup.md",
  "docs/adr/0090-run-the-synthetic-storage-baseline-before-calibration.md",
  "docs/qa-0.14-integration-matrix.md",
  "tests/fixtures/gate-014/receipts/managed-full-text-100mib.receipt.json",
  "tests/fixtures/gate-014/receipts/managed-full-text-400mib.receipt.json",
  "tests/fixtures/gate-014/receipts/managed-full-text-500mib.receipt.json",
  "tests/fixtures/gate-014/receipts/single-version-64mib.receipt.json",
  "tests/fixtures/gate-014/receipts/high-fragmentation-pathological.receipt.json",
]);
const PRODUCTION_SOURCE_DIRECTORIES = Object.freeze([
  "src",
  "public",
  "dashboard",
  "popup",
  "third_party",
]);
const PRODUCTION_SOURCE_FILES = Object.freeze([
  "vite.config.ts",
  "vite.sidebar-card.config.ts",
  "vite.player-monitor.config.ts",
  "tsconfig.json",
  "scripts/copy-release-licenses.mjs",
  "scripts/verify-release-dist.mjs",
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  "package.json",
]);
const PRODUCTION_BUILD_TIMEOUT_MS = 30 * 60 * 1_000;

export function mapB1LifecycleToRawOperations(lifecycle, metadata) {
  assertPlainObject(lifecycle, "lifecycle");
  assertPlainObject(metadata, "metadata");
  const fixtureReceiptSha256 = assertSha256(
    metadata.fixtureReceiptSha256,
    "fixtureReceiptSha256",
  );
  const environmentReceiptSha256 = assertSha256(
    metadata.environmentReceiptSha256,
    "environmentReceiptSha256",
  );
  const runMode = assertEnum(metadata.runMode, ["cold", "warm"], "runMode");
  const runOrdinal = assertPositiveSafeInteger(
    metadata.runOrdinal,
    "runOrdinal",
  );
  if (
    !Array.isArray(lifecycle.operations) ||
    lifecycle.operations.length !== B1_OPERATION_KINDS.length
  ) {
    throw new Error("lifecycle operation count is incomplete");
  }
  if (
    !Number.isSafeInteger(lifecycle.sourceCanonicalBytes) ||
    lifecycle.sourceCanonicalBytes < 1
  ) {
    throw new Error("lifecycle sourceCanonicalBytes is invalid");
  }
  assertPlainObject(lifecycle.candidate, "lifecycle.candidate");
  assertPlainObject(lifecycle.assertions, "lifecycle.assertions");
  assertPlainObject(
    lifecycle.finalCleanupStorage,
    "lifecycle.finalCleanupStorage",
  );
  const operationKinds = lifecycle.operations
    .map((operation) => operation?.operation)
    .sort();
  if (operationKinds.join("|") !== [...B1_OPERATION_KINDS].sort().join("|")) {
    throw new Error("lifecycle operation set is invalid");
  }

  const rawOperations = lifecycle.operations.map((operation) => {
    assertPlainObject(
      operation,
      `operation.${operation?.operation ?? "unknown"}`,
    );
    const rawOperation = {
      fixtureId: lifecycle.fixtureId,
      fixtureReceiptSha256,
      environmentReceiptSha256,
      candidate: { ...lifecycle.candidate },
      runMode,
      runOrdinal,
      operation: operation.operation,
      totalDurationMs: operation.totalDurationMs,
      committedBatchCount: operation.committedBatchCount,
      committedBatchDurationsMs: [...operation.committedBatchDurationsMs],
      readBatchDurationsMs: [...operation.readBatchDurationsMs],
      readTimingEvidence: { ...operation.readTimingEvidence },
      batchDurationsMs: [...operation.batchDurationsMs],
      progressEventOffsetsMs: [...operation.progressEventOffsetsMs],
      restart: { ...operation.restart },
      cancellation: { ...operation.cancellation },
      mainThread: { ...operation.mainThread },
      memory: { ...operation.memory },
      indexedDb: mapIndexedDbMeasurement(
        operation,
        lifecycle.finalCleanupStorage,
        lifecycle.sourceCanonicalBytes,
      ),
      assertions: { ...lifecycle.assertions },
    };
    createB1OperationReceipt(rawOperation);
    return rawOperation;
  });
  return Object.freeze(
    rawOperations.map((operation) => Object.freeze(operation)),
  );
}

export async function runB1Matrix(options = {}) {
  const invocationStartedAtEpochMs = Date.now();
  const chromePath = path.resolve(options.chromePath ?? "");
  if (!options.chromePath) {
    throw new Error("GATE_014_B1_CHROME_PATH is required");
  }
  await access(chromePath);
  const cftMetadataPath = path.resolve(
    options.cftMetadataPath ?? process.env.GATE_014_B1_CFT_METADATA_PATH ?? "",
  );
  if (!options.cftMetadataPath && !process.env.GATE_014_B1_CFT_METADATA_PATH) {
    throw new Error("GATE_014_B1_CFT_METADATA_PATH is required");
  }
  await access(cftMetadataPath);
  await assertWorktreeClean();
  await assertProductionSourceInputsTracked();
  await buildProductionDist();
  const maxNewRuns =
    options.maxNewRuns === undefined
      ? Number.POSITIVE_INFINITY
      : assertPositiveSafeInteger(options.maxNewRuns, "maxNewRuns");
  const environmentCore = await collectEnvironmentCore(
    chromePath,
    cftMetadataPath,
  );
  const environmentFingerprintSha256 = sha256Text(
    stableStringify(environmentCore),
  );
  const freeDiskBytesAtStart = await readFreeDiskBytes();
  const session = await openOrCreateSession(
    environmentFingerprintSha256,
    freeDiskBytesAtStart,
    invocationStartedAtEpochMs,
  );
  const fixtureReceipts = Object.fromEntries(
    Object.entries(session.fixtureReceipts).map(([fixtureId, receipt]) => [
      fixtureId,
      receipt.receiptSha256,
    ]),
  );
  const fixtureReceiptDetails = new Map(
    Object.entries(session.fixtureReceipts),
  );
  const expectedSpecs = createExpectedRunSpecs();
  const checkpoints = await loadCheckpoints(
    expectedSpecs,
    environmentFingerprintSha256,
    fixtureReceipts,
  );
  let newRunCount = 0;
  let paused = false;

  const recordRun = async (preparedFixture, profile, spec) => {
    const lifecycle = await runBrowserFixtureLifecycleWithPreparedFixture({
      chromePath,
      cftMetadataPath,
      fixtureId: spec.fixtureId,
      recordCap: spec.candidate.recordCap,
      byteCapBytes: spec.candidate.byteCapBytes,
      preparedFixture,
      profile,
      runMode: spec.runMode,
    });
    const rawOperations = mapB1LifecycleToRawOperations(lifecycle, {
      fixtureReceiptSha256: fixtureReceipts[spec.fixtureId],
      environmentReceiptSha256: CHECKPOINT_ENVIRONMENT_SHA,
      runMode: spec.runMode,
      runOrdinal: spec.runOrdinal,
    });
    const checkpoint = {
      contract: "gate-014-b1-run-checkpoint-v1",
      environmentFingerprintSha256,
      fixtureId: spec.fixtureId,
      fixtureReceiptSha256: fixtureReceipts[spec.fixtureId],
      candidate: { ...spec.candidate },
      runMode: spec.runMode,
      runOrdinal: spec.runOrdinal,
      rawOperations,
      browserObservation: lifecycle.executionObservation,
      storesSensitiveText: false,
    };
    validateCheckpoint(
      checkpoint,
      spec,
      environmentFingerprintSha256,
      fixtureReceipts,
    );
    await writeCheckpoint(spec, checkpoint);
    checkpoints.set(runIdentity(spec), checkpoint);
    newRunCount += 1;
    process.stdout.write(
      `${JSON.stringify({
        event: "gate014_b1_run_complete",
        completedRunCount: checkpoints.size,
        expectedRunCount: expectedSpecs.length,
        fixtureId: spec.fixtureId,
        recordCap: spec.candidate.recordCap,
        byteCapBytes: spec.candidate.byteCapBytes,
        runMode: spec.runMode,
        runOrdinal: spec.runOrdinal,
      })}\n`,
    );
    if (newRunCount >= maxNewRuns) {
      throw new MatrixPause();
    }
  };

  try {
    for (const fixtureId of FIXTURE_EXECUTION_ORDER) {
      const definition = FIXTURE_DEFINITIONS.find(
        (candidate) => candidate.id === fixtureId,
      );
      const golden = fixtureReceiptDetails.get(fixtureId);
      if (!definition || !golden) {
        throw new Error(`fixture receipt unavailable: ${fixtureId}`);
      }
      await cleanupGeneratedFixtureArtifacts({
        repositoryRoot: REPOSITORY_ROOT,
      });
      const preparedFixture = await writeFixtureArtifact(definition, {
        repositoryRoot: REPOSITORY_ROOT,
      });
      if (
        preparedFixture.artifactSha256 !== golden.fixtureSha256 ||
        preparedFixture.receipt.canonical.totalBytes !== golden.canonicalBytes
      ) {
        throw new Error(`generated fixture drift detected: ${fixtureId}`);
      }
      try {
        for (const candidate of createCandidateOrder()) {
          const candidateSpecs = [
            ...Array.from({ length: B1_RUN_COUNTS.cold }, (_, index) => ({
              fixtureId,
              candidate,
              runMode: "cold",
              runOrdinal: index + 1,
            })),
            ...Array.from({ length: B1_RUN_COUNTS.warm }, (_, index) => ({
              fixtureId,
              candidate,
              runMode: "warm",
              runOrdinal: index + 1,
            })),
          ];
          for (const spec of candidateSpecs) {
            if (checkpoints.has(runIdentity(spec))) {
              continue;
            }
            const profile = await createB1TemporaryProfile();
            try {
              await recordRun(preparedFixture, profile, spec);
            } finally {
              await removeB1TemporaryProfile(profile);
            }
          }
        }
      } finally {
        await cleanupGeneratedFixtureArtifacts({
          repositoryRoot: REPOSITORY_ROOT,
        });
      }
    }
  } catch (error) {
    if (error instanceof MatrixPause) {
      paused = true;
    } else {
      throw error;
    }
  } finally {
    await cleanupGeneratedFixtureArtifacts({ repositoryRoot: REPOSITORY_ROOT });
  }

  if (paused || checkpoints.size !== expectedSpecs.length) {
    return Object.freeze({
      status: "paused",
      completedRunCount: checkpoints.size,
      expectedRunCount: expectedSpecs.length,
      newRunCount,
    });
  }

  const matrixBrowserObservation = combineBrowserExecutionObservations(
    [...checkpoints.values()].map(
      (checkpoint) => checkpoint.browserObservation,
    ),
  );
  const preliminaryEnvironmentInput = buildEnvironmentInput(environmentCore, {
    startedAtEpochMs: session.startedAtEpochMs,
    completedAtEpochMs: Date.now(),
    freeDiskBytesAtStart: session.freeDiskBytesAtStart,
    freeDiskBytesAtEnd: await readFreeDiskBytes(),
    browserObservation: matrixBrowserObservation,
  });
  const preliminaryEnvironment = createB1EnvironmentReceipt(
    preliminaryEnvironmentInput,
  );
  const preliminaryEnvironmentReceiptSha256 = hashB1EnvironmentReceipt(
    preliminaryEnvironment,
  );
  const preliminaryRawOperations = expectedSpecs.flatMap((spec) => {
    const checkpoint = checkpoints.get(runIdentity(spec));
    return checkpoint.rawOperations.map((operation) => ({
      ...operation,
      environmentReceiptSha256: preliminaryEnvironmentReceiptSha256,
    }));
  });
  for (const operation of preliminaryRawOperations) {
    createB1OperationReceipt(operation);
  }
  const preliminaryReportInput = {
    environment: preliminaryEnvironmentInput,
    environmentReceiptSha256: preliminaryEnvironmentReceiptSha256,
    fixtureReceipts,
    rawOperations: preliminaryRawOperations,
  };
  const preliminaryReport = evaluateB1Report({
    ...preliminaryReportInput,
    restorePreflightValidation: null,
  });
  const provisionalCandidate = preliminaryReport.candidates
    .filter((candidate) => candidate.status === "pass")
    .sort(
      (left, right) =>
        right.recordCap - left.recordCap ||
        right.byteCapBytes - left.byteCapBytes,
    )[0];
  const requiredFreeQuotaBytes =
    preliminaryReport.provisionalRestoreHeadroom.nearLimitProbe
      ?.requiredFreeQuotaBytes;
  const restorePreflightRun =
    provisionalCandidate &&
    Number.isSafeInteger(requiredFreeQuotaBytes) &&
    preliminaryReport.provisionalRestoreHeadroom.allMeasuredRunsAllowed === true
      ? await runDerivedRestorePreflightValidation({
          chromePath,
          cftMetadataPath,
          environmentReceiptSha256: preliminaryEnvironmentReceiptSha256,
          fixtureReceiptDetails,
          fixtureReceipts,
          candidate: provisionalCandidate,
          requiredFreeQuotaBytes,
        })
      : null;
  const finalBrowserObservation = restorePreflightRun
    ? combineBrowserExecutionObservations(
        matrixBrowserObservation,
        restorePreflightRun.browserObservation,
      )
    : matrixBrowserObservation;
  const environmentInput = buildEnvironmentInput(environmentCore, {
    startedAtEpochMs: session.startedAtEpochMs,
    completedAtEpochMs: Date.now(),
    freeDiskBytesAtStart: session.freeDiskBytesAtStart,
    freeDiskBytesAtEnd: await readFreeDiskBytes(),
    browserObservation: finalBrowserObservation,
  });
  const environment = createB1EnvironmentReceipt(environmentInput);
  const environmentReceiptSha256 = hashB1EnvironmentReceipt(environment);
  const rawOperations = preliminaryRawOperations.map((operation) => ({
    ...operation,
    environmentReceiptSha256,
  }));
  const finalRestorePreflightValidation = restorePreflightRun
    ? rebindRestorePreflightValidation(
        restorePreflightRun.receipt,
        environmentReceiptSha256,
      )
    : null;
  const report = evaluateB1Report({
    environment: environmentInput,
    environmentReceiptSha256,
    fixtureReceipts,
    rawOperations,
    restorePreflightValidation: finalRestorePreflightValidation,
  });
  await writeFinalArtifacts({ environment, rawOperations, report });
  return Object.freeze({
    status: report.status,
    selectedCandidate: report.selectedCandidate,
    completedRunCount: checkpoints.size,
    expectedRunCount: expectedSpecs.length,
    environmentReceiptSha256,
    reportPath: path
      .relative(REPOSITORY_ROOT, REPORT_PATH)
      .replaceAll("\\", "/"),
  });
}

function rebindRestorePreflightValidation(receipt, environmentReceiptSha256) {
  const {
    contract,
    status,
    storesSensitiveText,
    failures,
    insufficientEvidence,
    ...source
  } = receipt;
  return createB1RestorePreflightValidationReceipt({
    ...source,
    environmentReceiptSha256,
  });
}

async function runDerivedRestorePreflightValidation(options) {
  const fixtureId = "managed-full-text-500mib";
  const definition = FIXTURE_DEFINITIONS.find(
    (candidate) => candidate.id === fixtureId,
  );
  const golden = options.fixtureReceiptDetails.get(fixtureId);
  if (!definition || !golden) {
    throw new Error("restore preflight validation fixture unavailable");
  }
  await cleanupGeneratedFixtureArtifacts({ repositoryRoot: REPOSITORY_ROOT });
  const preparedFixture = await writeFixtureArtifact(definition, {
    repositoryRoot: REPOSITORY_ROOT,
  });
  if (
    preparedFixture.artifactSha256 !== golden.fixtureSha256 ||
    preparedFixture.receipt.canonical.totalBytes !== golden.canonicalBytes
  ) {
    throw new Error("restore preflight validation fixture drift detected");
  }
  const profile = await createB1TemporaryProfile();
  const startedAtEpochMs = Date.now();
  try {
    const lifecycle = await runBrowserFixtureLifecycleWithPreparedFixture({
      chromePath: options.chromePath,
      cftMetadataPath: options.cftMetadataPath,
      fixtureId,
      recordCap: options.candidate.recordCap,
      byteCapBytes: options.candidate.byteCapBytes,
      preparedFixture,
      profile,
      runMode: "cold",
      restorePreflightRequiredFreeQuotaBytes: options.requiredFreeQuotaBytes,
    });
    return Object.freeze({
      receipt: createB1RestorePreflightValidationFromLifecycle(lifecycle, {
        fixtureId,
        fixtureReceiptSha256: options.fixtureReceipts[fixtureId],
        environmentReceiptSha256: options.environmentReceiptSha256,
        candidate: options.candidate,
        startedAtEpochMs,
        completedAtEpochMs: Date.now(),
        requiredFreeQuotaBytes: options.requiredFreeQuotaBytes,
      }),
      browserObservation: lifecycle.executionObservation,
    });
  } finally {
    await removeB1TemporaryProfile(profile);
    await cleanupGeneratedFixtureArtifacts({ repositoryRoot: REPOSITORY_ROOT });
  }
}

export function createB1RestorePreflightValidationFromLifecycle(
  lifecycle,
  options,
) {
  if (lifecycle.status !== "pass" || lifecycle.readbackVerified !== true) {
    throw new Error("restore preflight validation lifecycle failed");
  }
  const restore = lifecycle.operations.find(
    (operation) => operation.operation === "restore_staging",
  );
  const quotaFailure = lifecycle.operations.find(
    (operation) => operation.operation === "quota_failure",
  );
  const exactEvidence = restore?.detail?.restorePreflightEvidence;
  const refusalEvidence = quotaFailure?.detail;
  return createB1RestorePreflightValidationReceipt({
    ...options,
    physicalQuota: Number.isSafeInteger(
      exactEvidence?.measuredAvailableFreeQuotaBytes,
    )
      ? {
          metricAvailable: true,
          availableFreeQuotaBytes:
            exactEvidence.measuredAvailableFreeQuotaBytes,
        }
      : {
          metricAvailable: false,
          reasonCode: "browser_metric_unavailable",
        },
    insufficientProbe: {
      availableFreeQuotaBytes: refusalEvidence?.availableBytes,
      requiredFreeQuotaBytes: refusalEvidence?.requestedBytes,
      allowed: refusalEvidence?.refusedBeforeWrite !== true,
      artifactFetchAttempted: refusalEvidence?.artifactFetchAttempted ?? true,
      writesObserved: refusalEvidence?.writesObserved,
    },
    exactProbe: {
      availableFreeQuotaBytes:
        exactEvidence?.exactBoundaryAvailableFreeQuotaBytes,
      requiredFreeQuotaBytes: exactEvidence?.requiredFreeQuotaBytes,
      allowed: exactEvidence?.exactBoundaryAllowed ?? false,
      artifactFetchAttempted: exactEvidence?.artifactFetchAttempted ?? false,
      writesObserved:
        (restore?.detail?.receivedRecordCount ?? 0) +
        (restore?.detail?.visibleRead?.versionCount ?? 0),
      writeReadbackVerified:
        restore?.readbackVerified === true &&
        lifecycle.assertions?.committedRowsVisibleTogether === true,
    },
    cleanupReadbackVerified:
      lifecycle.assertions?.cleanupReadbackVerified === true,
  });
}

function createCandidateOrder() {
  return B1_RECORD_CAPS.flatMap((recordCap) =>
    B1_BYTE_CAPS.map((byteCapBytes) => ({ recordCap, byteCapBytes })),
  ).sort(
    (left, right) =>
      right.recordCap - left.recordCap ||
      right.byteCapBytes - left.byteCapBytes,
  );
}

function createExpectedRunSpecs() {
  const specs = [];
  for (const fixtureId of B1_REQUIRED_FIXTURE_IDS) {
    for (const candidate of createCandidateOrder()) {
      for (const [runMode, count] of Object.entries(B1_RUN_COUNTS)) {
        for (let runOrdinal = 1; runOrdinal <= count; runOrdinal += 1) {
          specs.push({ fixtureId, candidate, runMode, runOrdinal });
        }
      }
    }
  }
  return specs;
}

class MatrixPause extends Error {}

async function collectEnvironmentCore(chromePath, cftMetadataPath) {
  await access(path.join(REPOSITORY_ROOT, "dist", "manifest.json"));
  const [{ stdout: commitStdout }, browser] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], {
      cwd: REPOSITORY_ROOT,
      windowsHide: true,
    }),
    readChromeForTestingMetadata(chromePath, cftMetadataPath),
  ]);
  const repositoryCommitSha = commitStdout.trim();
  if (!/^[a-f0-9]{40}$/.test(repositoryCommitSha)) {
    throw new Error("repository commit SHA unavailable");
  }
  const cpuModel = os.cpus()[0]?.model?.trim();
  if (!cpuModel) {
    throw new Error("CPU model unavailable");
  }
  return {
    repositoryCommitSha,
    benchmarkSourceSha256: await hashKnownFiles(BENCHMARK_SOURCE_FILES),
    productionSourceSha256: await hashProductionSourceInputs(),
    packageLockSha256: await hashFile(
      path.join(REPOSITORY_ROOT, "package-lock.json"),
    ),
    productionDistSha256: await hashDirectory(
      path.join(REPOSITORY_ROOT, "dist"),
    ),
    fixtureGeneratorVersion: GENERATOR_VERSION,
    operatingSystem: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
    },
    hardware: {
      cpuModel,
      logicalCoreCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    runtime: { nodeVersion: process.version },
    browser,
    execution: {
      commandId: "gate014_b1_full_matrix",
      productionBuildCommand: "npm_run_build",
      productionExtensionMode: "unpacked",
      networkPolicy: "loopback_only_external_dns_blocked",
      coldProfilePolicy: "fresh_temporary_profile_per_run",
      warmProfilePolicy:
        "opened_complete_seed_generation_with_fresh_profile_per_run",
      coldRunsPerCandidateFixture: B1_RUN_COUNTS.cold,
      warmRunsPerCandidateFixture: B1_RUN_COUNTS.warm,
      externalNetworkDependencyUsed: false,
      realUserProfileRead: false,
      bilibiliLoginUsed: false,
    },
    a2CalibrationStatus: "insufficient_evidence",
    storesSensitiveText: false,
  };
}

function buildEnvironmentInput(environmentCore, run) {
  return {
    startedAtEpochMs: run.startedAtEpochMs,
    completedAtEpochMs: run.completedAtEpochMs,
    repositoryCommitSha: environmentCore.repositoryCommitSha,
    benchmarkSourceSha256: environmentCore.benchmarkSourceSha256,
    productionSourceSha256: environmentCore.productionSourceSha256,
    packageLockSha256: environmentCore.packageLockSha256,
    productionDistSha256: environmentCore.productionDistSha256,
    fixtureGeneratorVersion: environmentCore.fixtureGeneratorVersion,
    operatingSystem: { ...environmentCore.operatingSystem },
    hardware: {
      ...environmentCore.hardware,
      freeDiskBytesAtStart: run.freeDiskBytesAtStart,
      freeDiskBytesAtEnd: run.freeDiskBytesAtEnd,
    },
    runtime: { ...environmentCore.runtime },
    browser: { ...environmentCore.browser },
    execution: {
      ...environmentCore.execution,
      browserObservation: validateBrowserExecutionObservation(
        run.browserObservation,
      ),
    },
    a2CalibrationStatus: environmentCore.a2CalibrationStatus,
    storesSensitiveText: false,
  };
}

async function openOrCreateSession(
  environmentFingerprintSha256,
  freeDiskBytesAtStart,
  invocationStartedAtEpochMs,
) {
  await mkdir(CHECKPOINT_DIRECTORY, { recursive: true });
  try {
    const session = JSON.parse(await readFile(SESSION_PATH, "utf8"));
    assertExactFields(
      session,
      [
        "contract",
        "environmentFingerprintSha256",
        "startedAtEpochMs",
        "freeDiskBytesAtStart",
        "fixtureReceipts",
        "storesSensitiveText",
      ],
      "session",
    );
    if (
      session.contract !== "gate-014-b1-run-session-v1" ||
      session.environmentFingerprintSha256 !== environmentFingerprintSha256 ||
      !Number.isSafeInteger(session.startedAtEpochMs) ||
      !Number.isSafeInteger(session.freeDiskBytesAtStart) ||
      !validateSessionFixtureReceipts(session.fixtureReceipts) ||
      session.storesSensitiveText !== false
    ) {
      throw new Error(
        "B1 checkpoint environment changed; clean checkpoints before rerun",
      );
    }
    return session;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const verification = await verifyGoldenFixtureReceipts({
    repositoryRoot: REPOSITORY_ROOT,
  });
  const fixtureReceipts = Object.fromEntries(
    verification.receipts.map((receipt) => [
      receipt.fixtureId,
      {
        receiptSha256: receipt.receiptSha256,
        fixtureSha256: receipt.fixtureSha256,
        canonicalBytes: receipt.canonicalBytes,
      },
    ]),
  );
  const session = {
    contract: "gate-014-b1-run-session-v1",
    environmentFingerprintSha256,
    startedAtEpochMs: invocationStartedAtEpochMs,
    freeDiskBytesAtStart,
    fixtureReceipts,
    storesSensitiveText: false,
  };
  await writeNewAtomic(SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`);
  return session;
}

function validateSessionFixtureReceipts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (
    Object.keys(value).sort().join("|") !==
    [...B1_REQUIRED_FIXTURE_IDS].sort().join("|")
  ) {
    return false;
  }
  return B1_REQUIRED_FIXTURE_IDS.every((fixtureId) => {
    const receipt = value[fixtureId];
    return (
      receipt &&
      typeof receipt === "object" &&
      Object.keys(receipt).sort().join("|") ===
        ["canonicalBytes", "fixtureSha256", "receiptSha256"].sort().join("|") &&
      /^[a-f0-9]{64}$/.test(receipt.receiptSha256) &&
      /^[a-f0-9]{64}$/.test(receipt.fixtureSha256) &&
      Number.isSafeInteger(receipt.canonicalBytes) &&
      receipt.canonicalBytes > 0
    );
  });
}

async function loadCheckpoints(
  expectedSpecs,
  environmentFingerprintSha256,
  fixtureReceipts,
) {
  const expectedByIdentity = new Map(
    expectedSpecs.map((spec) => [runIdentity(spec), spec]),
  );
  const checkpoints = new Map();
  const entries = await readdir(CHECKPOINT_DIRECTORY, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".checkpoint.json")) {
      continue;
    }
    const checkpoint = JSON.parse(
      await readFile(path.join(CHECKPOINT_DIRECTORY, entry.name), "utf8"),
    );
    const identity = runIdentity(checkpoint);
    const spec = expectedByIdentity.get(identity);
    if (!spec || checkpoints.has(identity)) {
      throw new Error("unexpected or duplicate B1 checkpoint");
    }
    validateCheckpoint(
      checkpoint,
      spec,
      environmentFingerprintSha256,
      fixtureReceipts,
    );
    checkpoints.set(identity, checkpoint);
  }
  return checkpoints;
}

function validateCheckpoint(
  checkpoint,
  spec,
  environmentFingerprintSha256,
  fixtureReceipts,
) {
  assertPlainObject(checkpoint, "checkpoint");
  assertExactFields(
    checkpoint,
    [
      "contract",
      "environmentFingerprintSha256",
      "fixtureId",
      "fixtureReceiptSha256",
      "candidate",
      "runMode",
      "runOrdinal",
      "rawOperations",
      "browserObservation",
      "storesSensitiveText",
    ],
    "checkpoint",
  );
  try {
    validateBrowserExecutionObservation(checkpoint.browserObservation);
  } catch {
    throw new Error("B1 checkpoint browser observation mismatch");
  }
  if (
    checkpoint.contract !== "gate-014-b1-run-checkpoint-v1" ||
    checkpoint.environmentFingerprintSha256 !== environmentFingerprintSha256 ||
    checkpoint.fixtureId !== spec.fixtureId ||
    checkpoint.fixtureReceiptSha256 !== fixtureReceipts[spec.fixtureId] ||
    checkpoint.candidate?.recordCap !== spec.candidate.recordCap ||
    checkpoint.candidate?.byteCapBytes !== spec.candidate.byteCapBytes ||
    checkpoint.runMode !== spec.runMode ||
    checkpoint.runOrdinal !== spec.runOrdinal ||
    checkpoint.storesSensitiveText !== false ||
    !Array.isArray(checkpoint.rawOperations) ||
    checkpoint.rawOperations.length !== B1_OPERATION_KINDS.length
  ) {
    throw new Error("B1 checkpoint metadata mismatch");
  }
  const seen = new Set();
  for (const operation of checkpoint.rawOperations) {
    const receipt = createB1OperationReceipt(operation);
    if (
      receipt.fixtureId !== spec.fixtureId ||
      receipt.fixtureReceiptSha256 !== fixtureReceipts[spec.fixtureId] ||
      receipt.environmentReceiptSha256 !== CHECKPOINT_ENVIRONMENT_SHA ||
      receipt.candidate.recordCap !== spec.candidate.recordCap ||
      receipt.candidate.byteCapBytes !== spec.candidate.byteCapBytes ||
      receipt.runMode !== spec.runMode ||
      receipt.runOrdinal !== spec.runOrdinal ||
      seen.has(receipt.operation)
    ) {
      throw new Error("B1 checkpoint operation mismatch");
    }
    seen.add(receipt.operation);
  }
  if (seen.size !== B1_OPERATION_KINDS.length) {
    throw new Error("B1 checkpoint operation coverage incomplete");
  }
}

async function writeCheckpoint(spec, checkpoint) {
  const target = path.join(CHECKPOINT_DIRECTORY, checkpointFileName(spec));
  await writeNewAtomic(target, `${JSON.stringify(checkpoint)}\n`);
}

function checkpointFileName(spec) {
  return (
    [
      spec.fixtureId,
      `r${spec.candidate.recordCap}`,
      `b${spec.candidate.byteCapBytes}`,
      spec.runMode,
      spec.runOrdinal,
    ].join("__") + ".checkpoint.json"
  );
}

function runIdentity(spec) {
  return [
    spec.fixtureId,
    spec.candidate?.recordCap,
    spec.candidate?.byteCapBytes,
    spec.runMode,
    spec.runOrdinal,
  ].join(":");
}

async function writeFinalArtifacts({ environment, rawOperations, report }) {
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const rawOperationsText = `${rawOperations.map((operation) => JSON.stringify(operation)).join("\n")}\n`;
  await writeArtifactBundleAtomic([
    [ENVIRONMENT_REPORT_PATH, serializeB1EnvironmentReceipt(environment)],
    [RAW_OPERATIONS_REPORT_PATH, rawOperationsText],
    [REPORT_PATH, serializeB1Report(report)],
    [SUMMARY_PATH, createSummaryMarkdown(report)],
  ]);
}

function createSummaryMarkdown(report) {
  const selected = report.selectedCandidate
    ? `${report.selectedCandidate.recordCap} 条 / ${report.selectedCandidate.byteCapBytes / 1024 / 1024} MiB`
    : "不可用";
  const headroom = report.provisionalRestoreHeadroom;
  return (
    `# GATE-014-B1 合成存储基线\n\n` +
    `- 门禁状态：\`${report.status}\`\n` +
    `- 证据范围：仅确定性、公开安全的合成夹具\n` +
    `- 覆盖：${report.coverage.measuredOperationCount}/${report.coverage.expectedOperationCount} 项操作收据\n` +
    `- 重复运行汇总：${report.coverage.runSummaryCount} 组（候选 / 夹具 / 操作 / 冷暖）\n` +
    `- 选中候选：${selected}\n` +
    `- 暂定恢复空间倍率：${headroom.provisionalMultiplier ?? "不可用"}\n` +
    `- 固定恢复预留：${headroom.fixedReserveBytes ?? "不可用"} 字节\n` +
    `- 浏览器恢复边界实写：${headroom.browserValidationVerified === true ? "通过" : "证据不足"}\n` +
    `- Chrome for Testing：${report.environment.browser.version} stable，headless=new，沙箱开启\n` +
    `- A2 校准：\`insufficient_evidence\`\n` +
    `- 真实 B 站字幕代表性：\`insufficient_evidence\`\n` +
    `- 最大实测分片尾部：\`insufficient_evidence\`\n\n` +
    `本报告不能证明真实用户分位数、平台级容量或最终运行参数。\n`
  );
}

export async function verifyB1ReportArtifacts() {
  const [environmentText, rawText, reportText, summaryText] = await Promise.all(
    [
      readFile(ENVIRONMENT_REPORT_PATH, "utf8"),
      readFile(RAW_OPERATIONS_REPORT_PATH, "utf8"),
      readFile(REPORT_PATH, "utf8"),
      readFile(SUMMARY_PATH, "utf8"),
    ],
  );
  const environment = JSON.parse(environmentText);
  const { contract, ...environmentInput } = environment;
  if (contract !== "gate-014-b1-environment-v1") {
    throw new Error("B1 environment artifact contract mismatch");
  }
  const validatedEnvironment = createB1EnvironmentReceipt(environmentInput);
  if (serializeB1EnvironmentReceipt(validatedEnvironment) !== environmentText) {
    throw new Error("B1 environment artifact serialization mismatch");
  }
  const environmentReceiptSha256 =
    hashB1EnvironmentReceipt(validatedEnvironment);
  await verifyCurrentArtifactBindings(validatedEnvironment);
  const rawOperations = rawText
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const canonicalRawText = `${rawOperations.map((operation) => JSON.stringify(operation)).join("\n")}\n`;
  if (canonicalRawText !== rawText) {
    throw new Error("B1 raw operation artifact serialization mismatch");
  }
  const committedReport = JSON.parse(reportText);
  const goldenVerification = await verifyGoldenFixtureReceipts({
    repositoryRoot: REPOSITORY_ROOT,
  });
  const currentFixtureReceipts = Object.fromEntries(
    goldenVerification.receipts.map((receipt) => [
      receipt.fixtureId,
      receipt.receiptSha256,
    ]),
  );
  if (
    stableStringify(currentFixtureReceipts) !==
    stableStringify(committedReport.fixtureReceipts)
  ) {
    throw new Error("B1 fixture receipt binding mismatch");
  }
  const evaluated = evaluateB1Report({
    environment: environmentInput,
    environmentReceiptSha256,
    fixtureReceipts: committedReport.fixtureReceipts,
    rawOperations,
    restorePreflightValidation: committedReport.restorePreflightValidation,
  });
  if (serializeB1Report(evaluated) !== reportText) {
    throw new Error("B1 report artifact verification mismatch");
  }
  if (createSummaryMarkdown(evaluated) !== summaryText) {
    throw new Error("B1 summary artifact verification mismatch");
  }
  return Object.freeze({
    status: "pass",
    gateStatus: evaluated.status,
    operationCount: rawOperations.length,
    environmentReceiptSha256,
    currentArtifactBindingsVerified: true,
  });
}

async function verifyCurrentArtifactBindings(environment) {
  const [
    benchmarkSourceSha256,
    productionSourceSha256,
    packageLockSha256,
    productionDistSha256,
  ] = await Promise.all([
    hashKnownFiles(BENCHMARK_SOURCE_FILES),
    hashProductionSourceInputs(),
    hashFile(path.join(REPOSITORY_ROOT, "package-lock.json")),
    hashDirectory(path.join(REPOSITORY_ROOT, "dist")),
  ]);
  if (benchmarkSourceSha256 !== environment.benchmarkSourceSha256) {
    throw new Error("B1 benchmark source binding mismatch");
  }
  if (productionSourceSha256 !== environment.productionSourceSha256) {
    throw new Error("B1 production source binding mismatch");
  }
  if (packageLockSha256 !== environment.packageLockSha256) {
    throw new Error("B1 package-lock binding mismatch");
  }
  if (productionDistSha256 !== environment.productionDistSha256) {
    throw new Error("B1 production dist binding mismatch");
  }
  if (environment.fixtureGeneratorVersion !== GENERATOR_VERSION) {
    throw new Error("B1 fixture generator binding mismatch");
  }
  const { stdout: headStdout } = await execFile("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    windowsHide: true,
  });
  const headSha = headStdout.trim();
  if (!/^[a-f0-9]{40}$/.test(headSha)) {
    throw new Error("B1 current repository commit unavailable");
  }
  try {
    await execFile(
      "git",
      ["merge-base", "--is-ancestor", environment.repositoryCommitSha, headSha],
      { cwd: REPOSITORY_ROOT, windowsHide: true },
    );
  } catch {
    throw new Error("B1 benchmark commit is not an ancestor of current HEAD");
  }
}

export async function cleanupB1Checkpoints() {
  if (path.resolve(CHECKPOINT_DIRECTORY) !== CHECKPOINT_DIRECTORY) {
    throw new Error("refusing unsafe B1 checkpoint cleanup");
  }
  await rm(CHECKPOINT_DIRECTORY, { recursive: true, force: true });
  return Object.freeze({ status: "pass", removed: true });
}

async function writeNewAtomic(targetPath, contents) {
  assertKnownWritePath(targetPath);
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeArtifactBundleAtomic(artifacts) {
  const prepared = artifacts.map(([targetPath, contents]) => {
    assertKnownWritePath(targetPath);
    return {
      targetPath,
      contents,
      temporaryPath: `${targetPath}.${process.pid}.${randomUUID()}.tmp`,
      backupPath: `${targetPath}.${process.pid}.${randomUUID()}.bak`,
      priorArtifactMoved: false,
      replacementInstalled: false,
    };
  });
  try {
    for (const artifact of prepared) {
      await writeFile(artifact.temporaryPath, artifact.contents, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    for (const artifact of prepared) {
      try {
        await rename(artifact.targetPath, artifact.backupPath);
        artifact.priorArtifactMoved = true;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
    for (const artifact of prepared) {
      await rename(artifact.temporaryPath, artifact.targetPath);
      artifact.replacementInstalled = true;
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const artifact of [...prepared].reverse()) {
      try {
        await rm(artifact.temporaryPath, { force: true });
        if (artifact.replacementInstalled) {
          await rm(artifact.targetPath, { force: true });
        }
        if (artifact.priorArtifactMoved) {
          await rename(artifact.backupPath, artifact.targetPath);
        }
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      throw new Error("B1 artifact bundle replacement and rollback failed", {
        cause: error,
      });
    }
    throw error;
  }
  for (const artifact of prepared) {
    if (artifact.priorArtifactMoved) {
      await rm(artifact.backupPath, { force: true });
    }
  }
}

function assertKnownWritePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const allowedRoots = [CHECKPOINT_DIRECTORY, REPORT_DIRECTORY].map(
    (root) => `${path.resolve(root)}${path.sep}`,
  );
  if (!allowedRoots.some((root) => resolved.startsWith(root))) {
    throw new Error("refusing write outside B1 artifact directories");
  }
}

async function readFreeDiskBytes() {
  const fileSystem = await statfs(REPOSITORY_ROOT);
  const value = Number(fileSystem.bavail * fileSystem.bsize);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("free disk measurement unavailable");
  }
  return value;
}

async function hashKnownFiles(relativePaths) {
  const hash = createHash("sha256");
  for (const relativePath of [...relativePaths].sort()) {
    const normalized = relativePath.replaceAll("\\", "/");
    hash.update(`${normalized}\0`, "utf8");
    hash.update(await readFile(path.join(REPOSITORY_ROOT, relativePath)));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function hashProductionSourceInputs() {
  const relativePaths = await listProductionSourceInputs();
  await assertProductionSourceInputsTracked(relativePaths);
  return hashKnownFiles(relativePaths);
}

async function listProductionSourceInputs() {
  const relativePaths = [...PRODUCTION_SOURCE_FILES];
  for (const directory of PRODUCTION_SOURCE_DIRECTORIES) {
    const absoluteDirectory = path.join(REPOSITORY_ROOT, directory);
    for (const filePath of await listFiles(absoluteDirectory)) {
      relativePaths.push(
        path.relative(REPOSITORY_ROOT, filePath).replaceAll("\\", "/"),
      );
    }
  }
  return [...new Set(relativePaths)];
}

async function assertProductionSourceInputsTracked(
  productionSourceInputs = undefined,
) {
  const relativePaths =
    productionSourceInputs ?? (await listProductionSourceInputs());
  const { stdout } = await execFile(
    "git",
    [
      "ls-files",
      "--cached",
      "--",
      ...PRODUCTION_SOURCE_DIRECTORIES,
      ...PRODUCTION_SOURCE_FILES,
    ],
    { cwd: REPOSITORY_ROOT, windowsHide: true },
  );
  validateProductionSourceInputsTracked(
    relativePaths,
    stdout.split(/\r?\n/u).filter(Boolean),
  );
}

export function validateProductionSourceInputsTracked(
  productionSourceInputs,
  trackedPaths,
) {
  if (!Array.isArray(productionSourceInputs) || !Array.isArray(trackedPaths)) {
    throw new Error("B1 production source tracking evidence invalid");
  }
  const normalize = (value) => {
    if (
      typeof value !== "string" ||
      value === "" ||
      value.includes("\0") ||
      path.isAbsolute(value)
    ) {
      throw new Error("B1 production source tracking evidence invalid");
    }
    return value.replaceAll("\\", "/");
  };
  const tracked = new Set(trackedPaths.map(normalize));
  const untrackedInputs = productionSourceInputs
    .map(normalize)
    .filter((relativePath) => !tracked.has(relativePath));
  if (untrackedInputs.length > 0) {
    throw new Error("B1 production source inputs must be Git tracked");
  }
}

export function validateB1WorktreeStatus(status) {
  if (typeof status !== "string" || status.trim() !== "") {
    throw new Error("B1 matrix requires a clean worktree");
  }
}

async function assertWorktreeClean() {
  const { stdout } = await execFile(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: REPOSITORY_ROOT, windowsHide: true },
  );
  validateB1WorktreeStatus(stdout);
}

async function buildProductionDist() {
  const invocation = await resolveNpmBuildInvocation();
  await execFile(invocation.executable, invocation.arguments, {
    cwd: REPOSITORY_ROOT,
    windowsHide: true,
    timeout: PRODUCTION_BUILD_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export async function resolveNpmBuildInvocation() {
  const nodeExecutable = await realpath(process.execPath);
  const npmCliCandidate = path.join(
    path.dirname(nodeExecutable),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  let npmCliPath;
  try {
    npmCliPath = await realpath(npmCliCandidate);
  } catch {
    throw new Error("npm_cli_not_found");
  }
  if (
    path.normalize(npmCliPath).toLowerCase() !==
      path.normalize(npmCliCandidate).toLowerCase() ||
    path.basename(npmCliPath).toLowerCase() !== "npm-cli.js"
  ) {
    throw new Error("npm_cli_not_found");
  }
  return Object.freeze({
    executable: nodeExecutable,
    arguments: Object.freeze([npmCliPath, "run", "build"]),
  });
}

async function hashDirectory(directory) {
  const files = await listFiles(directory);
  const hash = createHash("sha256");
  for (const filePath of files) {
    const relativePath = path
      .relative(directory, filePath)
      .replaceAll("\\", "/");
    hash.update(`${relativePath}\0`, "utf8");
    hash.update(await readFile(filePath));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function hashFile(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertExactFields(value, fields, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.join("|") !== expected.join("|")) {
    throw new Error(`${label} field set mismatch`);
  }
}

function mapIndexedDbMeasurement(
  operation,
  cleanupStorage,
  sourceCanonicalBytes,
) {
  if (
    !isStorageMeasurement(operation.storageBefore) ||
    !isStorageMeasurement(operation.storageAfter) ||
    !isStorageMeasurement(cleanupStorage)
  ) {
    return {
      metricAvailable: false,
      reasonCode: "browser_metric_unavailable",
    };
  }
  return {
    metricAvailable: true,
    expectedDirection: operation.expectedDirection,
    sourceCanonicalBytes,
    usageBeforeBytes: operation.storageBefore.usageBytes,
    quotaBeforeBytes: operation.storageBefore.quotaBytes,
    usageAfterBytes: operation.storageAfter.usageBytes,
    quotaAfterBytes: operation.storageAfter.quotaBytes,
    cleanupUsageBytes: cleanupStorage.usageBytes,
    cleanupQuotaBytes: cleanupStorage.quotaBytes,
    readbackVerified: operation.readbackVerified === true,
  };
}

function isStorageMeasurement(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Number.isSafeInteger(value.usageBytes) &&
    value.usageBytes >= 0 &&
    Number.isSafeInteger(value.quotaBytes) &&
    value.quotaBytes > 0
  );
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${label} must be a plain object`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value`);
  }
  return value;
}

function assertEnum(value, values, label) {
  if (!values.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  let result;
  if (args.cleanupCheckpoints) {
    result = await cleanupB1Checkpoints();
  } else if (args.verify) {
    result = await verifyB1ReportArtifacts();
  } else if (args.run) {
    result = await runB1Matrix({
      chromePath: process.env.GATE_014_B1_CHROME_PATH,
      cftMetadataPath: process.env.GATE_014_B1_CFT_METADATA_PATH,
      maxNewRuns: args.maxNewRuns,
    });
  } else {
    throw new Error("use --run, --verify, or --cleanup-checkpoints");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(args) {
  const result = {
    run: false,
    verify: false,
    cleanupCheckpoints: false,
    maxNewRuns: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--run") {
      result.run = true;
    } else if (argument === "--verify") {
      result.verify = true;
    } else if (argument === "--cleanup-checkpoints") {
      result.cleanupCheckpoints = true;
    } else if (argument === "--max-new-runs") {
      result.maxNewRuns = Number(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`unsupported argument: ${argument}`);
    }
  }
  const selectedModeCount = [
    result.run,
    result.verify,
    result.cleanupCheckpoints,
  ].filter(Boolean).length;
  if (selectedModeCount !== 1) {
    throw new Error("select exactly one B1 matrix mode");
  }
  if (
    result.maxNewRuns !== undefined &&
    (!result.run ||
      !Number.isSafeInteger(result.maxNewRuns) ||
      result.maxNewRuns < 1)
  ) {
    throw new Error("--max-new-runs requires --run and a positive integer");
  }
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    if (process.env.GATE_014_B1_DEBUG === "1") {
      process.stderr.write(`${error?.stack ?? error}\n`);
    } else {
      process.stderr.write(
        "GATE-014-B1 matrix runner failed. Set GATE_014_B1_DEBUG=1 for diagnostics.\n",
      );
    }
    process.exitCode = 1;
  });
}
