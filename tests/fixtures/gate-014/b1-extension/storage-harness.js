import { restorePreflightAllows } from "./restore-preflight.js";

const DATABASE_VERSION = 1;
const MAX_MANAGED_BYTES = 500 * 1024 * 1024;
const LONG_TASK_REPORTING_THRESHOLD_MS = 50;
const TEXT_ENCODER = new TextEncoder();

export async function runFixtureSmoke(config) {
  validateConfig(config);
  const databaseName = `gate-014-b1-${config.fixtureId}-${crypto.randomUUID()}`;
  const metrics = startBrowserMetrics();
  const storageBefore = await readStorageEstimate();
  const database = await openDatabase(databaseName);
  let writeResult;
  let invisibleRead;
  let visibleRead;
  try {
    const operationId = crypto.randomUUID();
    await createOperation(database, operationId, config);
    writeResult = await writeFixture(database, operationId, config, metrics);
    invisibleRead = await readVisibleGraph(database);
    await commitOperation(
      database,
      operationId,
      config.expectedCanonicalBytes,
      config.expectedVersionCount,
    );
    visibleRead = await readVisibleGraph(database);
  } finally {
    database.close();
  }
  const storageAfter = await waitForStorageChange(storageBefore, "increase");
  await deleteDatabase(databaseName);
  const databaseDeleted = await confirmDatabaseDeleted(databaseName);
  const storageCleanup = await waitForStorageChange(storageAfter, "decrease");
  const browserMetrics = metrics.stop();
  const readbackVerified =
    writeResult.canonicalBytes === config.expectedCanonicalBytes &&
    writeResult.recordCount === config.expectedRecordCount &&
    invisibleRead.versionCount === 0 &&
    invisibleRead.segmentCount === 0 &&
    visibleRead.versionCount === config.expectedVersionCount &&
    visibleRead.segmentCount === config.expectedSegmentCount &&
    visibleRead.canonicalBytes === config.expectedCanonicalBytes;
  return {
    contract: "gate-014-b1-browser-fixture-smoke-v1",
    status: readbackVerified ? "pass" : "fail",
    fixtureId: config.fixtureId,
    candidate: config.candidate,
    expectedCanonicalBytes: config.expectedCanonicalBytes,
    receivedCanonicalBytes: writeResult.canonicalBytes,
    expectedRecordCount: config.expectedRecordCount,
    receivedRecordCount: writeResult.recordCount,
    committedBatchCount: writeResult.batchDurationsMs.length,
    totalDurationMs: writeResult.totalDurationMs,
    batchDurationsMs: writeResult.batchDurationsMs,
    progressEventOffsetsMs: writeResult.progressEventOffsetsMs,
    invisibleRead,
    visibleRead,
    readbackVerified,
    storageBefore,
    storageAfter,
    storageCleanup,
    databaseDeleted,
    heapMetricAvailable: browserMetrics.heapMetricAvailable,
    peakHeapGrowthBytes: browserMetrics.peakHeapGrowthBytes,
    mainThreadMetricAvailable: browserMetrics.mainThreadMetricAvailable,
    mainThreadMaxTaskMs: browserMetrics.mainThreadMaxTaskMs,
    storesSensitiveText: false,
  };
}

export async function runFixtureLifecycleBeforeRestart(config) {
  validateConfig(config, { lifecycle: true });
  const database = await openDatabase(config.databaseName);
  let warmSeedDatabase = null;
  const operations = [];
  try {
    const warmSeed =
      config.runMode === "warm"
        ? await prepareWarmSeedGeneration(config)
        : {
            database: null,
            databaseName: null,
            generationVerified: true,
            ledgerConsistencyVerified: true,
          };
    warmSeedDatabase = warmSeed.database;
    const firstAdmission = await runAdmission(database, config, "admission");
    operations.push(firstAdmission.operation, firstAdmission.commitOperation);
    const ledgerConsistencyVerified =
      warmSeed.ledgerConsistencyVerified &&
      operations.every(
        (operation) => operation.ledgerConsistencyVerified === true,
      );
    return {
      contract: "gate-014-b1-browser-lifecycle-before-restart-v1",
      status:
        firstAdmission.readbackVerified &&
        ledgerConsistencyVerified &&
        warmSeed.generationVerified
          ? "pass"
          : "fail",
      fixtureId: config.fixtureId,
      candidate: config.candidate,
      operations,
      checkpoint: {
        operationId: firstAdmission.operationId,
        admissionReadbackVerified: firstAdmission.readbackVerified,
        ledgerConsistencyVerified,
        warmSeedDatabaseName: warmSeed.databaseName,
        warmStartCompleteGenerationVerified: warmSeed.generationVerified,
      },
      storesSensitiveText: false,
    };
  } finally {
    warmSeedDatabase?.close();
    database.close();
  }
}

export async function runFixtureLifecycleAfterRestart(config, checkpoint) {
  validateConfig(config, { lifecycle: true, restarted: true });
  validateLifecycleCheckpoint(checkpoint, config);
  const operations = [];
  const checks = {
    admission: checkpoint.admissionReadbackVerified,
    restore: false,
    restart: false,
    orderedRead: false,
    normalization: false,
    ledgerRepair: false,
    capacityBoundary: false,
    atomicRollback: false,
    cancellation: false,
    selectedRemoval: false,
    fullClear: false,
    quotaFailure: false,
    restorePreflightAllow: false,
    warmStart: checkpoint.warmStartCompleteGenerationVerified,
  };
  let database = null;
  let finalCleanupStorage = null;
  try {
    const recovery = await runRestartRecovery(config, checkpoint.operationId);
    database = recovery.database;
    operations.push(recovery.operation, recovery.normalizationOperation);
    checks.restart = recovery.operation.readbackVerified;
    checks.normalization = recovery.normalizationOperation.readbackVerified;

    const orderedRead = await runOrderedRead(database, config);
    operations.push(orderedRead);
    checks.orderedRead = orderedRead.readbackVerified;

    const ledgerRepair = await runLedgerRepair(database, config);
    operations.push(ledgerRepair);
    checks.ledgerRepair = ledgerRepair.readbackVerified;

    const capacityBoundary = await runCapacityBoundary(database, config);
    operations.push(capacityBoundary);
    checks.capacityBoundary = capacityBoundary.readbackVerified;

    const atomicVersion = await runAtomicVersionRollback(database, config);
    operations.push(atomicVersion);
    checks.atomicRollback = atomicVersion.readbackVerified;

    const cancellation = await runCancellation(database, config);
    operations.push(cancellation);
    checks.cancellation = cancellation.readbackVerified;

    const selectedRemoval = await runSelectedVersionRemoval(database, config);
    operations.push(selectedRemoval);
    checks.selectedRemoval = selectedRemoval.readbackVerified;

    const fullClear = await runFullClear(database, config);
    operations.push(fullClear);
    checks.fullClear = fullClear.readbackVerified;

    const restore = await runAdmission(database, config, "restore_staging");
    operations.push(restore.operation);
    checks.restore = restore.readbackVerified;
    checks.restorePreflightAllow = restore.preflightBoundaryVerified;

    const quotaFailure = await runQuotaFailure(database, config);
    operations.push(quotaFailure);
    checks.quotaFailure = quotaFailure.readbackVerified;
  } finally {
    database?.close();
    const storageBeforeDelete = await readStorageEstimate();
    const databaseNames = [
      config.databaseName,
      checkpoint.warmSeedDatabaseName,
    ].filter(Boolean);
    for (const databaseName of databaseNames) {
      await deleteDatabase(databaseName);
    }
    const databaseDeleted = (
      await Promise.all(
        databaseNames.map((databaseName) =>
          confirmDatabaseDeleted(databaseName),
        ),
      )
    ).every(Boolean);
    finalCleanupStorage = await waitForStorageChange(
      storageBeforeDelete,
      "decrease",
    );
    checks.databaseDeleted = databaseDeleted;
  }

  const ledgerMatchesVersionBytes =
    checkpoint.ledgerConsistencyVerified &&
    operations.every(
      (operation) => operation.ledgerConsistencyVerified === true,
    );
  const assertions = {
    atomicVersionCommitOrRollback:
      checks.admission &&
      checks.restore &&
      checks.atomicRollback &&
      checks.restart,
    ledgerMatchesVersionBytes,
    exactCapacityBoundaryEnforced: checks.capacityBoundary,
    stagedRowsInvisible:
      checks.admission && checks.restore && checks.cancellation,
    committedRowsVisibleTogether: checks.admission && checks.restore,
    orphanRowsHiddenAndCleanable: checks.atomicRollback && checks.cancellation,
    cleanupReadbackVerified: checks.fullClear && checks.databaseDeleted,
    restorePreflightBoundaryVerified:
      checks.quotaFailure && checks.restorePreflightAllow,
    warmStartCompleteGenerationVerified: checks.warmStart,
  };
  const readbackVerified =
    Object.values(checks).every(Boolean) &&
    Object.values(assertions).every(Boolean);
  return {
    contract: "gate-014-b1-browser-lifecycle-v1",
    status: readbackVerified ? "pass" : "fail",
    fixtureId: config.fixtureId,
    candidate: config.candidate,
    operations,
    assertions,
    finalCleanupStorage,
    readbackVerified,
    storesSensitiveText: false,
  };
}

