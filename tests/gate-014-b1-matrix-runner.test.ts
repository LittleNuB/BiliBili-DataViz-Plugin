import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertB1CheckpointDirectoryReady,
  assertB1CheckpointStateAllowsUse,
  createB1ActiveRunLease,
  createB1FileLatchHooks,
  createB1RestorePreflightValidationFromLifecycle,
  createB1RunFailureMarker,
  executeB1LatchedPhase,
  mapB1LifecycleToRawOperations,
  readControlledHarnessFailureCode,
  restorePreflightValidationInputFromCommittedReport,
  resolveNpmBuildInvocation,
  selectB1FailureAfterCleanup,
  validateB1CheckpointDirectoryEntries,
  validateB1WorktreeStatus,
  validateProductionSourceInputsTracked,
  verifyB1ReportArtifacts,
} from "../scripts/gate-014-b1-matrix-runner.mjs";
import {
  B1_OPERATION_KINDS,
  createB1OperationReceipt,
} from "../scripts/gate-014-b1-receipt.mjs";
import {
  executeB1BrowserStage,
  unwrapControlledHarnessEvaluation,
} from "../scripts/gate-014-b1-browser-runner.mjs";

const FIXTURE_SHA = "a".repeat(64);
const ENVIRONMENT_SHA = "b".repeat(64);
const SESSION_SHA = "c".repeat(64);
const PUBLIC_RUN_SPEC = {
  fixtureId: "managed-full-text-100mib",
  candidate: { recordCap: 512, byteCapBytes: 2 * 1024 * 1024 },
  runMode: "warm",
  runOrdinal: 2,
};

test("GATE-014-B1 decodes only its exact missing-preflight report placeholder", () => {
  const placeholder = {
    status: "insufficient_evidence",
    reasonCode: "browser_preflight_validation_missing",
  };
  assert.equal(
    restorePreflightValidationInputFromCommittedReport(placeholder),
    null,
  );

  for (const tampered of [
    { ...placeholder, extra: true },
    { ...placeholder, reasonCode: "passing_candidate_unavailable" },
    { ...placeholder, status: "fail" },
  ]) {
    assert.equal(
      restorePreflightValidationInputFromCommittedReport(tampered),
      tampered,
    );
  }

  const receipt = {
    contract: "gate-014-b1-restore-preflight-validation-v1",
  };
  assert.equal(
    restorePreflightValidationInputFromCommittedReport(receipt),
    receipt,
  );
});

test("GATE-014-B1 committed artifacts keep canonical LF checkout on Windows", async () => {
  const attributes = await readFile(".gitattributes", "utf8");
  for (const artifactPath of [
    "/docs/benchmarks/gate-014-b1-environment.json",
    "/docs/benchmarks/gate-014-b1-raw-operations.jsonl",
    "/docs/benchmarks/gate-014-b1-report.json",
    "/docs/benchmarks/gate-014-b1-summary.md",
  ]) {
    assert.match(attributes, new RegExp(`^${artifactPath} text eol=lf$`, "m"));
  }
});

test("GATE-014-B1 failure latch records only controlled public-safe fields", () => {
  const controlledError = controlledErrorForLatch();
  assert.equal(
    readControlledHarnessFailureCode(controlledError),
    "fixture_read_batch_timing_unavailable:versions",
  );
  const marker = createB1RunFailureMarker({
    sessionBindingSha256: SESSION_SHA,
    environmentFingerprintSha256: ENVIRONMENT_SHA,
    spec: PUBLIC_RUN_SPEC,
    phase: "browser_lifecycle",
    failureClass: "execution_failure",
    harnessCode: readControlledHarnessFailureCode(controlledError),
    completedCheckpointCount: 108,
  });
  assert.equal(marker.contract, "gate-014-b1-run-failure-v1");
  assert.equal(marker.storesSensitiveText, false);
  assert.equal(Object.isFrozen(marker), true);
  const serialized = JSON.stringify(marker);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes("secret.invalid"), false);
  assert.equal(serialized.includes("provider failure"), false);

  const inherited = Object.create({
    gate014FailureCode: "fixture_read_batch_timing_unavailable:versions",
  });
  assert.equal(readControlledHarnessFailureCode(inherited), null);
  assert.equal(
    readControlledHarnessFailureCode({ gate014FailureCode: "invalid code" }),
    null,
  );
  assert.equal(readControlledHarnessFailureCode(new Error(serialized)), null);

  const lease = createB1ActiveRunLease({
    sessionBindingSha256: SESSION_SHA,
    environmentFingerprintSha256: ENVIRONMENT_SHA,
    spec: PUBLIC_RUN_SPEC,
    phase: "run_attempt",
  });
  assert.equal(lease.contract, "gate-014-b1-active-run-v1");
  assert.equal(Object.isFrozen(lease.spec?.candidate), true);
  assert.throws(
    () =>
      createB1RunFailureMarker({
        ...marker,
        contract: undefined,
        harnessCode: "a".repeat(97),
      }),
    /harnessCode is invalid/,
  );
});

