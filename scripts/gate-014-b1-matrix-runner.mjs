import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
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
  createB1TemporaryProfile,
  removeB1TemporaryProfile,
  runBrowserFixtureLifecycleWithPreparedFixture,
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
  const maxNewRuns =
    options.maxNewRuns === undefined
      ? Number.POSITIVE_INFINITY
      : assertPositiveSafeInteger(options.maxNewRuns, "maxNewRuns");
  const environmentCore = await collectEnvironmentCore(chromePath);
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
          for (const runOrdinal of [1, 2]) {
            const spec = { fixtureId, candidate, runMode: "cold", runOrdinal };
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

          const coldThree = {
            fixtureId,
            candidate,
            runMode: "cold",
            runOrdinal: 3,
          };
          const pendingWarm = Array.from(
            { length: B1_RUN_COUNTS.warm },
            (_, index) => ({
              fixtureId,
              candidate,
              runMode: "warm",
              runOrdinal: index + 1,
            }),
          ).filter((spec) => !checkpoints.has(runIdentity(spec)));
          const coldThreePending = !checkpoints.has(runIdentity(coldThree));
          if (!coldThreePending && pendingWarm.length === 0) {
            continue;
          }

          const bridgeProfile = await createB1TemporaryProfile();
          try {
            if (coldThreePending) {
              await recordRun(preparedFixture, bridgeProfile, coldThree);
            }
            for (const spec of pendingWarm) {
              await recordRun(preparedFixture, bridgeProfile, spec);
            }
          } finally {
            await removeB1TemporaryProfile(bridgeProfile);
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

  const completedAtEpochMs = Date.now();
  const environmentInput = buildEnvironmentInput(environmentCore, {
    startedAtEpochMs: session.startedAtEpochMs,
    completedAtEpochMs,
    freeDiskBytesAtStart: session.freeDiskBytesAtStart,
    freeDiskBytesAtEnd: await readFreeDiskBytes(),
  });
  const environment = createB1EnvironmentReceipt(environmentInput);
  const environmentReceiptSha256 = hashB1EnvironmentReceipt(environment);
  const rawOperations = expectedSpecs.flatMap((spec) => {
    const checkpoint = checkpoints.get(runIdentity(spec));
    return checkpoint.rawOperations.map((operation) => ({
      ...operation,
      environmentReceiptSha256,
    }));
  });
  for (const operation of rawOperations) {
    createB1OperationReceipt(operation);
  }
  const report = evaluateB1Report({
    environment: environmentInput,
    environmentReceiptSha256,
    fixtureReceipts,
    rawOperations,
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

async function collectEnvironmentCore(chromePath) {
  await access(path.join(REPOSITORY_ROOT, "dist", "manifest.json"));
  const [{ stdout: commitStdout }, browser] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], {
      cwd: REPOSITORY_ROOT,
      windowsHide: true,
    }),
    readBrowserMetadata(chromePath),
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
      productionExtensionMode: "unpacked",
      networkPolicy: "loopback_only_external_dns_blocked",
      coldProfilePolicy: "fresh_temporary_profile_per_run",
      warmProfilePolicy:
        "opened_complete_seed_generation_with_group_profile_reuse",
      coldRunsPerCandidateFixture: B1_RUN_COUNTS.cold,
      warmRunsPerCandidateFixture: B1_RUN_COUNTS.warm,
      externalNetworkUsed: false,
      realUserProfileRead: false,
      bilibiliLoginUsed: false,
    },
    a2CalibrationStatus: "insufficient_evidence",
    storesSensitiveText: false,
  };
}

async function readBrowserMetadata(chromePath) {
  const script = [
    "$item = Get-Item -LiteralPath $env:GATE_014_B1_BROWSER_EXECUTABLE",
    "$info = $item.VersionInfo",
    "Write-Output ($info.ProductName + '|' + $info.ProductVersion)",
  ].join("; ");
  const { stdout } = await execFile(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, GATE_014_B1_BROWSER_EXECUTABLE: chromePath },
    },
  );
  const [productName, productVersion] = stdout.trim().split("|");
  const version = productVersion?.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (!/Chrome for Testing/i.test(productName ?? "") || !version) {
    throw new Error("full matrix requires official Chrome for Testing stable");
  }
  return {
    flavor: "chrome_for_testing_stable",
    version,
    channel: "stable",
    headlessMode: "new",
    sandboxEnabled: true,
  };
}

function buildEnvironmentInput(environmentCore, run) {
  return {
    startedAtEpochMs: run.startedAtEpochMs,
    completedAtEpochMs: run.completedAtEpochMs,
    repositoryCommitSha: environmentCore.repositoryCommitSha,
    benchmarkSourceSha256: environmentCore.benchmarkSourceSha256,
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
    execution: { ...environmentCore.execution },
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
      "storesSensitiveText",
    ],
    "checkpoint",
  );
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
    `- 选中候选：${selected}\n` +
    `- 暂定恢复空间倍率：${headroom.provisionalMultiplier ?? "不可用"}\n` +
    `- 固定恢复预留：${headroom.fixedReserveBytes ?? "不可用"} 字节\n` +
    `- Chrome for Testing：${report.environment.browser.version} stable，headless=new，沙箱开启\n` +
    `- A2 校准：\`insufficient_evidence\`\n` +
    `- 真实 B 站字幕代表性：\`insufficient_evidence\`\n` +
    `- 最大实测分片尾部：\`insufficient_evidence\`\n\n` +
    `本报告不能证明真实用户分位数、平台级容量或最终运行参数。\n`
  );
}

export async function verifyB1ReportArtifacts() {
  const [environmentText, rawText, reportText] = await Promise.all([
    readFile(ENVIRONMENT_REPORT_PATH, "utf8"),
    readFile(RAW_OPERATIONS_REPORT_PATH, "utf8"),
    readFile(REPORT_PATH, "utf8"),
  ]);
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
  const rawOperations = rawText
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const canonicalRawText = `${rawOperations.map((operation) => JSON.stringify(operation)).join("\n")}\n`;
  if (canonicalRawText !== rawText) {
    throw new Error("B1 raw operation artifact serialization mismatch");
  }
  const committedReport = JSON.parse(reportText);
  const evaluated = evaluateB1Report({
    environment: environmentInput,
    environmentReceiptSha256,
    fixtureReceipts: committedReport.fixtureReceipts,
    rawOperations,
  });
  if (serializeB1Report(evaluated) !== reportText) {
    throw new Error("B1 report artifact verification mismatch");
  }
  return Object.freeze({
    status: "pass",
    gateStatus: evaluated.status,
    operationCount: rawOperations.length,
    environmentReceiptSha256,
  });
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