async function prepareWarmSeedGeneration(config) {
  const databaseName = `${config.databaseName}-warm-seed`;
  const database = await openDatabase(databaseName);
  try {
    const seedConfig = { ...config, databaseName };
    const admission = await runAdmission(database, seedConfig, "admission");
    const normalization = await runMarkerNormalization(
      database,
      seedConfig,
      admission.operationId,
    );
    const visible = await readVisibleGraph(database);
    const ledgerConsistency = await readLedgerConsistency(database);
    const generationVerified =
      admission.readbackVerified &&
      normalization.readbackVerified &&
      visible.versionCount === config.expectedVersionCount &&
      visible.segmentCount === config.expectedSegmentCount &&
      visible.canonicalBytes === config.expectedCanonicalBytes;
    if (!generationVerified || !ledgerConsistency.matches) {
      throw new Error("fixture_warm_seed_verification_failed");
    }
    return {
      database,
      databaseName,
      generationVerified,
      ledgerConsistencyVerified:
        admission.operation.ledgerConsistencyVerified &&
        admission.commitOperation.ledgerConsistencyVerified &&
        normalization.ledgerConsistencyVerified &&
        ledgerConsistency.matches,
    };
  } catch (error) {
    database.close();
    await deleteDatabase(databaseName);
    throw error;
  }
}

async function runRestartRecovery(config, operationId) {
  const storageBefore = await readStorageEstimate();
  const metrics = startBrowserMetrics();
  let database = null;
  try {
    database = await openDatabase(config.databaseName);
    const stateReadStartedAt = performance.now();
    const operationState = await requestResult(
      database
        .transaction("operations", "readonly")
        .objectStore("operations")
        .get(operationId),
    );
    const harnessReadyMs = Math.max(
      0,
      config.restartHarnessReadyEpochMs - config.restartStartedEpochMs,
    );
    const ledgerConsistency = await readLedgerConsistency(database);
    const stateReadDurationMs = performance.now() - stateReadStartedAt;
    const stateVisibleMs = Math.max(
      0,
      Date.now() - config.restartStartedEpochMs,
    );
    const durableStateVerified =
      operationState?.state === "committed" &&
      ledgerConsistency.matches &&
      ledgerConsistency.visibleVersionCount === config.expectedVersionCount &&
      ledgerConsistency.visibleCanonicalBytes === config.expectedCanonicalBytes;
    const normalizationOperation = await runMarkerNormalization(
      database,
      config,
      operationId,
    );
    const firstNormalizationProgressMs =
      normalizationOperation.progressEventOffsetsMs[0];
    if (!Number.isFinite(firstNormalizationProgressMs)) {
      throw new Error("fixture_restart_progress_missing");
    }
    const nextProgressMs = Math.max(0, firstNormalizationProgressMs);
    const operationDurationMs = Math.max(
      stateVisibleMs,
      stateVisibleMs + nextProgressMs,
    );
    metrics.sampleHeap();
    const browserMetrics = metrics.stop();
    const storageAfter = await readStorageEstimate();
    const progressEventOffsetsMs = normalizeProgressEvents(
      [harnessReadyMs, stateVisibleMs, stateVisibleMs + nextProgressMs],
      operationDurationMs,
    );
    return {
      database,
      normalizationOperation,
      operation: {
        operation: "restart",
        expectedDirection: "stable",
        totalDurationMs: operationDurationMs,
        batchDurationsMs: [
          stateReadDurationMs,
          normalizationOperation.batchDurationsMs[0],
        ],
        progressEventOffsetsMs,
        restart: {
          attempted: true,
          stateVisibleMs,
          remainingWork: true,
          nextProgressMs,
          readbackVerified:
            durableStateVerified &&
            normalizationOperation.readbackVerified &&
            ledgerConsistency.matches,
        },
        cancellation: { attempted: false },
        mainThread: browserMetrics.mainThreadMetricAvailable
          ? {
              metricAvailable: true,
              maximumTaskMs: browserMetrics.mainThreadMaxTaskMs,
            }
          : {
              metricAvailable: false,
              reasonCode: "browser_metric_unavailable",
            },
        memory: browserMetrics.heapMetricAvailable
          ? {
              metricAvailable: true,
              peakHeapGrowthBytes: browserMetrics.peakHeapGrowthBytes,
            }
          : {
              metricAvailable: false,
              reasonCode: "browser_metric_unavailable",
            },
        storageBefore,
        storageAfter,
        ledgerConsistencyVerified: ledgerConsistency.matches,
        readbackVerified:
          durableStateVerified &&
          normalizationOperation.readbackVerified &&
          ledgerConsistency.matches,
        detail: {
          durableStateVerified,
          harnessReadyMs,
          normalizationReadbackVerified:
            normalizationOperation.readbackVerified,
        },
      },
    };
  } catch (error) {
    metrics.stop();
    database?.close();
    throw error;
  }
}

async function runAdmission(database, config, operationKind) {
  const operationId = crypto.randomUUID();
  const artifactUrl =
    operationKind === "restore_staging"
      ? config.restoreArtifactUrl
      : config.artifactUrl;
  let commitMeasurement;
  let invisibleRead;
  let visibleRead;
  let restoreArtifactResponse = null;
  let restorePreflightEvidence = null;
  let preflightBoundaryVerified = operationKind !== "restore_staging";
  const operation = await measureOperation(
    database,
    operationKind,
    "increase",
    async (context) => {
      if (operationKind === "restore_staging") {
        const estimate = await readStorageEstimate();
        if (estimate === null) {
          throw new Error("fixture_restore_preflight_metric_unavailable");
        }
        const availableFreeQuotaBytes = Math.max(
          0,
          estimate.quotaBytes - estimate.usageBytes,
        );
        const requiredFreeQuotaBytes = config.expectedCanonicalBytes;
        const measuredQuotaAllowed = restorePreflightAllows(
          availableFreeQuotaBytes,
          requiredFreeQuotaBytes,
        );
        if (!measuredQuotaAllowed) {
          throw new Error("fixture_restore_preflight_quota_refused");
        }
        const exactBoundaryProbe = await beginRestoreAfterPreflight(
          artifactUrl,
          requiredFreeQuotaBytes,
          requiredFreeQuotaBytes,
          { retainResponse: true },
        );
        restoreArtifactResponse = exactBoundaryProbe.response;
        preflightBoundaryVerified =
          exactBoundaryProbe.allowed &&
          exactBoundaryProbe.artifactFetchAttempted &&
          restoreArtifactResponse instanceof Response;
        restorePreflightEvidence = {
          measuredAvailableFreeQuotaBytes: availableFreeQuotaBytes,
          requiredFreeQuotaBytes,
          measuredQuotaAllowed,
          exactBoundaryAvailableFreeQuotaBytes: requiredFreeQuotaBytes,
          exactBoundaryAllowed: exactBoundaryProbe.allowed,
          artifactFetchAttempted: exactBoundaryProbe.artifactFetchAttempted,
        };
        if (!preflightBoundaryVerified) {
          throw new Error("fixture_restore_preflight_exact_boundary_refused");
        }
      }
      await createOperation(database, operationId, config);
      const writeResult = await writeFixture(
        database,
        operationId,
        { ...config, artifactUrl },
        context.metrics,
        restoreArtifactResponse,
      );
      const progressEventOffsetsMs = [
        ...writeResult.progressEventOffsetsMs,
        performance.now() - context.startedAt,
      ];
      invisibleRead = await readVisibleGraph(database, () => {
        progressEventOffsetsMs.push(performance.now() - context.startedAt);
      });
      const invisibleLedgerConsistency = await readLedgerConsistency(database);
      progressEventOffsetsMs.push(performance.now() - context.startedAt);
      commitMeasurement = await measureOperation(
        database,
        "commit_visibility",
        "stable",
        async (commitContext) => {
          const startedAt = performance.now();
          await commitOperation(
            database,
            operationId,
            config.expectedCanonicalBytes,
            config.expectedVersionCount,
          );
          const duration = performance.now() - startedAt;
          return {
            batchDurationsMs: [duration],
            progressEventOffsetsMs: [
              performance.now() - commitContext.startedAt,
            ],
            readbackVerified: true,
          };
        },
      );
      progressEventOffsetsMs.push(performance.now() - context.startedAt);
      visibleRead = await readVisibleGraph(database, () => {
        progressEventOffsetsMs.push(performance.now() - context.startedAt);
      });
      progressEventOffsetsMs.push(performance.now() - context.startedAt);
      return {
        batchDurationsMs: writeResult.batchDurationsMs,
        progressEventOffsetsMs,
        readbackVerified:
          writeResult.canonicalBytes === config.expectedCanonicalBytes &&
          writeResult.recordCount === config.expectedRecordCount &&
          invisibleRead.versionCount === 0 &&
          invisibleRead.segmentCount === 0 &&
          invisibleLedgerConsistency.matches &&
          visibleRead.versionCount === config.expectedVersionCount &&
          visibleRead.segmentCount === config.expectedSegmentCount &&
          visibleRead.canonicalBytes === config.expectedCanonicalBytes,
        detail: {
          receivedCanonicalBytes: writeResult.canonicalBytes,
          receivedRecordCount: writeResult.recordCount,
          invisibleRead,
          invisibleLedgerConsistencyVerified:
            invisibleLedgerConsistency.matches,
          visibleRead,
          restorePreflightExactBoundaryAllowed:
            operationKind === "restore_staging"
              ? preflightBoundaryVerified
              : null,
          restorePreflightEvidence,
        },
      };
    },
  );
  return {
    operationId,
    operation,
    commitOperation: commitMeasurement,
    preflightBoundaryVerified:
      preflightBoundaryVerified && operation.readbackVerified,
    readbackVerified:
      operation.readbackVerified && commitMeasurement.readbackVerified,
  };
}