test("GATE-014-B1 latches an asynchronous browser spawn failure code", async () => {
  let controlledError: unknown;
  try {
    await executeB1BrowserStage("browser_process_spawn_failed", async () => {
      throw new Error("synthetic asynchronous spawn failure");
    });
  } catch (error) {
    controlledError = error;
  }
  let leaseInstalled = false;
  let marker: ReturnType<typeof createB1RunFailureMarker> | null = null;
  await assert.rejects(
    executeB1LatchedPhase(
      {
        sessionBindingSha256: SESSION_SHA,
        environmentFingerprintSha256: ENVIRONMENT_SHA,
        spec: PUBLIC_RUN_SPEC,
        leasePhase: "run_attempt",
        failureState: {
          phase: "browser_lifecycle",
          failureClass: "execution_failure",
        },
        completedCheckpointCount: 5,
      },
      async () => {
        throw controlledError;
      },
      {
        async writeLease() {
          leaseInstalled = true;
        },
        async clearLease() {
          leaseInstalled = false;
        },
        async writeFailure(value) {
          marker = value;
        },
      },
    ),
    /checkpoint cleanup required/,
  );
  assert.equal(leaseInstalled, true);
  assert.equal(marker?.harnessCode, "browser_process_spawn_failed");
  assert.equal(marker?.completedCheckpointCount, 5);
  assert.equal(marker?.storesSensitiveText, false);
});

test("GATE-014-B1 profile cleanup does not replace a proven lifecycle failure", () => {
  const primary = controlledErrorForLatch();
  const cleanup = new Error("C:\\private\\profile cleanup failed");
  const provenSelection = selectB1FailureAfterCleanup(
    true,
    primary,
    true,
    cleanup,
  );
  assert.equal(provenSelection.error, primary);
  assert.equal(provenSelection.source, "primary");

  const unproven = new Error("unproven lifecycle failure") as Error & {
    gate014FailureCode?: string;
  };
  Object.defineProperty(unproven, "gate014FailureCode", {
    enumerable: false,
    value: "fixture_spoofed_code",
  });
  assert.equal(readControlledHarnessFailureCode(unproven), null);
  const cleanupSelection = selectB1FailureAfterCleanup(
    true,
    unproven,
    true,
    cleanup,
  );
  assert.equal(cleanupSelection.error, cleanup);
  assert.equal(cleanupSelection.source, "cleanup");

  const undefinedCleanup = selectB1FailureAfterCleanup(
    false,
    undefined,
    true,
    undefined,
  );
  assert.equal(undefinedCleanup.failed, true);
  assert.equal(undefinedCleanup.source, "cleanup");
  assert.equal(undefinedCleanup.error, undefined);
  const nullPrimary = selectB1FailureAfterCleanup(
    true,
    null,
    false,
    undefined,
  );
  assert.equal(nullPrimary.failed, true);
  assert.equal(nullPrimary.source, "primary");
  assert.equal(nullPrimary.error, null);
  assert.deepEqual(
    selectB1FailureAfterCleanup(false, undefined, false, undefined),
    { failed: false, error: undefined, source: null },
  );
});