async function runOrderedRead(database, config) {
  return measureOperation(
    database,
    "ordered_read",
    "stable",
    async (context) => {
      const versions = await scanStoreInBatches(
        database,
        "versions",
        config.candidate,
        {
          startedAt: context.startedAt,
          filter: (value) =>
            value.visible === true || typeof value.operationId === "string",
          byteSelector: (value) => value.canonicalBytes,
          visitBatch: () => context.metrics.sampleHeap(),
        },
      );
      const segments = await scanStoreInBatches(
        database,
        "segments",
        config.candidate,
        {
          startedAt: context.startedAt,
          byteSelector: (value) => value.canonicalBytes,
          visitBatch: () => context.metrics.sampleHeap(),
        },
      );
      return {
        batchDurationsMs: [
          ...versions.batchDurationsMs,
          ...segments.batchDurationsMs,
        ],
        progressEventOffsetsMs: [
          ...versions.progressEventOffsetsMs,
          ...segments.progressEventOffsetsMs,
        ],
        readbackVerified:
          versions.totalCount === config.expectedVersionCount &&
          versions.totalCanonicalBytes === config.expectedCanonicalBytes &&
          segments.totalCount === config.expectedSegmentCount,
        detail: {
          versionCount: versions.totalCount,
          segmentCount: segments.totalCount,
          canonicalBytes: versions.totalCanonicalBytes,
        },
      };
    },
  );
}

async function runMarkerNormalization(database, config, operationId) {
  return measureOperation(
    database,
    "marker_normalization",
    "stable",
    async (context) => {
      const versions = await scanIndexInBatches(
        database,
        "versions",
        "operationId",
        operationId,
        config.candidate,
        {
          startedAt: context.startedAt,
          visitBatch: async (batch) => {
            await updateValues(database, "versions", batch.values, (value) => ({
              ...value,
              operationId: null,
              normalized: true,
              visible: true,
            }));
            context.metrics.sampleHeap();
          },
        },
      );
      const segments = await scanIndexInBatches(
        database,
        "segments",
        "operationId",
        operationId,
        config.candidate,
        {
          startedAt: context.startedAt,
          visitBatch: async (batch) => {
            await updateValues(database, "segments", batch.values, (value) => ({
              ...value,
              operationId: null,
            }));
            context.metrics.sampleHeap();
          },
        },
      );
      await transactionPromise(database, ["operations"], (transaction) => {
        transaction.objectStore("operations").delete(operationId);
      });
      const readbackProgressEventOffsetsMs = [];
      const visible = await readVisibleGraph(database, () => {
        readbackProgressEventOffsetsMs.push(
          performance.now() - context.startedAt,
        );
      });
      return {
        batchDurationsMs: [
          ...versions.batchDurationsMs,
          ...segments.batchDurationsMs,
        ],
        progressEventOffsetsMs: [
          ...versions.progressEventOffsetsMs,
          ...segments.progressEventOffsetsMs,
          ...readbackProgressEventOffsetsMs,
        ],
        readbackVerified:
          visible.versionCount === config.expectedVersionCount &&
          visible.segmentCount === config.expectedSegmentCount &&
          visible.canonicalBytes === config.expectedCanonicalBytes,
        detail: visible,
      };
    },
  );
}

async function runLedgerRepair(database, config) {
  return measureOperation(
    database,
    "ledger_repair",
    "stable",
    async (context) => {
      const batchDurationsMs = [];
      let startedAt = performance.now();
      await transactionPromise(database, ["state"], (transaction) => {
        transaction.objectStore("state").put({
          id: "managed-full-text-ledger",
          canonicalBytes: 0,
          versionCount: 0,
        });
      });
      batchDurationsMs.push(performance.now() - startedAt);
      const corruptedLedgerConsistency = await readLedgerConsistency(database);
      const versions = await scanStoreInBatches(
        database,
        "versions",
        config.candidate,
        {
          startedAt: context.startedAt,
          filter: (value) => value.visible === true,
          byteSelector: (value) => value.canonicalBytes,
          visitBatch: () => context.metrics.sampleHeap(),
        },
      );
      startedAt = performance.now();
      await transactionPromise(database, ["state"], (transaction) => {
        transaction.objectStore("state").put({
          id: "managed-full-text-ledger",
          canonicalBytes: versions.totalCanonicalBytes,
          versionCount: versions.totalCount,
        });
      });
      batchDurationsMs.push(performance.now() - startedAt);
      const ledger = await requestResult(
        database
          .transaction("state", "readonly")
          .objectStore("state")
          .get("managed-full-text-ledger"),
      );
      return {
        batchDurationsMs: [...batchDurationsMs, ...versions.batchDurationsMs],
        progressEventOffsetsMs: [
          ...versions.progressEventOffsetsMs,
          performance.now() - context.startedAt,
        ],
        readbackVerified:
          ledger?.canonicalBytes === config.expectedCanonicalBytes &&
          ledger?.versionCount === config.expectedVersionCount &&
          !corruptedLedgerConsistency.matches,
        detail: {
          canonicalBytes: ledger?.canonicalBytes ?? null,
          versionCount: ledger?.versionCount ?? null,
          corruptionDetected: !corruptedLedgerConsistency.matches,
        },
      };
    },
  );
}

async function runCapacityBoundary(database, config) {
  return measureOperation(
    database,
    "capacity_boundary",
    "stable",
    async (context) => {
      if (config.expectedCanonicalBytes === MAX_MANAGED_BYTES) {
        const ledgerBefore = await requestResult(
          database
            .transaction("state", "readonly")
            .objectStore("state")
            .get("managed-full-text-ledger"),
        );
        const overOperationId = crypto.randomUUID();
        await createOperation(database, overOperationId, config);
        const startedAt = performance.now();
        let overBoundaryRefused = false;
        try {
          await commitOperation(database, overOperationId, 1, 1);
        } catch (error) {
          if (error?.message !== "fixture_commit_aborted") {
            throw error;
          }
          overBoundaryRefused = true;
        }
        const batchDurationMs = performance.now() - startedAt;
        await transactionPromise(database, ["operations"], (transaction) => {
          transaction.objectStore("operations").delete(overOperationId);
        });
        const ledgerAfter = await requestResult(
          database
            .transaction("state", "readonly")
            .objectStore("state")
            .get("managed-full-text-ledger"),
        );
        const readbackProgressEventOffsetsMs = [];
        const visible = await readVisibleGraph(database, () => {
          readbackProgressEventOffsetsMs.push(
            performance.now() - context.startedAt,
          );
        });
        const exactBoundaryCommitted =
          ledgerBefore?.canonicalBytes === MAX_MANAGED_BYTES &&
          ledgerBefore?.versionCount === config.expectedVersionCount &&
          visible.canonicalBytes === MAX_MANAGED_BYTES &&
          visible.versionCount === config.expectedVersionCount &&
          visible.segmentCount === config.expectedSegmentCount;
        return {
          batchDurationsMs: [batchDurationMs],
          progressEventOffsetsMs: [
            ...readbackProgressEventOffsetsMs,
            performance.now() - context.startedAt,
          ],
          readbackVerified:
            exactBoundaryCommitted &&
            overBoundaryRefused &&
            ledgerAfter?.canonicalBytes === MAX_MANAGED_BYTES &&
            ledgerAfter?.versionCount === config.expectedVersionCount,
          detail: {
            exactBoundaryCommitted,
            positiveByteBeyondRefused: overBoundaryRefused,
            existingCanonicalBytes: visible.canonicalBytes,
            boundaryPath: "actual_fixture_commit",
          },
        };
      }

      const probeDatabaseName = `${config.databaseName}-capacity-${crypto.randomUUID()}`;
      const probeDatabase = await openDatabase(probeDatabaseName);
      const batchDurationsMs = [];
      try {
        const exactOperationId = crypto.randomUUID();
        await createOperation(probeDatabase, exactOperationId, config);
        let startedAt = performance.now();
        await commitOperation(
          probeDatabase,
          exactOperationId,
          MAX_MANAGED_BYTES,
          1,
        );
        batchDurationsMs.push(performance.now() - startedAt);
        const exactLedger = await requestResult(
          probeDatabase
            .transaction("state", "readonly")
            .objectStore("state")
            .get("managed-full-text-ledger"),
        );

        const overOperationId = crypto.randomUUID();
        await createOperation(probeDatabase, overOperationId, config);
        startedAt = performance.now();
        let overBoundaryRefused = false;
        try {
          await commitOperation(probeDatabase, overOperationId, 1, 1);
        } catch (error) {
          if (error?.message !== "fixture_commit_aborted") {
            throw error;
          }
          overBoundaryRefused = true;
        }
        batchDurationsMs.push(performance.now() - startedAt);
        const afterLedger = await requestResult(
          probeDatabase
            .transaction("state", "readonly")
            .objectStore("state")
            .get("managed-full-text-ledger"),
        );
        const exactOperation = await requestResult(
          probeDatabase
            .transaction("operations", "readonly")
            .objectStore("operations")
            .get(exactOperationId),
        );
        const readbackProgressEventOffsetsMs = [];
        const visible = await readVisibleGraph(database, () => {
          readbackProgressEventOffsetsMs.push(
            performance.now() - context.startedAt,
          );
        });
        return {
          batchDurationsMs,
          progressEventOffsetsMs: [
            ...readbackProgressEventOffsetsMs,
            performance.now() - context.startedAt,
          ],
          readbackVerified:
            exactLedger?.canonicalBytes === MAX_MANAGED_BYTES &&
            exactLedger?.versionCount === 1 &&
            exactOperation?.state === "committed" &&
            overBoundaryRefused &&
            afterLedger?.canonicalBytes === MAX_MANAGED_BYTES &&
            afterLedger?.versionCount === 1 &&
            visible.canonicalBytes === config.expectedCanonicalBytes,
          detail: {
            exactBoundaryCommitted: exactOperation?.state === "committed",
            positiveByteBeyondRefused: overBoundaryRefused,
            existingCanonicalBytes: visible.canonicalBytes,
          },
        };
      } finally {
        probeDatabase.close();
        await deleteDatabase(probeDatabaseName);
        if (!(await confirmDatabaseDeleted(probeDatabaseName))) {
          throw new Error("fixture_capacity_probe_cleanup_failed");
        }
      }
    },
  );
}

async function runAtomicVersionRollback(database, config) {
  return measureOperation(
    database,
    "atomic_version",
    "stable",
    async (context) => {
      const versionId = crypto.randomUUID();
      const startedAt = performance.now();
      const aborted = await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          ["versions", "segments"],
          "readwrite",
        );
        transaction.objectStore("versions").add({
          versionId,
          operationId: "atomic-probe",
          canonicalBytes: 2,
          segmentCount: 1,
          visible: false,
        });
        transaction.objectStore("segments").add({
          versionId,
          ordinal: 0,
          operationId: "atomic-probe",
          text: "合成",
          canonicalBytes: 1,
        });
        transaction.abort();
        transaction.onabort = () => resolve(true);
        transaction.oncomplete = () => resolve(false);
        transaction.onerror = (event) => {
          event.preventDefault();
        };
      });
      const duration = performance.now() - startedAt;
      const [version, segment] = await Promise.all([
        requestResult(
          database
            .transaction("versions", "readonly")
            .objectStore("versions")
            .get(versionId),
        ),
        requestResult(
          database
            .transaction("segments", "readonly")
            .objectStore("segments")
            .get([versionId, 0]),
        ),
      ]);
      const readbackProgressEventOffsetsMs = [];
      const visible = await readVisibleGraph(database, () => {
        readbackProgressEventOffsetsMs.push(
          performance.now() - context.startedAt,
        );
      });
      return {
        batchDurationsMs: [duration],
        progressEventOffsetsMs: [
          ...readbackProgressEventOffsetsMs,
          performance.now() - context.startedAt,
        ],
        readbackVerified:
          aborted &&
          version === undefined &&
          segment === undefined &&
          visible.canonicalBytes === config.expectedCanonicalBytes,
        detail: { transactionAborted: aborted, visibleRowsAfterFailure: 0 },
      };
    },
  );
}

async function runCancellation(database, config) {
  return measureOperation(
    database,
    "cancellation",
    "stable",
    async (context) => {
      const operationId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      await createOperation(database, operationId, config);
      await transactionPromise(database, ["versions"], (transaction) => {
        transaction.objectStore("versions").add({
          versionId,
          operationId,
          canonicalBytes: 0,
          segmentCount: 0,
          visible: false,
        });
      });
      const controller = new AbortController();
      let signalCancellationReady;
      const cancellationReady = new Promise((resolve) => {
        signalCancellationReady = resolve;
      });
      const copyTask = copySegmentsUntilCancelled(database, {
        candidate: config.candidate,
        context,
        operationId,
        signal: controller.signal,
        versionId,
        onBatch(batchCount) {
          if (batchCount === 2) {
            signalCancellationReady();
          }
        },
      });
      await Promise.race([
        cancellationReady,
        copyTask.then((result) => {
          if (result.batchCount < 2) {
            throw new Error("fixture_cancellation_probe_too_small");
          }
        }),
      ]);
      const cancellationRequestedAt = performance.now();
      controller.abort();
      const copyResult = await copyTask;
      if (copyResult.cancellationAcknowledgedAt === null) {
        throw new Error("fixture_cancellation_not_acknowledged");
      }
      const progressEventOffsetsMs = [
        ...copyResult.progressEventOffsetsMs,
        copyResult.cancellationAcknowledgedAt - context.startedAt,
      ];
      const writesAtAcknowledgement = await countOperationSegments(
        database,
        operationId,
      );
      const writesAfterWait = await observePostCancellationWrites(
        database,
        operationId,
        context.startedAt,
        progressEventOffsetsMs,
      );
      const visibleBeforeCleanup = await readVisibleGraph(database, () => {
        progressEventOffsetsMs.push(performance.now() - context.startedAt);
      });
      const cleanup = await cleanupStagedOperation(
        database,
        operationId,
        versionId,
        config.candidate,
        context.startedAt,
      );
      progressEventOffsetsMs.push(...cleanup.progressEventOffsetsMs);
      const rowsAfterCleanup = await countOperationSegments(
        database,
        operationId,
      );
      const visible = await readVisibleGraph(database, () => {
        progressEventOffsetsMs.push(performance.now() - context.startedAt);
      });
      return {
        batchDurationsMs: [
          ...copyResult.batchDurationsMs,
          ...cleanup.batchDurationsMs,
        ],
        progressEventOffsetsMs,
        cancellation: {
          attempted: true,
          acknowledgementMs:
            copyResult.cancellationAcknowledgedAt - cancellationRequestedAt,
          writesAfterTwoSeconds: writesAfterWait - writesAtAcknowledgement,
        },
        readbackVerified:
          writesAfterWait === writesAtAcknowledgement &&
          rowsAfterCleanup === 0 &&
          visibleBeforeCleanup.canonicalBytes ===
            config.expectedCanonicalBytes &&
          visible.canonicalBytes === config.expectedCanonicalBytes,
        detail: {
          stagedBatchCount: copyResult.batchCount,
          writesAtAcknowledgement,
          writesAfterWait,
          rowsAfterCleanup,
        },
      };
    },
  );
}

async function copySegmentsUntilCancelled(database, options) {
  const batchDurationsMs = [];
  const progressEventOffsetsMs = [];
  let lastKey;
  let nextOrdinal = 0;
  let stagedCanonicalBytes = 0;
  let cancellationAcknowledgedAt = null;
  while (true) {
    if (options.signal.aborted) {
      cancellationAcknowledgedAt = performance.now();
      break;
    }
    const source = await readStoreBatch(
      database,
      "segments",
      options.candidate,
      lastKey,
      (value) => value.operationId === null,
    );
    if (options.signal.aborted) {
      cancellationAcknowledgedAt = performance.now();
      break;
    }
    if (source.values.length === 0) {
      break;
    }
    const startedAt = performance.now();
    await transactionPromise(
      database,
      ["segments", "versions"],
      (transaction) => {
        const segments = transaction.objectStore("segments");
        for (const value of source.values) {
          segments.add({
            ...value,
            versionId: options.versionId,
            ordinal: nextOrdinal,
            operationId: options.operationId,
          });
          nextOrdinal += 1;
          stagedCanonicalBytes += value.canonicalBytes;
        }
        transaction.objectStore("versions").put({
          versionId: options.versionId,
          operationId: options.operationId,
          canonicalBytes: stagedCanonicalBytes,
          segmentCount: nextOrdinal,
          visible: false,
        });
      },
    );
    batchDurationsMs.push(performance.now() - startedAt);
    lastKey = source.keys.at(-1);
    progressEventOffsetsMs.push(performance.now() - options.context.startedAt);
    options.context.metrics.sampleHeap();
    options.onBatch?.(batchDurationsMs.length);
    if (source.done) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    batchCount: batchDurationsMs.length,
    batchDurationsMs,
    cancellationAcknowledgedAt,
    progressEventOffsetsMs,
  };
}