test("GATE-014-B1 checkpoint directory rejects failed, incomplete, and unknown state", () => {
  const checkpointName =
    "managed-full-text-100mib__r512__b2097152__warm__2.checkpoint.json";
  const expected = [checkpointName];
  const healthy = validateB1CheckpointDirectoryEntries(
    [
      { name: "session.json", isFile: true },
      { name: checkpointName, isFile: true },
    ],
    expected,
  );
  assert.equal(assertB1CheckpointStateAllowsUse(healthy), healthy);

  for (const latchedName of ["active-run.json", "failure.json"]) {
    const state = validateB1CheckpointDirectoryEntries(
      [
        { name: "session.json", isFile: true },
        { name: checkpointName, isFile: true },
        { name: latchedName, isFile: true },
      ],
      expected,
    );
    assert.throws(
      () => assertB1CheckpointStateAllowsUse(state),
      /requires checkpoint cleanup/,
    );
  }
  assert.throws(
    () =>
      validateB1CheckpointDirectoryEntries(
        [{ name: checkpointName, isFile: true }],
        expected,
      ),
    /without their session binding/,
  );
  for (const entry of [
    { name: "active-run.json.123.tmp", isFile: true },
    { name: "unexpected.json", isFile: true },
    { name: "session.json", isFile: false },
  ]) {
    assert.throws(
      () => validateB1CheckpointDirectoryEntries([entry], expected),
      /unknown entry/,
    );
  }
});

test("GATE-014-B1 latched phases clear only after success and retain failures", async () => {
  const context = (failureState: {
    phase: string;
    failureClass: string;
  }) => ({
    sessionBindingSha256: SESSION_SHA,
    environmentFingerprintSha256: ENVIRONMENT_SHA,
    spec: PUBLIC_RUN_SPEC,
    leasePhase: "run_attempt",
    failureState,
    completedCheckpointCount: 108,
  });

  const successEvents: string[] = [];
  const success = await executeB1LatchedPhase(
    context({
      phase: "profile_setup",
      failureClass: "setup_failure",
    }),
    async (failureState) => {
      successEvents.push("task");
      failureState.phase = "checkpoint_write";
      failureState.failureClass = "persistence_failure";
      return "checkpoint-written";
    },
    {
      async writeLease() {
        successEvents.push("lease");
      },
      async clearLease() {
        successEvents.push("clear");
      },
      async writeFailure() {
        successEvents.push("failure");
      },
    },
  );
  assert.equal(success, "checkpoint-written");
  assert.deepEqual(successEvents, ["lease", "task", "clear"]);

  for (const scenario of [
    {
      phase: "browser_lifecycle",
      failureClass: "execution_failure",
      clearFails: false,
      completedCheckpointCount: 108,
    },
    {
      phase: "profile_cleanup",
      failureClass: "cleanup_failure",
      clearFails: false,
      completedCheckpointCount: 109,
    },
    {
      phase: "checkpoint_write",
      failureClass: "persistence_failure",
      clearFails: true,
      completedCheckpointCount: 109,
    },
  ]) {
    let leaseInstalled = false;
    let writtenMarker: ReturnType<typeof createB1RunFailureMarker> | null =
      null;
    const failureState = {
      phase: scenario.phase,
      failureClass: scenario.failureClass,
    };
    const attemptContext = context(failureState);
    await assert.rejects(
      () =>
        executeB1LatchedPhase(
          attemptContext,
          async () => {
            attemptContext.completedCheckpointCount =
              scenario.completedCheckpointCount;
            if (!scenario.clearFails) {
              throw controlledErrorForLatch();
            }
            return "checkpoint-written";
          },
          {
            async writeLease() {
              leaseInstalled = true;
            },
            async clearLease() {
              if (scenario.clearFails) {
                throw new Error("C:\\private\\lease cleanup failed");
              }
              leaseInstalled = false;
            },
            async writeFailure(marker) {
              writtenMarker = marker;
            },
          },
        ),
      /checkpoint cleanup required/,
    );
    assert.equal(leaseInstalled, true);
    assert.notEqual(writtenMarker, null);
    assert.equal(writtenMarker?.storesSensitiveText, false);
    assert.equal(
      writtenMarker?.completedCheckpointCount,
      scenario.completedCheckpointCount,
    );
    assert.equal(JSON.stringify(writtenMarker).includes("private"), false);
    if (scenario.clearFails) {
      assert.equal(writtenMarker?.phase, "lease_release");
      assert.equal(writtenMarker?.failureClass, "persistence_failure");
    } else {
      assert.equal(writtenMarker?.phase, scenario.phase);
      assert.equal(writtenMarker?.failureClass, scenario.failureClass);
      assert.equal(
        writtenMarker?.harnessCode,
        "fixture_read_batch_timing_unavailable:versions",
      );
    }
  }

  let markerWriteAttempted = false;
  await assert.rejects(
    () =>
      executeB1LatchedPhase(
        context({
          phase: "report_finalize",
          failureClass: "finalization_failure",
        }),
        async () => {
          throw new Error("C:\\private\\report failed");
        },
        {
          async writeLease() {},
          async clearLease() {},
          async writeFailure() {
            markerWriteAttempted = true;
            throw new Error("marker write failed");
          },
        },
      ),
    /failure latch unavailable/,
  );
  assert.equal(markerWriteAttempted, true);
});

test("GATE-014-B1 file latches publish exclusively and retain the lease when failure publication is unavailable", async () => {
  const checkpointRoot = path.resolve(
    "tests",
    "fixtures",
    "gate-014",
    "b1-runs",
  );
  await mkdir(checkpointRoot, { recursive: true });
  const latchDirectory = await mkdtemp(path.join(checkpointRoot, "latch-fs-"));
  const activeRunPath = path.join(latchDirectory, "active-run.json");
  const failurePath = path.join(latchDirectory, "failure.json");
  const hooks = createB1FileLatchHooks({ activeRunPath, failurePath });
  const lease = createB1ActiveRunLease({
    sessionBindingSha256: SESSION_SHA,
    environmentFingerprintSha256: ENVIRONMENT_SHA,
    spec: PUBLIC_RUN_SPEC,
    phase: "run_attempt",
  });
  const marker = createB1RunFailureMarker({
    sessionBindingSha256: SESSION_SHA,
    environmentFingerprintSha256: ENVIRONMENT_SHA,
    spec: PUBLIC_RUN_SPEC,
    phase: "browser_lifecycle",
    failureClass: "execution_failure",
    harnessCode: null,
    completedCheckpointCount: 108,
  });
  try {
    await hooks.writeLease(lease);
    const retainedLease = await readFile(activeRunPath, "utf8");
    await assert.rejects(
      hooks.writeLease(
        createB1ActiveRunLease({
          sessionBindingSha256: SESSION_SHA,
          environmentFingerprintSha256: ENVIRONMENT_SHA,
          spec: null,
          phase: "fixture_cleanup",
        }),
      ),
      /EEXIST/,
    );
    assert.equal(await readFile(activeRunPath, "utf8"), retainedLease);

    await hooks.writeFailure(marker);
    const retainedFailure = await readFile(failurePath, "utf8");
    await assert.rejects(
      hooks.writeFailure(
        createB1RunFailureMarker({
          sessionBindingSha256: SESSION_SHA,
          environmentFingerprintSha256: ENVIRONMENT_SHA,
          spec: null,
          phase: "fixture_cleanup",
          failureClass: "cleanup_failure",
          harnessCode: null,
          completedCheckpointCount: 109,
        }),
      ),
      /EEXIST/,
    );
    assert.equal(await readFile(failurePath, "utf8"), retainedFailure);

    await hooks.clearLease();
    await assert.rejects(readFile(activeRunPath, "utf8"), /ENOENT/);
    await assert.rejects(
      executeB1LatchedPhase(
        {
          sessionBindingSha256: SESSION_SHA,
          environmentFingerprintSha256: ENVIRONMENT_SHA,
          spec: PUBLIC_RUN_SPEC,
          leasePhase: "run_attempt",
          failureState: {
            phase: "browser_lifecycle",
            failureClass: "execution_failure",
          },
          completedCheckpointCount: 108,
        },
        async () => {
          throw new Error("C:\\private\\raw browser failure");
        },
        { ...hooks, emitFailure() {} },
      ),
      /failure latch unavailable/,
    );
    assert.equal(JSON.parse(await readFile(activeRunPath, "utf8")).contract,
      "gate-014-b1-active-run-v1");
    assert.equal(await readFile(failurePath, "utf8"), retainedFailure);
  } finally {
    await rm(latchDirectory, { recursive: true, force: true });
  }
});