async function observePostCancellationWrites(
  database,
  operationId,
  operationStartedAt,
  progressEventOffsetsMs,
) {
  const observationStartedAt = performance.now();
  let writes = await countOperationSegments(database, operationId);
  while (performance.now() - observationStartedAt < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    writes = await countOperationSegments(database, operationId);
    progressEventOffsetsMs.push(performance.now() - operationStartedAt);
  }
  return writes;
}

async function countOperationSegments(database, operationId) {
  const store = database
    .transaction("segments", "readonly")
    .objectStore("segments");
  return requestResult(
    store.index("operationId").count(IDBKeyRange.only(operationId)),
  );
}

async function cleanupStagedOperation(
  database,
  operationId,
  versionId,
  candidate,
  startedAt,
) {
  const segments = await scanIndexInBatches(
    database,
    "segments",
    "operationId",
    operationId,
    candidate,
    {
      startedAt,
      visitBatch: (batch) => deleteKeys(database, "segments", batch.keys),
    },
  );
  const metadataStartedAt = performance.now();
  await transactionPromise(
    database,
    ["versions", "operations"],
    (transaction) => {
      transaction.objectStore("versions").delete(versionId);
      transaction.objectStore("operations").delete(operationId);
    },
  );
  return {
    batchDurationsMs: [
      ...segments.batchDurationsMs,
      performance.now() - metadataStartedAt,
    ],
    progressEventOffsetsMs: [
      ...segments.progressEventOffsetsMs,
      performance.now() - startedAt,
    ],
  };
}

async function runSelectedVersionRemoval(database, config) {
  return measureOperation(
    database,
    "selected_version_removal",
    "stable",
    async (context) => {
      const selected = await firstVisibleVersion(database);
      if (!selected) {
        throw new Error("fixture_selected_version_missing");
      }
      const batchDurationsMs = [];
      let startedAt = performance.now();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          ["versions", "state"],
          "readwrite",
        );
        const versions = transaction.objectStore("versions");
        const state = transaction.objectStore("state");
        const ledgerRequest = state.get("managed-full-text-ledger");
        ledgerRequest.onsuccess = () => {
          const ledger = ledgerRequest.result;
          if (
            !ledger ||
            ledger.canonicalBytes < selected.canonicalBytes ||
            ledger.versionCount < 1
          ) {
            transaction.abort();
            return;
          }
          versions.put({ ...selected, visible: false });
          state.put({
            ...ledger,
            canonicalBytes: ledger.canonicalBytes - selected.canonicalBytes,
            versionCount: ledger.versionCount - 1,
          });
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(new Error("fixture_selected_version_hide_failed"));
        transaction.onerror = () =>
          reject(new Error("fixture_selected_version_hide_failed"));
      });
      batchDurationsMs.push(performance.now() - startedAt);
      const deletedSegments = await scanIndexInBatches(
        database,
        "segments",
        "versionId",
        selected.versionId,
        config.candidate,
        {
          startedAt: context.startedAt,
          visitBatch: (batch) => deleteKeys(database, "segments", batch.keys),
        },
      );
      startedAt = performance.now();
      await transactionPromise(database, ["versions"], (transaction) => {
        transaction.objectStore("versions").delete(selected.versionId);
      });
      batchDurationsMs.push(performance.now() - startedAt);
      const readbackProgressEventOffsetsMs = [];
      const visible = await readVisibleGraph(database, () => {
        readbackProgressEventOffsetsMs.push(
          performance.now() - context.startedAt,
        );
      });
      const ledger = await requestResult(
        database
          .transaction("state", "readonly")
          .objectStore("state")
          .get("managed-full-text-ledger"),
      );
      return {
        batchDurationsMs: [
          ...batchDurationsMs,
          ...deletedSegments.batchDurationsMs,
        ],
        progressEventOffsetsMs: [
          ...deletedSegments.progressEventOffsetsMs,
          ...readbackProgressEventOffsetsMs,
          performance.now() - context.startedAt,
        ],
        readbackVerified:
          deletedSegments.totalCount === selected.segmentCount &&
          visible.versionCount === config.expectedVersionCount - 1 &&
          visible.segmentCount ===
            config.expectedSegmentCount - selected.segmentCount &&
          visible.canonicalBytes ===
            config.expectedCanonicalBytes - selected.canonicalBytes &&
          ledger?.canonicalBytes === visible.canonicalBytes &&
          ledger?.versionCount === visible.versionCount,
        detail: {
          removedCanonicalBytes: selected.canonicalBytes,
          removedSegmentCount: selected.segmentCount,
          remaining: visible,
        },
      };
    },
  );
}

function firstVisibleVersion(database) {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("versions", "readonly")
      .objectStore("versions")
      .openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      if (cursor.value.visible === true) {
        resolve(cursor.value);
        return;
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(new Error("fixture_visible_version_lookup_failed"));
  });
}

async function runFullClear(database, config) {
  return measureOperation(database, "full_clear", "stable", async (context) => {
    const batchDurationsMs = [];
    let startedAt = performance.now();
    await transactionPromise(database, ["state"], (transaction) => {
      const state = transaction.objectStore("state");
      state.put({ id: "visibility", hideAll: true });
      state.put({
        id: "managed-full-text-ledger",
        canonicalBytes: 0,
        versionCount: 0,
      });
    });
    batchDurationsMs.push(performance.now() - startedAt);
    const segments = await scanStoreInBatches(
      database,
      "segments",
      config.candidate,
      {
        startedAt: context.startedAt,
        visitBatch: (batch) => deleteKeys(database, "segments", batch.keys),
      },
    );
    const versions = await scanStoreInBatches(
      database,
      "versions",
      config.candidate,
      {
        startedAt: context.startedAt,
        visitBatch: (batch) => deleteKeys(database, "versions", batch.keys),
      },
    );
    startedAt = performance.now();
    await transactionPromise(
      database,
      ["operations", "state"],
      (transaction) => {
        transaction.objectStore("operations").clear();
        transaction
          .objectStore("state")
          .put({ id: "visibility", hideAll: false });
      },
    );
    batchDurationsMs.push(performance.now() - startedAt);
    const [visible, versionCount, segmentCount, operationCount, ledger] =
      await Promise.all([
        readVisibleGraph(database, () => {
          versions.progressEventOffsetsMs.push(
            performance.now() - context.startedAt,
          );
        }),
        getStoreCount(database, "versions"),
        getStoreCount(database, "segments"),
        getStoreCount(database, "operations"),
        requestResult(
          database
            .transaction("state", "readonly")
            .objectStore("state")
            .get("managed-full-text-ledger"),
        ),
      ]);
    return {
      batchDurationsMs: [
        ...batchDurationsMs,
        ...segments.batchDurationsMs,
        ...versions.batchDurationsMs,
      ],
      progressEventOffsetsMs: [
        ...segments.progressEventOffsetsMs,
        ...versions.progressEventOffsetsMs,
        performance.now() - context.startedAt,
      ],
      readbackVerified:
        visible.versionCount === 0 &&
        visible.segmentCount === 0 &&
        visible.canonicalBytes === 0 &&
        versionCount === 0 &&
        segmentCount === 0 &&
        operationCount === 0 &&
        ledger?.canonicalBytes === 0 &&
        ledger?.versionCount === 0,
      detail: { versionCount, segmentCount, operationCount },
    };
  });
}

async function runQuotaFailure(database, config) {
  return measureOperation(
    database,
    "quota_failure",
    "stable",
    async (context) => {
      const startedAt = performance.now();
      const estimate = await readStorageEstimate();
      const beforeCounts = await Promise.all([
        getStoreCount(database, "versions"),
        getStoreCount(database, "segments"),
      ]);
      const availableBytes =
        estimate === null
          ? null
          : Math.max(0, estimate.quotaBytes - estimate.usageBytes);
      const requestedBytes =
        availableBytes === null ? null : availableBytes + 1;
      const refusalProbe =
        availableBytes === null
          ? {
              allowed: false,
              refusedBeforeWrite: false,
              artifactFetchAttempted: false,
            }
          : await beginRestoreAfterPreflight(
              config.restoreArtifactUrl,
              availableBytes,
              requestedBytes,
            );
      const afterCounts = await Promise.all([
        getStoreCount(database, "versions"),
        getStoreCount(database, "segments"),
      ]);
      return {
        batchDurationsMs: [performance.now() - startedAt],
        progressEventOffsetsMs: [performance.now() - context.startedAt],
        readbackVerified:
          refusalProbe.refusedBeforeWrite &&
          !refusalProbe.artifactFetchAttempted &&
          beforeCounts[0] === afterCounts[0] &&
          beforeCounts[1] === afterCounts[1] &&
          afterCounts[0] === config.expectedVersionCount &&
          afterCounts[1] === config.expectedSegmentCount,
        detail: {
          metricAvailable: estimate !== null,
          availableBytes,
          requestedBytes,
          refusedBeforeWrite: refusalProbe.refusedBeforeWrite,
          artifactFetchAttempted: refusalProbe.artifactFetchAttempted,
        },
      };
    },
  );
}

async function beginRestoreAfterPreflight(
  artifactUrl,
  availableFreeQuotaBytes,
  requiredFreeQuotaBytes,
  options = {},
) {
  const allowed = restorePreflightAllows(
    availableFreeQuotaBytes,
    requiredFreeQuotaBytes,
  );
  if (!allowed) {
    return {
      allowed: false,
      refusedBeforeWrite: true,
      artifactFetchAttempted: false,
    };
  }
  const response = await fetch(artifactUrl, {
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok || !response.body) {
    throw new Error("fixture_restore_fetch_failed");
  }
  if (!options.retainResponse) {
    await response.body.cancel();
  }
  return {
    allowed: true,
    refusedBeforeWrite: false,
    artifactFetchAttempted: true,
    response: options.retainResponse ? response : null,
  };
}

function getStoreCount(database, storeName) {
  return requestResult(
    database.transaction(storeName, "readonly").objectStore(storeName).count(),
  );
}

async function measureOperation(database, operation, expectedDirection, task) {
  const storageBefore = await readStorageEstimate();
  const metrics = startBrowserMetrics();
  const startedAt = performance.now();
  const result = await task({ startedAt, metrics });
  const progressEventOffsetsMs = result.progressEventOffsetsMs;
  const ledgerConsistency = await readLedgerConsistency(database, () => {
    progressEventOffsetsMs.push(performance.now() - startedAt);
  });
  const totalDurationMs = performance.now() - startedAt;
  const storageAfter =
    expectedDirection === "increase" || expectedDirection === "decrease"
      ? await waitForStorageChange(storageBefore, expectedDirection)
      : await readStorageEstimate();
  const browserMetrics = metrics.stop();
  return {
    operation,
    expectedDirection,
    totalDurationMs,
    batchDurationsMs: result.batchDurationsMs,
    progressEventOffsetsMs: normalizeProgressEvents(
      progressEventOffsetsMs,
      totalDurationMs,
    ),
    cancellation: result.cancellation ?? { attempted: false },
    restart: { attempted: false },
    mainThread: browserMetrics.mainThreadMetricAvailable
      ? {
          metricAvailable: true,
          maximumTaskMs: browserMetrics.mainThreadMaxTaskMs,
        }
      : { metricAvailable: false, reasonCode: "browser_metric_unavailable" },
    memory: browserMetrics.heapMetricAvailable
      ? {
          metricAvailable: true,
          peakHeapGrowthBytes: browserMetrics.peakHeapGrowthBytes,
        }
      : { metricAvailable: false, reasonCode: "browser_metric_unavailable" },
    storageBefore,
    storageAfter,
    ledgerConsistencyVerified: ledgerConsistency.matches,
    readbackVerified: result.readbackVerified && ledgerConsistency.matches,
    detail: {
      ...(result.detail ?? {}),
      ledgerCanonicalBytes: ledgerConsistency.ledgerCanonicalBytes,
      visibleCanonicalBytes: ledgerConsistency.visibleCanonicalBytes,
      ledgerVersionCount: ledgerConsistency.ledgerVersionCount,
      visibleVersionCount: ledgerConsistency.visibleVersionCount,
    },
  };
}

function normalizeProgressEvents(offsets, totalDurationMs) {
  return [
    ...new Set(
      offsets.filter(
        (offset) =>
          Number.isFinite(offset) && offset >= 0 && offset <= totalDurationMs,
      ),
    ),
  ].sort((left, right) => left - right);
}

async function confirmDatabaseDeleted(databaseName) {
  if (typeof indexedDB.databases !== "function") {
    return false;
  }
  const databases = await indexedDB.databases();
  return !databases.some((database) => database.name === databaseName);
}

async function writeFixture(
  database,
  operationId,
  config,
  metrics,
  preparedResponse = null,
) {
  const response =
    preparedResponse ??
    (await fetch(config.artifactUrl, {
      cache: "no-store",
      credentials: "omit",
    }));
  if (!response.ok || !response.body) {
    throw new Error("fixture_fetch_failed");
  }
  const startedAt = performance.now();
  const batchDurationsMs = [];
  const progressEventOffsetsMs = [];
  let lastProgressAt = startedAt;
  let commands = [];
  let batchBytes = 0;
  let batchRecordCount = 0;
  let recordCount = 0;
  let canonicalBytes = 0;
  let currentVersionId = null;
  let currentVersionBytes = 0;

  const flush = async () => {
    if (commands.length === 0) {
      return;
    }
    const batchStartedAt = performance.now();
    await writeCommands(database, operationId, commands);
    batchDurationsMs.push(performance.now() - batchStartedAt);
    commands = [];
    batchBytes = 0;
    batchRecordCount = 0;
    const now = performance.now();
    if (now - lastProgressAt >= 1_000) {
      progressEventOffsetsMs.push(now - startedAt);
      lastProgressAt = now;
    }
    metrics.sampleHeap();
  };

  for await (const line of readLines(response.body)) {
    const lineBytes = TEXT_ENCODER.encode(`${line}\n`).byteLength;
    assertFixtureRecordFitsCandidate(config.candidate, lineBytes);
    const record = parseFixtureLine(line);
    if (
      shouldFlushFixtureBatch(
        config.candidate,
        batchRecordCount,
        batchBytes,
        lineBytes,
      )
    ) {
      await flush();
    }
    if (record.record === "version") {
      if (currentVersionId !== null) {
        commands.push({
          kind: "finalize",
          versionId: currentVersionId,
          canonicalBytes: currentVersionBytes,
        });
      }
      currentVersionId = record.versionId;
      currentVersionBytes = lineBytes;
      commands.push({ kind: "version", record, lineBytes });
    } else {
      if (currentVersionId === null) {
        throw new Error("fixture_segment_before_version");
      }
      currentVersionBytes += lineBytes;
      commands.push({
        kind: "segment",
        record,
        versionId: currentVersionId,
        lineBytes,
      });
    }
    batchBytes += lineBytes;
    batchRecordCount += 1;
    recordCount += 1;
    canonicalBytes += lineBytes;
    if (
      batchRecordCount >= config.candidate.recordCap ||
      batchBytes >= config.candidate.byteCapBytes
    ) {
      await flush();
    }
  }
  if (currentVersionId !== null) {
    commands.push({
      kind: "finalize",
      versionId: currentVersionId,
      canonicalBytes: currentVersionBytes,
    });
  }
  await flush();
  return {
    totalDurationMs: performance.now() - startedAt,
    batchDurationsMs,
    progressEventOffsetsMs,
    recordCount,
    canonicalBytes,
  };
}

export function shouldFlushFixtureBatch(
  candidate,
  batchRecordCount,
  batchBytes,
  nextRecordBytes,
) {
  return (
    batchRecordCount > 0 &&
    (batchRecordCount >= candidate.recordCap ||
      batchBytes + nextRecordBytes > candidate.byteCapBytes)
  );
}

export function assertFixtureRecordFitsCandidate(candidate, recordBytes) {
  if (
    !Number.isSafeInteger(recordBytes) ||
    recordBytes < 1 ||
    recordBytes > candidate.byteCapBytes
  ) {
    throw new Error("fixture_record_exceeds_candidate_byte_cap");
  }
}

function writeCommands(database, operationId, commands) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      ["versions", "segments", "operations"],
      "readwrite",
    );
    const versions = transaction.objectStore("versions");
    const segments = transaction.objectStore("segments");
    const operations = transaction.objectStore("operations");
    for (const command of commands) {
      if (command.kind === "version") {
        versions.put({
          ...command.record,
          operationId,
          canonicalBytes: 0,
          normalized: false,
        });
      } else if (command.kind === "segment") {
        segments.put({
          versionId: command.versionId,
          ordinal: command.record.ordinal,
          operationId,
          startSeconds: command.record.startSeconds,
          endSeconds: command.record.endSeconds,
          text: command.record.text,
          canonicalBytes: command.lineBytes,
        });
      } else if (command.kind === "finalize") {
        const request = versions.get(command.versionId);
        request.onsuccess = () => {
          if (!request.result) {
            transaction.abort();
            return;
          }
          versions.put({
            ...request.result,
            canonicalBytes: command.canonicalBytes,
          });
        };
      }
    }
    const operationRequest = operations.get(operationId);
    operationRequest.onsuccess = () => {
      if (!operationRequest.result) {
        transaction.abort();
        return;
      }
      operations.put({
        ...operationRequest.result,
        committedBatchCount: operationRequest.result.committedBatchCount + 1,
        updatedAtEpochMs: Date.now(),
      });
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error("fixture_batch_aborted"));
    transaction.onerror = () => reject(new Error("fixture_batch_failed"));
  });
}

function createOperation(database, operationId, config) {
  return transactionPromise(database, ["operations"], (transaction) => {
    transaction.objectStore("operations").add({
      id: operationId,
      fixtureId: config.fixtureId,
      state: "staged",
      committedBatchCount: 0,
      createdAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
    });
  });
}