test("GATE-014-B1 controlled pause is observable only after run and fixture-cleanup leases clear", async () => {
  const checkpointRoot = path.resolve(
    "tests",
    "fixtures",
    "gate-014",
    "b1-runs",
  );
  await mkdir(checkpointRoot, { recursive: true });
  const latchDirectory = await mkdtemp(path.join(checkpointRoot, "pause-fs-"));
  const activeRunPath = path.join(latchDirectory, "active-run.json");
  const failurePath = path.join(latchDirectory, "failure.json");
  const fileHooks = createB1FileLatchHooks({ activeRunPath, failurePath });
  const events: string[] = [];
  const trackedHooks = {
    async writeLease(lease: ReturnType<typeof createB1ActiveRunLease>) {
      events.push(`lease:${lease.phase}`);
      await fileHooks.writeLease(lease);
    },
    async clearLease() {
      await fileHooks.clearLease();
      events.push("lease:cleared");
    },
    writeFailure: fileHooks.writeFailure,
  };
  try {
    await executeB1LatchedPhase(
      {
        sessionBindingSha256: SESSION_SHA,
        environmentFingerprintSha256: ENVIRONMENT_SHA,
        spec: PUBLIC_RUN_SPEC,
        leasePhase: "run_attempt",
        failureState: {
          phase: "profile_setup",
          failureClass: "setup_failure",
        },
        completedCheckpointCount: 0,
      },
      async (failureState) => {
        events.push("checkpoint:installed");
        failureState.phase = "profile_cleanup";
        failureState.failureClass = "cleanup_failure";
        events.push("profile:cleaned");
      },
      trackedHooks,
    );
    await executeB1LatchedPhase(
      {
        sessionBindingSha256: SESSION_SHA,
        environmentFingerprintSha256: ENVIRONMENT_SHA,
        spec: null,
        leasePhase: "fixture_cleanup",
        failureState: {
          phase: "fixture_cleanup",
          failureClass: "cleanup_failure",
        },
        completedCheckpointCount: 1,
      },
      async () => {
        events.push("fixture:cleaned");
      },
      trackedHooks,
    );
    events.push("matrix:paused");
    assert.deepEqual(events, [
      "lease:run_attempt",
      "checkpoint:installed",
      "profile:cleaned",
      "lease:cleared",
      "lease:fixture_cleanup",
      "fixture:cleaned",
      "lease:cleared",
      "matrix:paused",
    ]);
    await assert.rejects(readFile(activeRunPath, "utf8"), /ENOENT/);
  } finally {
    await rm(latchDirectory, { recursive: true, force: true });
  }
});

test("GATE-014-B1 shared run and verify audit rejects a residual temporary entry", async () => {
  const checkpointRoot = path.resolve(
    "tests",
    "fixtures",
    "gate-014",
    "b1-runs",
  );
  await mkdir(checkpointRoot, { recursive: true });
  const residualPath = path.join(
    checkpointRoot,
    `active-run.json.${process.pid}.tmp`,
  );
  await writeFile(residualPath, "{}\n", { encoding: "utf8", flag: "wx" });
  try {
    await assert.rejects(
      assertB1CheckpointDirectoryReady(),
      /unknown entry/,
    );
    await assert.rejects(verifyB1ReportArtifacts(), /unknown entry/);
  } finally {
    await rm(residualPath, { force: true });
  }
});

function controlledErrorForLatch() {
  try {
    unwrapControlledHarnessEvaluation(
      {
        contract: "gate-014-b1-controlled-evaluation-v1",
        status: "fail",
        value: null,
        failureCode: "fixture_read_batch_timing_unavailable:versions",
        storesSensitiveText: false,
      },
      "browser_fixture_lifecycle_after_restart_failed",
    );
  } catch (error) {
    return error as Error;
  }
  throw new Error("controlled latch error unavailable");
}

test("GATE-014-B1 rejects tracked and untracked worktree inputs", () => {
  assert.doesNotThrow(() => validateB1WorktreeStatus(""));
  assert.throws(
    () => validateB1WorktreeStatus(" M src/background/index.ts\n"),
    /clean worktree/,
  );
  assert.throws(
    () => validateB1WorktreeStatus("?? public/untracked-runtime-input.js\n"),
    /clean worktree/,
  );
});

test("GATE-014-B1 rejects ignored files under production inputs", () => {
  assert.doesNotThrow(() =>
    validateProductionSourceInputsTracked(
      ["src/background/index.ts", "public/manifest.json"],
      ["src/background/index.ts", "public/manifest.json"],
    ),
  );
  assert.throws(
    () =>
      validateProductionSourceInputsTracked(
        [
          "src/background/index.ts",
          "public/manifest.json",
          "public/runtime.local",
        ],
        ["src/background/index.ts", "public/manifest.json"],
      ),
    /must be Git tracked/,
  );
});