function commitOperation(database, operationId, canonicalBytes, versionCount) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      ["operations", "state"],
      "readwrite",
    );
    const operations = transaction.objectStore("operations");
    const state = transaction.objectStore("state");
    const operationRequest = operations.get(operationId);
    const ledgerRequest = state.get("managed-full-text-ledger");
    let operation;
    let ledger;
    const commitWhenReady = () => {
      if (operation === undefined || ledger === undefined) {
        return;
      }
      const nextBytes = ledger.canonicalBytes + canonicalBytes;
      if (!canCommitCanonicalBytes(ledger.canonicalBytes, canonicalBytes)) {
        transaction.abort();
        return;
      }
      operations.put({
        ...operation,
        state: "committed",
        updatedAtEpochMs: Date.now(),
      });
      state.put({
        id: "managed-full-text-ledger",
        canonicalBytes: nextBytes,
        versionCount: ledger.versionCount + versionCount,
      });
    };
    operationRequest.onsuccess = () => {
      operation = operationRequest.result ?? null;
      if (!operation) {
        transaction.abort();
        return;
      }
      commitWhenReady();
    };
    ledgerRequest.onsuccess = () => {
      ledger = ledgerRequest.result ?? {
        id: "managed-full-text-ledger",
        canonicalBytes: 0,
        versionCount: 0,
      };
      commitWhenReady();
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error("fixture_commit_aborted"));
    transaction.onerror = () => reject(new Error("fixture_commit_failed"));
  });
}

function canCommitCanonicalBytes(
  currentCanonicalBytes,
  additionalCanonicalBytes,
) {
  return (
    Number.isSafeInteger(currentCanonicalBytes) &&
    currentCanonicalBytes >= 0 &&
    Number.isSafeInteger(additionalCanonicalBytes) &&
    additionalCanonicalBytes >= 0 &&
    currentCanonicalBytes + additionalCanonicalBytes <= MAX_MANAGED_BYTES
  );
}

async function readVisibleGraph(database, onProgress = null) {
  const reportCursorProgress = createCursorProgressReporter(onProgress);
  const visibility = await requestResult(
    database
      .transaction("state", "readonly")
      .objectStore("state")
      .get("visibility"),
  );
  if (visibility?.hideAll === true) {
    return { versionCount: 0, segmentCount: 0, canonicalBytes: 0 };
  }
  const committedOperationIds = await collectCommittedOperationIds(
    database.transaction("operations", "readonly").objectStore("operations"),
    reportCursorProgress,
  );
  const versions = await collectVisibleVersions(
    database.transaction("versions", "readonly").objectStore("versions"),
    committedOperationIds,
    reportCursorProgress,
  );
  const segmentCount =
    versions.versionIds.length === 0
      ? 0
      : await countVisibleSegments(
          database.transaction("segments", "readonly").objectStore("segments"),
          new Set(versions.versionIds),
          reportCursorProgress,
        );
  return {
    versionCount: versions.versionIds.length,
    segmentCount,
    canonicalBytes: versions.canonicalBytes,
  };
}

function createCursorProgressReporter(onProgress) {
  let lastProgressAt = performance.now();
  return () => {
    if (typeof onProgress !== "function") {
      return;
    }
    const now = performance.now();
    if (now - lastProgressAt >= 500) {
      lastProgressAt = now;
      onProgress();
    }
  };
}

async function readLedgerConsistency(database, onProgress = null) {
  const reportCursorProgress = createCursorProgressReporter(onProgress);
  const visibility = await requestResult(
    database
      .transaction("state", "readonly")
      .objectStore("state")
      .get("visibility"),
  );
  const ledger = await requestResult(
    database
      .transaction("state", "readonly")
      .objectStore("state")
      .get("managed-full-text-ledger"),
  );
  let visibleVersionCount = 0;
  let visibleCanonicalBytes = 0;
  if (visibility?.hideAll !== true) {
    const committedOperationIds = await collectCommittedOperationIds(
      database.transaction("operations", "readonly").objectStore("operations"),
      reportCursorProgress,
    );
    const versions = await collectVisibleVersions(
      database.transaction("versions", "readonly").objectStore("versions"),
      committedOperationIds,
      reportCursorProgress,
    );
    visibleVersionCount = versions.versionIds.length;
    visibleCanonicalBytes = versions.canonicalBytes;
  }
  const ledgerCanonicalBytes = ledger?.canonicalBytes ?? 0;
  const ledgerVersionCount = ledger?.versionCount ?? 0;
  return {
    matches:
      ledgerCanonicalBytes === visibleCanonicalBytes &&
      ledgerVersionCount === visibleVersionCount,
    ledgerCanonicalBytes,
    visibleCanonicalBytes,
    ledgerVersionCount,
    visibleVersionCount,
  };
}

function collectCommittedOperationIds(store, reportProgress = null) {
  return new Promise((resolve, reject) => {
    const ids = new Set();
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(ids);
        return;
      }
      if (["committed", "normalized"].includes(cursor.value.state)) {
        ids.add(cursor.value.id);
      }
      reportProgress?.();
      cursor.continue();
    };
    request.onerror = () => reject(new Error("fixture_operation_scan_failed"));
  });
}

function collectVisibleVersions(
  store,
  committedOperationIds,
  reportProgress = null,
) {
  return new Promise((resolve, reject) => {
    const versionIds = [];
    let canonicalBytes = 0;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ versionIds, canonicalBytes });
        return;
      }
      if (
        cursor.value.visible === true ||
        committedOperationIds.has(cursor.value.operationId)
      ) {
        versionIds.push(cursor.value.versionId);
        canonicalBytes += cursor.value.canonicalBytes;
      }
      reportProgress?.();
      cursor.continue();
    };
    request.onerror = () => reject(new Error("fixture_version_sum_failed"));
  });
}

function countVisibleSegments(store, visibleVersionIds, reportProgress = null) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(count);
        return;
      }
      if (visibleVersionIds.has(cursor.value.versionId)) {
        count += 1;
      }
      reportProgress?.();
      cursor.continue();
    };
    request.onerror = () => reject(new Error("fixture_segment_scan_failed"));
  });
}

async function scanStoreInBatches(
  database,
  storeName,
  candidate,
  options = {},
) {
  const batches = [];
  const progressEventOffsetsMs = [];
  const startedAt = options.startedAt ?? performance.now();
  let lastKey;
  let totalCount = 0;
  let totalCanonicalBytes = 0;
  let previousKey;
  while (true) {
    const batchStartedAt = performance.now();
    const batch = await readStoreBatch(
      database,
      storeName,
      candidate,
      lastKey,
      options.filter,
    );
    if (batch.values.length === 0) {
      break;
    }
    for (let index = 0; index < batch.keys.length; index += 1) {
      const key = batch.keys[index];
      if (previousKey !== undefined && indexedDB.cmp(previousKey, key) >= 0) {
        throw new Error("fixture_ordered_scan_regressed");
      }
      previousKey = key;
      const value = batch.values[index];
      totalCount += 1;
      totalCanonicalBytes +=
        options.byteSelector?.(value) ?? value.canonicalBytes ?? 0;
    }
    if (options.visitBatch) {
      await options.visitBatch(batch);
    }
    batches.push(performance.now() - batchStartedAt);
    lastKey = batch.keys.at(-1);
    progressEventOffsetsMs.push(performance.now() - startedAt);
    if (batch.done) {
      break;
    }
  }
  return {
    batchDurationsMs: batches,
    progressEventOffsetsMs,
    totalCount,
    totalCanonicalBytes,
  };
}

async function scanIndexInBatches(
  database,
  storeName,
  indexName,
  indexValue,
  candidate,
  options = {},
) {
  const batches = [];
  const progressEventOffsetsMs = [];
  const startedAt = options.startedAt ?? performance.now();
  let lastPrimaryKey;
  let totalCount = 0;
  let totalCanonicalBytes = 0;
  while (true) {
    const batchStartedAt = performance.now();
    const batch = await readIndexBatch(
      database,
      storeName,
      indexName,
      indexValue,
      candidate,
      lastPrimaryKey,
    );
    if (batch.values.length === 0) {
      break;
    }
    for (const value of batch.values) {
      totalCount += 1;
      totalCanonicalBytes +=
        options.byteSelector?.(value) ?? value.canonicalBytes ?? 0;
    }
    if (options.visitBatch) {
      await options.visitBatch(batch);
    }
    batches.push(performance.now() - batchStartedAt);
    lastPrimaryKey = batch.keys.at(-1);
    progressEventOffsetsMs.push(performance.now() - startedAt);
    if (batch.done) {
      break;
    }
  }
  return {
    batchDurationsMs: batches,
    progressEventOffsetsMs,
    totalCount,
    totalCanonicalBytes,
  };
}

function readIndexBatch(
  database,
  storeName,
  indexName,
  indexValue,
  candidate,
  lastPrimaryKey,
) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const index = transaction.objectStore(storeName).index(indexName);
    const request = index.openCursor(IDBKeyRange.only(indexValue));
    const values = [];
    const keys = [];
    let canonicalBytes = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ values, keys, done: true });
        return;
      }
      if (
        lastPrimaryKey !== undefined &&
        indexedDB.cmp(cursor.primaryKey, lastPrimaryKey) <= 0
      ) {
        cursor.continue();
        return;
      }
      const value = cursor.value;
      const valueBytes = value.canonicalBytes ?? 0;
      if (
        values.length > 0 &&
        (values.length >= candidate.recordCap ||
          canonicalBytes + valueBytes > candidate.byteCapBytes)
      ) {
        resolve({ values, keys, done: false });
        return;
      }
      values.push(value);
      keys.push(cursor.primaryKey);
      canonicalBytes += valueBytes;
      cursor.continue();
    };
    request.onerror = () =>
      reject(new Error("fixture_bounded_index_scan_failed"));
    transaction.onabort = () =>
      reject(new Error("fixture_bounded_index_scan_aborted"));
  });
}

function readStoreBatch(database, storeName, candidate, lastKey, filter) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const range =
      lastKey === undefined ? undefined : IDBKeyRange.lowerBound(lastKey, true);
    const request = store.openCursor(range);
    const values = [];
    const keys = [];
    let canonicalBytes = 0;
    let done = false;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        done = true;
        resolve({ values, keys, done });
        return;
      }
      const value = cursor.value;
      if (filter && !filter(value)) {
        cursor.continue();
        return;
      }
      const valueBytes = value.canonicalBytes ?? 0;
      if (
        values.length > 0 &&
        (values.length >= candidate.recordCap ||
          canonicalBytes + valueBytes > candidate.byteCapBytes)
      ) {
        resolve({ values, keys, done: false });
        return;
      }
      values.push(value);
      keys.push(cursor.primaryKey);
      canonicalBytes += valueBytes;
      cursor.continue();
    };
    request.onerror = () => reject(new Error("fixture_bounded_scan_failed"));
    transaction.onabort = () =>
      reject(new Error("fixture_bounded_scan_aborted"));
  });
}

function updateValues(database, storeName, values, transform) {
  const startedAt = performance.now();
  return transactionPromise(database, [storeName], (transaction) => {
    const store = transaction.objectStore(storeName);
    for (const value of values) {
      store.put(transform(value));
    }
  }).then(() => performance.now() - startedAt);
}

function deleteKeys(database, storeName, keys) {
  const startedAt = performance.now();
  return transactionPromise(database, [storeName], (transaction) => {
    const store = transaction.objectStore(storeName);
    for (const key of keys) {
      store.delete(key);
    }
  }).then(() => performance.now() - startedAt);
}

async function* readLines(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      carry += decoder.decode(value, { stream: !done });
      let newlineIndex;
      while ((newlineIndex = carry.indexOf("\n")) >= 0) {
        const line = carry.slice(0, newlineIndex);
        carry = carry.slice(newlineIndex + 1);
        if (line) {
          yield line;
        }
      }
      if (done) {
        break;
      }
    }
    if (carry) {
      throw new Error("fixture_missing_trailing_newline");
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFixtureLine(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    throw new Error("fixture_json_invalid");
  }
  if (
    record?.contract !== "managed-full-text-v1" ||
    !["version", "segment"].includes(record.record)
  ) {
    throw new Error("fixture_record_contract_invalid");
  }
  return record;
}

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const versions = database.createObjectStore("versions", {
        keyPath: "versionId",
      });
      versions.createIndex("operationId", "operationId", { unique: false });
      const segments = database.createObjectStore("segments", {
        keyPath: ["versionId", "ordinal"],
      });
      segments.createIndex("operationId", "operationId", { unique: false });
      segments.createIndex("versionId", "versionId", { unique: false });
      database.createObjectStore("operations", { keyPath: "id" });
      database.createObjectStore("state", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("fixture_database_open_failed"));
    request.onblocked = () =>
      reject(new Error("fixture_database_open_blocked"));
  });
}

function transactionPromise(database, stores, enqueue) {
  const transaction = database.transaction(stores, "readwrite");
  enqueue(transaction);
  return transactionDone(transaction);
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(new Error("fixture_transaction_aborted"));
    transaction.onerror = () => reject(new Error("fixture_transaction_failed"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("fixture_request_failed"));
  });
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new Error("fixture_database_cleanup_failed"));
    request.onblocked = () =>
      reject(new Error("fixture_database_cleanup_blocked"));
  });
}

async function readStorageEstimate() {
  if (typeof navigator.storage?.estimate !== "function") {
    return null;
  }
  const estimate = await navigator.storage.estimate();
  if (!Number.isFinite(estimate.usage) || !Number.isFinite(estimate.quota)) {
    return null;
  }
  return {
    usageBytes: Math.round(estimate.usage),
    quotaBytes: Math.round(estimate.quota),
  };
}

async function waitForStorageChange(reference, direction) {
  let latest = await readStorageEstimate();
  if (reference === null || latest === null) {
    return latest;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const changed =
      direction === "increase"
        ? latest.usageBytes > reference.usageBytes
        : latest.usageBytes < reference.usageBytes;
    if (changed) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    latest = await readStorageEstimate();
    if (latest === null) {
      return null;
    }
  }
  return latest;
}

function startBrowserMetrics() {
  const heapStart = readHeapUsedBytes();
  let heapPeak = heapStart;
  let mainThreadMaxTaskMs = LONG_TASK_REPORTING_THRESHOLD_MS;
  let observer = null;
  const recordLongTasks = (entries) => {
    for (const entry of entries) {
      mainThreadMaxTaskMs = Math.max(mainThreadMaxTaskMs, entry.duration);
    }
  };
  if (typeof PerformanceObserver === "function") {
    try {
      observer = new PerformanceObserver((list) => {
        recordLongTasks(list.getEntries());
      });
      observer.observe({ type: "longtask" });
    } catch {
      observer = null;
    }
  }
  return {
    sampleHeap() {
      const value = readHeapUsedBytes();
      if (value !== null && (heapPeak === null || value > heapPeak)) {
        heapPeak = value;
      }
    },
    stop() {
      this.sampleHeap();
      if (observer !== null) {
        recordLongTasks(observer.takeRecords());
      }
      observer?.disconnect();
      return {
        heapMetricAvailable: heapStart !== null && heapPeak !== null,
        peakHeapGrowthBytes:
          heapStart === null || heapPeak === null
            ? null
            : Math.max(0, heapPeak - heapStart),
        mainThreadMetricAvailable: observer !== null,
        mainThreadMaxTaskMs,
      };
    },
  };
}

function readHeapUsedBytes() {
  const value = performance.memory?.usedJSHeapSize;
  return Number.isFinite(value) ? Math.round(value) : null;
}

function validateConfig(config, options = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("fixture_config_invalid");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(config.fixtureId)) {
    throw new Error("fixture_config_id_invalid");
  }
  validateArtifactUrl(config.artifactUrl, "fixture_config_url_invalid");
  if (options.lifecycle) {
    validateArtifactUrl(
      config.restoreArtifactUrl,
      "fixture_config_restore_url_invalid",
    );
    if (!/^gate-014-b1-lifecycle-[a-f0-9-]{36}$/.test(config.databaseName)) {
      throw new Error("fixture_config_database_name_invalid");
    }
  }
  if (
    options.restarted &&
    (!Number.isSafeInteger(config.restartStartedEpochMs) ||
      config.restartStartedEpochMs < 1 ||
      !Number.isSafeInteger(config.restartHarnessReadyEpochMs) ||
      config.restartHarnessReadyEpochMs < config.restartStartedEpochMs)
  ) {
    throw new Error("fixture_config_restart_epoch_invalid");
  }
  for (const field of [
    "expectedCanonicalBytes",
    "expectedRecordCount",
    "expectedVersionCount",
    "expectedSegmentCount",
  ]) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) {
      throw new Error(`fixture_config_${field}_invalid`);
    }
  }
  if (![256, 512, 1024].includes(config.candidate?.recordCap)) {
    throw new Error("fixture_config_record_cap_invalid");
  }
  if (
    ![1, 2, 4]
      .map((value) => value * 1024 * 1024)
      .includes(config.candidate?.byteCapBytes)
  ) {
    throw new Error("fixture_config_byte_cap_invalid");
  }
  if (options.lifecycle && !["cold", "warm"].includes(config.runMode)) {
    throw new Error("fixture_config_run_mode_invalid");
  }
}

function validateArtifactUrl(value, errorCode) {
  if (
    !/^http:\/\/127\.0\.0\.1:\d+\/[a-z0-9._-]+\.jsonl\?token=[a-f0-9-]{36}$/.test(
      value,
    )
  ) {
    throw new Error(errorCode);
  }
}

function validateLifecycleCheckpoint(checkpoint, config) {
  const warmSeedNameValid =
    config.runMode === "warm"
      ? checkpoint?.warmSeedDatabaseName === `${config.databaseName}-warm-seed`
      : checkpoint?.warmSeedDatabaseName === null;
  if (
    !checkpoint ||
    typeof checkpoint !== "object" ||
    Array.isArray(checkpoint) ||
    !/^[a-f0-9-]{36}$/.test(checkpoint.operationId) ||
    checkpoint.admissionReadbackVerified !== true ||
    checkpoint.ledgerConsistencyVerified !== true ||
    checkpoint.warmStartCompleteGenerationVerified !== true ||
    !warmSeedNameValid
  ) {
    throw new Error("fixture_lifecycle_checkpoint_invalid");
  }
}