test("GATE-014-B1 launches npm build through Node instead of a command shim", async () => {
  const originalNpmExecPath = process.env.npm_execpath;
  const originalNpmNodeExecPath = process.env.npm_node_execpath;
  const expectedNodeExecutable = await realpath(process.execPath);
  const expectedNpmCli = await realpath(
    path.join(
      process.platform === "win32"
        ? path.dirname(expectedNodeExecutable)
        : path.dirname(path.dirname(expectedNodeExecutable)),
      ...(process.platform === "win32" ? [] : ["lib"]),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  );
  const unrelatedDirectory = await mkdtemp(
    path.join(tmpdir(), "gate-014-b1-unrelated-npm-"),
  );
  const unrelatedNpmExecPath = path.join(unrelatedDirectory, "npm-cli.js");
  const unrelatedNodeExecPath = path.join(unrelatedDirectory, "node.exe");
  await writeFile(unrelatedNpmExecPath, "// unrelated npm cli\n", "utf8");
  await writeFile(unrelatedNodeExecPath, "unrelated node executable\n", "utf8");
  try {
    delete process.env.npm_execpath;
    delete process.env.npm_node_execpath;
    const withoutEnvironmentHints = await resolveNpmBuildInvocation();
    assert.equal(withoutEnvironmentHints.executable, expectedNodeExecutable);
    assert.deepEqual(withoutEnvironmentHints.arguments, [
      expectedNpmCli,
      "run",
      "build",
    ]);

    process.env.npm_execpath = unrelatedNpmExecPath;
    process.env.npm_node_execpath = unrelatedNodeExecPath;
    const withUnrelatedEnvironmentHints = await resolveNpmBuildInvocation();
    assert.deepEqual(withUnrelatedEnvironmentHints, withoutEnvironmentHints);
    assert.equal(Object.isFrozen(withUnrelatedEnvironmentHints), true);
    assert.equal(
      Object.isFrozen(withUnrelatedEnvironmentHints.arguments),
      true,
    );
  } finally {
    if (originalNpmExecPath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = originalNpmExecPath;
    }
    if (originalNpmNodeExecPath === undefined) {
      delete process.env.npm_node_execpath;
    } else {
      process.env.npm_node_execpath = originalNpmNodeExecPath;
    }
    await rm(unrelatedDirectory, { recursive: true, force: true });
  }
});

function lifecycleResult() {
  return {
    fixtureId: "managed-full-text-100mib",
    candidate: { recordCap: 1024, byteCapBytes: 4 * 1024 * 1024 },
    sourceCanonicalBytes: 1_000,
    operations: B1_OPERATION_KINDS.map((operation) => {
      const requiresVisibilityTiming = [
        "admission",
        "restore_staging",
      ].includes(operation);
      const readBatchDurationsMs = requiresVisibilityTiming
        ? [5, 6, 7, 8]
        : [5];
      return {
        operation,
        expectedDirection: requiresVisibilityTiming ? "increase" : "stable",
        totalDurationMs: 1_000,
        committedBatchCount: requiresVisibilityTiming ? 1 : 0,
        committedBatchDurationsMs: requiresVisibilityTiming ? [10] : [],
        readBatchDurationsMs,
        readTimingEvidence: {
          finalLedgerAndVisibleReadbackMs: requiresVisibilityTiming ? 8 : 5,
          preCommitVisibleGraphMs: requiresVisibilityTiming ? 5 : null,
          preCommitLedgerAndVisibleReadbackMs: requiresVisibilityTiming
            ? 6
            : null,
          postCommitVisibleGraphMs: requiresVisibilityTiming ? 7 : null,
        },
        batchDurationsMs: [
          ...(requiresVisibilityTiming ? [10] : []),
          ...readBatchDurationsMs,
          ...(requiresVisibilityTiming ? [] : [10]),
        ],
        progressEventOffsetsMs:
          operation === "restart" ? [500, 750] : [],
        restart:
          operation === "restart"
            ? {
                attempted: true,
                browserLifecycleReadyMs: 3_500,
                stateVisibleMs: 500,
                remainingWork: true,
                nextProgressMs: 250,
                readbackVerified: true,
              }
            : { attempted: false },
        cancellation:
          operation === "cancellation"
            ? {
                attempted: true,
                acknowledgementMs: 10,
                writesAfterTwoSeconds: 0,
              }
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
      };
    }),
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
  assert.equal(
    rawOperations.find((operation) => operation.operation === "restart")
      .restart.browserLifecycleReadyMs,
    3_500,
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
