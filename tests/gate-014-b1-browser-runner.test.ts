import assert from "node:assert/strict";
import { spawn as spawnChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import "fake-indexeddb/auto";

import {
  B1_HARNESS_EXTENSION_ID,
  B1_LIFECYCLE_EVALUATION_TIMEOUT_MS,
  buildChromeArguments,
  closeB1FixtureHttpServer,
  classifyObservedErrorEvent,
  combineBrowserExecutionObservations,
  createB1ProductionExtensionStage,
  createB1TemporaryProfile,
  createCdpExecutionObservation,
  createControlledHarnessEvaluationExpression,
  createExtensionTargetObserver,
  createPipeCdpClient,
  diagnoseWindowsChromeLineageAfterGate,
  executeB1BrowserStage,
  executeB1BrowserOperationWithCleanup,
  findSurvivingWindowsProcessTree,
  findProductionServiceWorkerSession,
  loadUnpackedExtension,
  observeWindowsChromeClosure,
  removeB1ProductionExtensionStage,
  removeB1TemporaryProfile,
  readCompletedWindowsTerminationOutcome,
  readB1BrowserControlledFailureCode,
  readWindowsProcessTable,
  selectProductionServiceWorkerTarget,
  settleB1FixtureServerCleanup,
  settleWindowsChromeClosureObservations,
  uninstallUnpackedExtension,
  unwrapControlledHarnessEvaluation,
  validateBrowserExecutionObservation,
  validateChromeForTestingMetadata,
  validateLoadedExtensionInventory,
  validateOfficialCftStableMetadata,
  validateControlledHarnessEvaluation,
  validateSmokeResult,
  validateWindowsChromeTerminationEvidence,
  waitForB1BrowserProcessSpawn,
  waitForWindowsProcessTreeExit,
  waitForProductionExtensionReady,
  waitForProcessExit,
} from "../scripts/gate-014-b1-browser-runner.mjs";
import {
  createCustomFixtureDefinition,
  writeFixtureArtifact,
} from "../scripts/gate-014-fixture-generator.mjs";
import {
  assertFixtureRecordFitsCandidate,
  createFixtureHarnessError,
  createOperation,
  createStoredFixtureVersion,
  createRestartTimingEvidence,
  openDatabase,
  readIndexBatch,
  readFixtureHarnessFailureCode,
  readStoreBatch,
  runNormalizationThenFinalLedgerRead,
  shouldFlushFixtureBatch,
  writeFixture,
} from "./fixtures/gate-014/b1-extension/storage-harness.js";
import { restorePreflightAllows } from "./fixtures/gate-014/b1-extension/restore-preflight.js";

async function createControlledBrowserFailureForTest(stageCode: string) {
  try {
    await executeB1BrowserStage(stageCode, () => {
      throw new Error("synthetic_controlled_failure");
    });
  } catch (error) {
    return error;
  }
  throw new Error("synthetic_controlled_failure_missing");
}

test("GATE-014-B1 bounds a single browser lifecycle without masking gate thresholds", () => {
  assert.equal(B1_LIFECYCLE_EVALUATION_TIMEOUT_MS, 45 * 60 * 1_000);
});

test("GATE-014-B1 flushes before the next fixture record would cross either candidate cap", () => {
  const candidate = { recordCap: 256, byteCapBytes: 1024 * 1024 };
  assert.equal(shouldFlushFixtureBatch(candidate, 1, 1024 * 1024 - 8, 9), true);
  assert.equal(shouldFlushFixtureBatch(candidate, 256, 1, 1), true);
  assert.equal(shouldFlushFixtureBatch(candidate, 255, 1024, 1024), false);
  assert.equal(
    shouldFlushFixtureBatch(candidate, 0, 0, 2 * 1024 * 1024),
    false,
  );
  assert.doesNotThrow(() =>
    assertFixtureRecordFitsCandidate(candidate, candidate.byteCapBytes),
  );
  assert.throws(
    () =>
      assertFixtureRecordFitsCandidate(candidate, candidate.byteCapBytes + 1),
    /fixture_record_exceeds_candidate_byte_cap/,
  );
});

test("GATE-014-B1 uses one restore preflight boundary in browser and report code", () => {
  assert.equal(restorePreflightAllows(99, 100), false);
  assert.equal(restorePreflightAllows(100, 100), true);
  assert.equal(restorePreflightAllows(Number.NaN, 100), false);
});

test("GATE-014-B1 reads the final restart ledger only after normalization and preserves duplicate timings", async () => {
  const phases = [];
  let nowMs = 0;
  let releaseNormalization = () => {};
  const normalizationBarrier = new Promise<void>((resolve) => {
    releaseNormalization = resolve;
  });
  const resultPromise = runNormalizationThenFinalLedgerRead({
    async normalize() {
      phases.push("normalization_started");
      await normalizationBarrier;
      nowMs = 7;
      phases.push("normalization_completed");
      return { operation: "marker_normalization", readbackVerified: true };
    },
    async readFinalLedger() {
      phases.push("final_ledger_read");
      nowMs = 10;
      return { matches: true };
    },
    now: () => nowMs,
  });
  assert.deepEqual(phases, ["normalization_started"]);
  releaseNormalization();
  const result = await resultPromise;
  assert.deepEqual(phases, [
    "normalization_started",
    "normalization_completed",
    "final_ledger_read",
  ]);
  assert.equal(result.normalizationOperation.readbackVerified, true);
  assert.equal(result.finalLedgerConsistency.matches, true);
  assert.equal(result.finalReadDurationMs, 3);

  const timing = createRestartTimingEvidence({
    stateReadDurationMs: 3,
    normalizationBatchDurationMs: 5,
    finalReadDurationMs: 3,
  });
  assert.deepEqual(timing.readBatchDurationsMs, [3, 3]);
  assert.deepEqual(timing.batchDurationsMs, [3, 5, 3]);
  assert.equal(timing.readTimingEvidence.finalLedgerAndVisibleReadbackMs, 3);
});

test("GATE-014-B1 read batches wait for readonly transaction completion", async () => {
  for (const kind of ["store", "index"]) {
    const request: Record<string, unknown> = {};
    const transaction: Record<string, unknown> = {};
    const cursorSource = {
      openCursor() {
        assert.equal(typeof transaction.oncomplete, "function");
        assert.equal(typeof transaction.onerror, "function");
        assert.equal(typeof transaction.onabort, "function");
        return request;
      },
    };
    transaction.objectStore = () => ({
      ...cursorSource,
      index() {
        return cursorSource;
      },
    });
    const database = {
      transaction() {
        return transaction;
      },
    };
    const candidate = { recordCap: 1024, byteCapBytes: 1024 * 1024 };
    const readPromise = (
      kind === "store"
        ? readStoreBatch(
            database,
            "segments",
            candidate,
            undefined,
            undefined,
            (value: { canonicalBytes: number }) => value.canonicalBytes,
          )
        : readIndexBatch(
            database,
            "segments",
            "operationId",
            "operation-1",
            candidate,
            undefined,
            (value: { canonicalBytes: number }) => value.canonicalBytes,
          )
    ).then((result) => ({ settled: true, result }));
    let settled = false;
    void readPromise.then(() => {
      settled = true;
    });
    request.result = null;
    (request.onsuccess as () => void)();
    await Promise.resolve();
    assert.equal(settled, false);
    (transaction.oncomplete as () => void)();
    assert.deepEqual((await readPromise).result, {
      values: [],
      keys: [],
      done: true,
    });
  }
});

test("GATE-014-B1 freezes capped read batches and rejects transaction failures", async () => {
  for (const kind of ["store", "index"]) {
    const request: Record<string, unknown> = {};
    const transaction: Record<string, unknown> = {};
    const cursorSource = {
      openCursor() {
        return request;
      },
    };
    transaction.objectStore = () => ({
      ...cursorSource,
      index() {
        return cursorSource;
      },
    });
    const database = { transaction: () => transaction };
    const candidate = { recordCap: 1, byteCapBytes: 1024 * 1024 };
    const readPromise =
      kind === "store"
        ? readStoreBatch(
            database,
            "segments",
            candidate,
            undefined,
            undefined,
            (value: { canonicalBytes: number }) => value.canonicalBytes,
          )
        : readIndexBatch(
            database,
            "segments",
            "operationId",
            "operation-1",
            candidate,
            undefined,
            (value: { canonicalBytes: number }) => value.canonicalBytes,
          );
    const firstValue = { canonicalBytes: 32 };
    request.result = {
      primaryKey: 1,
      value: firstValue,
      continue() {},
    };
    (request.onsuccess as () => void)();
    request.result = {
      primaryKey: 2,
      value: { canonicalBytes: 32 },
      continue() {},
    };
    (request.onsuccess as () => void)();
    (transaction.oncomplete as () => void)();
    assert.deepEqual(await readPromise, {
      values: [firstValue],
      keys: [1],
      done: false,
    });
  }

  for (const eventName of ["onerror", "onabort"]) {
    const request: Record<string, unknown> = {};
    const transaction: Record<string, unknown> = {
      objectStore() {
        return { openCursor: () => request };
      },
    };
    const readPromise = readStoreBatch(
      { transaction: () => transaction },
      "segments",
      { recordCap: 1, byteCapBytes: 1024 },
      undefined,
      undefined,
      (value: { canonicalBytes: number }) => value.canonicalBytes,
    );
    (transaction[eventName] as () => void)();
    await assert.rejects(
      () => readPromise,
      /fixture_bounded_scan_(failed|aborted)/,
    );
  }
});

test("GATE-014-B1 caps version scans by the canonical metadata rows actually read", async () => {
  await assert.rejects(
    () =>
      readStoreBatch(
        { transaction: () => ({}) },
        "versions",
        { recordCap: 256, byteCapBytes: 1024 },
      ),
    /fixture_bounded_scan_byte_selector_invalid/,
  );
  const request: Record<string, unknown> = {};
  const transaction: Record<string, unknown> = {
    objectStore() {
      return { openCursor: () => request };
    },
  };
  const readPromise = readStoreBatch(
    { transaction: () => transaction },
    "versions",
    { recordCap: 256, byteCapBytes: 1024 },
    undefined,
    undefined,
    (value: { versionRecordCanonicalBytes: number }) =>
      value.versionRecordCanonicalBytes,
  );
  const values = [
    { canonicalBytes: 800_000, versionRecordCanonicalBytes: 128 },
    { canonicalBytes: 900_000, versionRecordCanonicalBytes: 144 },
  ];
  for (let index = 0; index < values.length; index += 1) {
    request.result = {
      primaryKey: index + 1,
      value: values[index],
      continue() {},
    };
    (request.onsuccess as () => void)();
  }
  request.result = null;
  (request.onsuccess as () => void)();
  (transaction.oncomplete as () => void)();
  assert.deepEqual(await readPromise, {
    values,
    keys: [1, 2],
    done: true,
  });

  for (const invalidBytes of [undefined, 0, 1025]) {
    const invalidRequest: Record<string, unknown> = {};
    const invalidTransaction: Record<string, unknown> = {
      objectStore() {
        return { openCursor: () => invalidRequest };
      },
    };
    const invalidRead = readStoreBatch(
      { transaction: () => invalidTransaction },
      "versions",
      { recordCap: 256, byteCapBytes: 1024 },
      undefined,
      undefined,
      () => invalidBytes,
    );
    invalidRequest.result = {
      primaryKey: 1,
      value: { canonicalBytes: 800_000 },
      continue() {},
    };
    (invalidRequest.onsuccess as () => void)();
    await assert.rejects(
      () => invalidRead,
      /fixture_bounded_scan_record_bytes_invalid/,
    );
  }

  const cappedRequest: Record<string, unknown> = {};
  const cappedTransaction: Record<string, unknown> = {
    objectStore() {
      return { openCursor: () => cappedRequest };
    },
  };
  const cappedRead = readStoreBatch(
    { transaction: () => cappedTransaction },
    "versions",
    { recordCap: 256, byteCapBytes: 1024 },
    undefined,
    undefined,
    (value: { versionRecordCanonicalBytes: number }) =>
      value.versionRecordCanonicalBytes,
  );
  const exactCapValues = [
    { canonicalBytes: 800_000, versionRecordCanonicalBytes: 512 },
    { canonicalBytes: 900_000, versionRecordCanonicalBytes: 512 },
  ];
  for (let index = 0; index < exactCapValues.length; index += 1) {
    cappedRequest.result = {
      primaryKey: index + 1,
      value: exactCapValues[index],
      continue() {},
    };
    (cappedRequest.onsuccess as () => void)();
  }
  cappedRequest.result = {
    primaryKey: 3,
    value: { canonicalBytes: 700_000, versionRecordCanonicalBytes: 1 },
    continue() {},
  };
  (cappedRequest.onsuccess as () => void)();
  (cappedTransaction.oncomplete as () => void)();
  assert.deepEqual(await cappedRead, {
    values: exactCapValues,
    keys: [1, 2],
    done: false,
  });
});

test("GATE-014-B1 derives version metadata bytes from the exact UTF-8 fixture line", () => {
  const line = JSON.stringify({
    record: "version",
    contract: "managed-full-text-v1",
    versionId: "version-1",
    languageLabel: "\u4e2d\u6587",
  });
  const lineBytes = new TextEncoder().encode(`${line}\n`).byteLength;
  const stored = createStoredFixtureVersion(
    JSON.parse(line),
    "operation-1",
    lineBytes,
  );
  assert.equal(stored.versionRecordCanonicalBytes, lineBytes);
  assert.equal(stored.canonicalBytes, 0);
  assert.equal(stored.operationId, "operation-1");
  assert.throws(
    () => createStoredFixtureVersion(JSON.parse(line), "operation-1", 0),
    /fixture_version_record_bytes_invalid/,
  );
});

test("GATE-014-B1 caps indexed version scans by canonical metadata row bytes", async () => {
  const candidate = { recordCap: 256, byteCapBytes: 1024 };
  await assert.rejects(
    () =>
      readIndexBatch(
        { transaction: () => ({}) },
        "versions",
        "operationId",
        "operation-1",
        candidate,
      ),
    /fixture_bounded_index_scan_byte_selector_invalid/,
  );

  const startRead = (
    byteSelector: (value: {
      versionRecordCanonicalBytes?: number;
    }) => number | undefined,
  ) => {
    const request: Record<string, unknown> = {};
    const transaction: Record<string, unknown> = {
      objectStore() {
        return {
          index() {
            return { openCursor: () => request };
          },
        };
      },
    };
    return {
      request,
      transaction,
      promise: readIndexBatch(
        { transaction: () => transaction },
        "versions",
        "operationId",
        "operation-1",
        candidate,
        undefined,
        byteSelector,
      ),
    };
  };

  const grouped = startRead(
    (value) => value.versionRecordCanonicalBytes,
  );
  const groupedValues = [
    { canonicalBytes: 800_000, versionRecordCanonicalBytes: 128 },
    { canonicalBytes: 900_000, versionRecordCanonicalBytes: 144 },
  ];
  for (let index = 0; index < groupedValues.length; index += 1) {
    grouped.request.result = {
      primaryKey: index + 1,
      value: groupedValues[index],
      continue() {},
    };
    (grouped.request.onsuccess as () => void)();
  }
  grouped.request.result = null;
  (grouped.request.onsuccess as () => void)();
  (grouped.transaction.oncomplete as () => void)();
  assert.deepEqual(await grouped.promise, {
    values: groupedValues,
    keys: [1, 2],
    done: true,
  });

  const capped = startRead((value) => value.versionRecordCanonicalBytes);
  const exactCapValues = [
    { canonicalBytes: 800_000, versionRecordCanonicalBytes: 512 },
    { canonicalBytes: 900_000, versionRecordCanonicalBytes: 512 },
  ];
  for (let index = 0; index < exactCapValues.length; index += 1) {
    capped.request.result = {
      primaryKey: index + 1,
      value: exactCapValues[index],
      continue() {},
    };
    (capped.request.onsuccess as () => void)();
  }
  capped.request.result = {
    primaryKey: 3,
    value: { canonicalBytes: 700_000, versionRecordCanonicalBytes: 1 },
    continue() {},
  };
  (capped.request.onsuccess as () => void)();
  (capped.transaction.oncomplete as () => void)();
  assert.deepEqual(await capped.promise, {
    values: exactCapValues,
    keys: [1, 2],
    done: false,
  });

  for (const invalidBytes of [undefined, 0, 1025]) {
    const invalid = startRead(() => invalidBytes);
    invalid.request.result = {
      primaryKey: 1,
      value: { canonicalBytes: 800_000 },
      continue() {},
    };
    (invalid.request.onsuccess as () => void)();
    await assert.rejects(
      () => invalid.promise,
      /fixture_bounded_index_scan_record_bytes_invalid/,
    );
  }
});

test("GATE-014-B1 preserves generated fixture metadata bytes through finalize", async () => {
  const definition = createCustomFixtureDefinition({
    id: "b1-metadata-ingest-regression",
    targetCanonicalBytes: 192 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), "gate-014-b1-ingest-repo-"),
  );
  await writeFile(
    path.join(repositoryRoot, "package.json"),
    `${JSON.stringify({ name: "bili-bill", private: true })}\n`,
    "utf8",
  );
  const databaseName = `gate-014-b1-ingest-${crypto.randomUUID()}`;
  let database: IDBDatabase | null = null;
  try {
    const generated = await writeFixtureArtifact(definition, {
      seed: "b1-metadata-ingest-seed",
      repositoryRoot,
    });
    const artifactBytes = await readFile(generated.artifactPath);
    const expectedVersions = [];
    let currentVersion: {
      canonicalBytes: number;
      versionId: string;
      versionRecordCanonicalBytes: number;
    } | null = null;
    for (const line of artifactBytes.toString("utf8").trimEnd().split("\n")) {
      const lineBytes = new TextEncoder().encode(`${line}\n`).byteLength;
      const record = JSON.parse(line);
      if (record.record === "version") {
        currentVersion = {
          canonicalBytes: lineBytes,
          versionId: record.versionId,
          versionRecordCanonicalBytes: lineBytes,
        };
        expectedVersions.push(currentVersion);
      } else {
        assert.notEqual(currentVersion, null);
        currentVersion.canonicalBytes += lineBytes;
      }
    }

    database = (await openDatabase(databaseName)) as IDBDatabase;
    const operationId = "b1-metadata-ingest-operation";
    const config = {
      fixtureId: definition.id,
      candidate: { recordCap: 256, byteCapBytes: 1024 * 1024 },
    };
    await createOperation(database, operationId, config);
    const writeResult = await writeFixture(
      database,
      operationId,
      config,
      { sampleHeap() {} },
      new Response(new Uint8Array(artifactBytes)),
    );
    const storedVersions = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        const request = database
          ?.transaction("versions", "readonly")
          .objectStore("versions")
          .getAll();
        if (!request) {
          reject(new Error("fixture_test_database_unavailable"));
          return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    assert.equal(writeResult.canonicalBytes, generated.receipt.canonical.totalBytes);
    assert.deepEqual(
      storedVersions
        .map((version) => ({
          canonicalBytes: version.canonicalBytes,
          versionId: version.versionId,
          versionRecordCanonicalBytes: version.versionRecordCanonicalBytes,
        }))
        .sort((left, right) =>
          String(left.versionId).localeCompare(String(right.versionId)),
        ),
      expectedVersions.sort((left, right) =>
        left.versionId.localeCompare(right.versionId),
      ),
    );
  } finally {
    database?.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("fixture_test_cleanup_blocked"));
    });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("GATE-014-B1 Chrome arguments isolate a fresh profile and block external name resolution", () => {
  const argumentsList = buildChromeArguments({
    profileDirectory: path.resolve("temporary-profile"),
  });

  assert.equal(argumentsList.includes("--headless=new"), true);
  assert.equal(
    argumentsList.some((argument) => argument.startsWith("--user-data-dir=")),
    true,
  );
  assert.equal(argumentsList.includes("--disable-background-networking"), true);
  assert.equal(argumentsList.includes("--disable-extensions"), false);
  assert.equal(argumentsList.includes("--remote-debugging-pipe"), true);
  assert.equal(
    argumentsList.includes("--enable-unsafe-extension-debugging"),
    true,
  );
  assert.equal(
    argumentsList.some((argument) => argument.startsWith("--load-extension")),
    false,
  );
  assert.equal(
    argumentsList.some((argument) =>
      argument.startsWith("--disable-extensions-except"),
    ),
    false,
  );
  assert.equal(
    argumentsList.includes(
      "--disable-features=MediaRouter,OptimizationGuideModelExecution,OptimizationGuideOnDeviceModel,OptimizationHints,Translate",
    ),
    true,
  );
  assert.equal(argumentsList.includes("--no-proxy-server"), true);
  assert.equal(
    argumentsList.includes(
      "--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1",
    ),
    true,
  );
  assert.equal(
    argumentsList.some((argument) => argument.includes("Cookie")),
    false,
  );
  assert.equal(
    argumentsList.some((argument) => argument.includes("User Data")),
    false,
  );
});

test("GATE-014-B1 stages a byte-identical production extension and proves cleanup", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "b1-production-source-"));
  let stage = null;
  try {
    await writeFile(
      path.join(source, "manifest.json"),
      '{"manifest_version":3,"name":"Synthetic","version":"1.0.0"}\n',
      "utf8",
    );
    await writeFile(path.join(source, "background.js"), "export {};\n", "utf8");
    stage = await createB1ProductionExtensionStage(source);
    assert.notEqual(stage.directory, source);
    assert.equal(stage.sourceSha256.length, 64);
    assert.equal(
      await readFile(path.join(stage.directory, "background.js"), "utf8"),
      "export {};\n",
    );
    const removedRoot = stage.root;
    await removeB1ProductionExtensionStage(stage);
    stage = null;
    await assert.rejects(() => access(removedRoot), { code: "ENOENT" });
  } finally {
    if (stage) {
      await removeB1ProductionExtensionStage(stage);
    }
    await rm(source, { recursive: true, force: true });
  }
});

test("GATE-014-B1 CDP pipe frames commands and parses fragmented responses", async () => {
  const commandPipe = new PassThrough();
  const eventPipe = new PassThrough();
  const commandChunks: Buffer[] = [];
  commandPipe.on("data", (chunk) => commandChunks.push(Buffer.from(chunk)));
  const client = createPipeCdpClient(commandPipe, eventPipe);
  const observedEvents: Array<Record<string, unknown>> = [];
  client.onEvent((message: Record<string, unknown>) => {
    observedEvents.push(message);
  });

  const responsePromise = client.send(
    "Runtime.evaluate",
    { expression: "1" },
    "extension-session",
    1_000,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const commandText = Buffer.concat(commandChunks).toString("utf8");
  assert.equal(commandText.endsWith("\0"), true);
  const command = JSON.parse(commandText.slice(0, -1));
  assert.equal(command.method, "Runtime.evaluate");
  assert.equal(command.sessionId, "extension-session");

  eventPipe.write(
    '{"method":"Runtime.executionContextCreated","sessionId":"extension-session","params":{}}\0{"id":',
  );
  eventPipe.write(
    `${command.id},"result":{"result":{"value":1}}}\0`,
  );
  const response = await responsePromise;
  assert.equal(response.result.value, 1);
  assert.equal(observedEvents.length, 1);
  assert.equal(observedEvents[0].method, "Runtime.executionContextCreated");
  client.close();
});

test("GATE-014-B1 dynamically loads only absolute unpacked extension paths", async () => {
  const extensionPath = path.resolve("dist");
  const calls: Array<Record<string, unknown>> = [];
  const extensionId = "b".repeat(32);
  const client = {
    async send(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "Extensions.getExtensions") {
        return { extensions: [] };
      }
      return { id: extensionId };
    },
  };
  assert.equal(
    await loadUnpackedExtension(client, extensionPath, { timeoutMs: 1_000 }),
    extensionId,
  );
  assert.deepEqual(calls, [
    {
      method: "Extensions.loadUnpacked",
      params: { path: extensionPath },
    },
  ]);
  await assert.rejects(
    () => loadUnpackedExtension(client, "dist", { timeoutMs: 1_000 }),
    /browser_extension_path_invalid/,
  );
  await assert.rejects(
    () =>
      loadUnpackedExtension(
        { async send() { return { id: "invalid" }; } },
        extensionPath,
        { timeoutMs: 1_000 },
      ),
    /browser_extension_dynamic_load_failed/,
  );
  await uninstallUnpackedExtension(client, extensionId, { timeoutMs: 1_000 });
  assert.deepEqual(calls.slice(-2), [
    {
      method: "Extensions.uninstall",
      params: { id: extensionId },
    },
    {
      method: "Extensions.getExtensions",
      params: {},
    },
  ]);
  await assert.rejects(
    () => uninstallUnpackedExtension(client, "invalid", { timeoutMs: 1_000 }),
    /browser_extension_identity_invalid/,
  );
  await assert.rejects(
    () =>
      uninstallUnpackedExtension(
        {
          async send(method: string) {
            return method === "Extensions.getExtensions"
              ? { extensions: [{ id: extensionId }] }
              : {};
          },
        },
        extensionId,
        { timeoutMs: 1_000 },
      ),
    /browser_extension_uninstall_failed/,
  );
});

test("GATE-014-B1 configures a paused production worker before resuming it", async () => {
  const productionExtensionId = "b".repeat(32);
  const workerTarget = {
    targetId: "production-worker",
    type: "service_worker",
    url: `chrome-extension://${productionExtensionId}/background.js`,
  };
  let eventListener: ((message: Record<string, unknown>) => void) | null = null;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const observedSessions: Array<{ sessionId: string; extensionId: string }> = [];
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
    async send(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "Target.getTargets") {
        return { targetInfos: [] };
      }
      return {};
    },
  };
  const observer = createExtensionTargetObserver(client, {
    observeSession(sessionId: string, extensionId: string) {
      observedSessions.push({ sessionId, extensionId });
    },
  });
  await observer.start({ timeoutMs: 1_000 });
  eventListener?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "production-session",
      targetInfo: workerTarget,
      waitingForDebugger: true,
    },
  });
  eventListener?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "manual-page-session",
      targetInfo: {
        targetId: "manual-page",
        type: "page",
        url: `chrome-extension://${B1_HARNESS_EXTENSION_ID}/runner.html`,
      },
      waitingForDebugger: false,
    },
  });
  eventListener?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "persisted-harness-worker-session",
      targetInfo: {
        targetId: "persisted-harness-worker",
        type: "service_worker",
        url: `chrome-extension://${B1_HARNESS_EXTENSION_ID}/service-worker.js`,
      },
      waitingForDebugger: false,
    },
  });
  eventListener?.({
    method: "Target.detachedFromTarget",
    params: {
      sessionId: "already-running-production-session",
      targetId: "already-running-production-worker",
    },
  });
  await observer.settle();

  assert.deepEqual(calls[0], {
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [
        { type: "service_worker", exclude: false },
        { exclude: true },
      ],
    },
  });
  const resumeIndex = calls.findIndex(
    ({ method }) => method === "Runtime.runIfWaitingForDebugger",
  );
  for (const requiredMethod of [
    "Runtime.enable",
    "Network.enable",
    "Log.enable",
    "Fetch.enable",
  ]) {
    const enableIndex = calls.findIndex(({ method }) => method === requiredMethod);
    assert.equal(enableIndex >= 0, true);
    assert.equal(enableIndex < resumeIndex, true);
  }
  assert.equal(
    calls.some(({ method }) => method === "Target.attachToTarget"),
    false,
  );
  assert.deepEqual(observedSessions, [
    {
      sessionId: "production-session",
      extensionId: productionExtensionId,
    },
    {
      sessionId: "persisted-harness-worker-session",
      extensionId: B1_HARNESS_EXTENSION_ID,
    },
  ]);
  assert.equal(
    calls.filter(({ method }) => method === "Runtime.runIfWaitingForDebugger")
      .length,
    1,
  );
  observer.completeSetup();
  await observer.stop();
});

test("GATE-014-B1 waits for a newly created runner target to reach its extension URL", async () => {
  let targetInfoReadCount = 0;
  const client = {
    onEvent() {
      return () => {};
    },
    async send(method: string, params: Record<string, unknown>) {
      if (method === "Target.getTargets") {
        return { targetInfos: [] };
      }
      if (method === "Target.getTargetInfo") {
        targetInfoReadCount += 1;
        return {
          targetInfo: {
            targetId: params.targetId,
            type: "page",
            url:
              targetInfoReadCount === 1
                ? "about:blank"
                : `chrome-extension://${B1_HARNESS_EXTENSION_ID}/runner.html`,
          },
        };
      }
      if (method === "Target.attachToTarget") {
        return { sessionId: "runner-session" };
      }
      return {};
    },
  };
  const observer = createExtensionTargetObserver(client, {
    observeSession() {},
  });
  await observer.start({ timeoutMs: 1_000 });
  assert.equal(await observer.ensureTargetId("runner-target", 1_000), "runner-session");
  assert.equal(targetInfoReadCount, 2);
  observer.completeSetup();
  await observer.stop();
});

test("GATE-014-B1 rejects a current production worker that attached before its ID was known", async () => {
  const productionExtensionId = "b".repeat(32);
  let eventListener: ((message: Record<string, unknown>) => void) | null = null;
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
    async send(method: string) {
      if (method === "Target.getTargets") {
        return { targetInfos: [] };
      }
      return {};
    },
  };
  const observer = createExtensionTargetObserver(client, {
    observeSession() {},
  });
  await observer.start({ timeoutMs: 1_000 });
  eventListener?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "already-running-production-session",
      targetInfo: {
        targetId: "already-running-production-worker",
        type: "service_worker",
        url: `chrome-extension://${productionExtensionId}/background.js`,
      },
      waitingForDebugger: false,
    },
  });
  await observer.settle();
  assert.throws(
    () => observer.requireProductionServiceWorkerBarrier(productionExtensionId),
    /browser_extension_startup_barrier_missing/,
  );
});

test("GATE-014-B1 observes an unrelated running extension worker without using it as production proof", async () => {
  const productionExtensionId = "b".repeat(32);
  const unrelatedExtensionId = "c".repeat(32);
  let eventListener: ((message: Record<string, unknown>) => void) | null = null;
  const observedSessions: Array<Record<string, unknown>> = [];
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
    async send(method: string) {
      if (method === "Target.getTargets") {
        return { targetInfos: [] };
      }
      return {};
    },
  };
  const observer = createExtensionTargetObserver(client, {
    observeSession(sessionId: string, extensionId: string) {
      observedSessions.push({ sessionId, extensionId });
    },
  });
  await observer.start({ timeoutMs: 1_000 });
  eventListener?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "unrelated-running-session",
      targetInfo: {
        targetId: "unrelated-running-worker",
        type: "service_worker",
        url: `chrome-extension://${unrelatedExtensionId}/background.js`,
      },
      waitingForDebugger: false,
    },
  });
  await observer.settle();
  assert.doesNotThrow(() =>
    observer.requireProductionServiceWorkerBarrier(productionExtensionId),
  );
  assert.deepEqual(observedSessions, [
    {
      sessionId: "unrelated-running-session",
      extensionId: unrelatedExtensionId,
    },
  ]);
});

test("GATE-014-B1 rejects a prior production worker before it can resume", async () => {
  const firstPriorProductionExtensionId = "d".repeat(32);
  const secondPriorProductionExtensionId = "e".repeat(32);
  let eventListener: ((message: Record<string, unknown>) => void) | null = null;
  const calls: Array<{ method: string }> = [];
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
    async send(method: string) {
      calls.push({ method });
      if (method === "Target.getTargets") {
        return { targetInfos: [] };
      }
      return {};
    },
  };
  const observer = createExtensionTargetObserver(
    client,
    { observeSession() {} },
    {
      forbiddenProductionExtensionIds: [
        firstPriorProductionExtensionId,
        secondPriorProductionExtensionId,
      ],
    },
  );
  await observer.start({ timeoutMs: 1_000 });
  assert.throws(
    () =>
      observer.requireProductionServiceWorkerBarrier(
        firstPriorProductionExtensionId,
      ),
    /browser_production_extension_identity_invalid/,
  );
  eventListener?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "prior-production-session",
      targetInfo: {
        targetId: "prior-production-worker",
        type: "service_worker",
        url: `chrome-extension://${secondPriorProductionExtensionId}/background.js`,
      },
      waitingForDebugger: true,
    },
  });
  await assert.rejects(
    () => observer.settle(),
    /browser_extension_startup_barrier_missing/,
  );
  assert.equal(
    calls.some(({ method }) => method === "Runtime.runIfWaitingForDebugger"),
    false,
  );
});

test("GATE-014-B1 rejects a forbidden worker attached while auto-attach is shutting down", async () => {
  const priorProductionExtensionId = "f".repeat(32);
  let eventListener: ((message: Record<string, unknown>) => void) | null = null;
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
    async send(method: string, params: Record<string, unknown>) {
      if (method === "Target.getTargets") {
        return { targetInfos: [] };
      }
      if (method === "Target.setAutoAttach" && params.autoAttach === false) {
        eventListener?.({
          method: "Target.attachedToTarget",
          params: {
            sessionId: "teardown-prior-production-session",
            targetInfo: {
              targetId: "teardown-prior-production-worker",
              type: "service_worker",
              url: `chrome-extension://${priorProductionExtensionId}/background.js`,
            },
            waitingForDebugger: true,
          },
        });
      }
      return {};
    },
  };
  const observer = createExtensionTargetObserver(
    client,
    { observeSession() {} },
    { forbiddenProductionExtensionIds: [priorProductionExtensionId] },
  );
  await observer.start({ timeoutMs: 1_000 });
  observer.completeSetup();
  await assert.rejects(
    () => observer.stop(),
    /browser_extension_startup_barrier_missing/,
  );
});

test("GATE-014-B1 requires the executable version to match the declared official CFT stable", () => {
  const officialStable = validateOfficialCftStableMetadata(
    {
      timestamp: "2026-08-10T10:33:09.663Z",
      channels: {
        Stable: {
          channel: "Stable",
          version: "151.0.7922.77",
          revision: "1654411",
          downloads: {
            chrome: [
              {
                platform: "win64",
                url: "https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.77/win64/chrome-win64.zip",
              },
            ],
          },
        },
      },
    },
    "e".repeat(64),
  );
  const metadata = validateChromeForTestingMetadata(
    {
      productName: "Google Chrome for Testing",
      productVersion: "151.0.7922.77",
    },
    officialStable,
  );
  assert.equal(metadata.version, metadata.officialStableVersion);
  assert.equal(
    metadata.stableVersionSource,
    "official_last_known_good_versions_with_downloads_json",
  );
  assert.throws(
    () =>
      validateChromeForTestingMetadata(
        {
          productName: "Google Chrome for Testing",
          productVersion: "151.0.7922.76",
        },
        officialStable,
      ),
    /stable_version_mismatch/,
  );
  assert.throws(
    () =>
      validateChromeForTestingMetadata(
        { productName: "Google Chrome", productVersion: "151.0.7922.77" },
        officialStable,
      ),
    /official_chrome_for_testing_required/,
  );
  for (const candidate of [
    {
      productName: "Not Google Chrome for Testing",
      productVersion: "151.0.7922.77",
    },
    {
      productName: "Google Chrome for Testing",
      productVersion: "151.0.7922.77-custom",
    },
    {
      productName: "Google Chrome for Testing",
      productVersion: "v151.0.7922.77",
    },
    {
      productName: " Google Chrome for Testing",
      productVersion: "151.0.7922.77",
    },
    {
      productName: "Google Chrome for Testing",
      productVersion: "151.0.7922.77 ",
    },
  ]) {
    assert.throws(
      () => validateChromeForTestingMetadata(candidate, officialStable),
      /official_chrome_for_testing_required/,
    );
  }
  assert.throws(
    () =>
      validateOfficialCftStableMetadata(
        {
          timestamp: "2026-08-10T10:33:09.663Z",
          channels: {
            Stable: {
              channel: "Stable",
              version: "151.0.7922.77",
              revision: "1654411",
              downloads: {
                chrome: [
                  {
                    platform: "win64",
                    url: "https://example.invalid/chrome-win64.zip",
                  },
                ],
              },
            },
          },
        },
        "e".repeat(64),
      ),
    /official_cft_stable_metadata_invalid/,
  );
});

test("GATE-014-B1 process exit observation fails closed on timeout", async () => {
  const timedOutChild = new EventEmitter();
  timedOutChild.exitCode = null;
  assert.equal(await waitForProcessExit(timedOutChild, 5), false);
  assert.equal(timedOutChild.listenerCount("exit"), 0);

  const exitingChild = new EventEmitter();
  exitingChild.exitCode = null;
  const exitPromise = waitForProcessExit(exitingChild, 1_000);
  setImmediate(() => {
    exitingChild.exitCode = 0;
    exitingChild.emit("exit", 0);
  });
  assert.equal(await exitPromise, true);
});

test("GATE-014-B1 settles concurrent Windows parent and lineage observations with deterministic failure priority", async () => {
  let releaseObservations: (() => void) | null = null;
  const observationBarrier = new Promise<void>((resolve) => {
    releaseObservations = resolve;
  });
  const starts: string[] = [];
  const pending = settleWindowsChromeClosureObservations(
    async () => {
      starts.push("parent");
      await observationBarrier;
      return true;
    },
    async () => {
      starts.push("lineage");
      await observationBarrier;
      return [];
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ["parent", "lineage"]);
  releaseObservations?.();
  assert.deepEqual(await pending, {
    parentExited: true,
    survivors: [],
  });

  const parentFailure = new Error("parent_failed");
  const lineageFailure = new Error("lineage_failed");
  let lineageSettled = false;
  await assert.rejects(
    settleWindowsChromeClosureObservations(
      async () => {
        throw parentFailure;
      },
      async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        lineageSettled = true;
        throw lineageFailure;
      },
    ),
    (error: unknown) => error === parentFailure,
  );
  assert.equal(lineageSettled, true);
  await assert.rejects(
    settleWindowsChromeClosureObservations(
      async () => true,
      async () => {
        throw lineageFailure;
      },
    ),
    (error: unknown) => error === lineageFailure,
  );
  await assert.rejects(
    settleWindowsChromeClosureObservations(
      null as unknown as () => Promise<boolean>,
      async () => [],
    ),
    /chrome_process_closure_observation_invalid/,
  );
});

test("GATE-014-B1 observes Windows parent exit and lineage concurrently inside one immutable deadline", async () => {
  const initialProcesses = [
    { processId: 100, parentProcessId: 10 },
    { processId: 101, parentProcessId: 100 },
  ];
  const child = { pid: 100 };
  const now = () => 1_000;
  const starts: string[] = [];
  const parentTimeoutsMs: number[] = [];
  const lineageDeadlinesMs: number[] = [];
  let releaseObservations: (() => void) | null = null;
  const observationBarrier = new Promise<void>((resolve) => {
    releaseObservations = resolve;
  });
  const passing = observeWindowsChromeClosure({
    child,
    initialProcesses,
    closureDeadlineEpochMs: 5_000,
    now,
    waitForParentExit: async (
      observedChild: { pid: number },
      timeoutMs: number,
    ) => {
      starts.push("parent");
      assert.equal(observedChild, child);
      parentTimeoutsMs.push(timeoutMs);
      await observationBarrier;
      return true;
    },
    waitForLineageExit: async (
      observedInitialProcesses: Array<{
        processId: number;
        parentProcessId: number;
      }>,
      rootProcessId: number,
      options: {
        deadlineEpochMs: number;
        now: () => number;
        readProcessTable: () => Promise<unknown[]>;
      },
    ) => {
      starts.push("lineage");
      assert.equal(observedInitialProcesses, initialProcesses);
      assert.equal(rootProcessId, child.pid);
      assert.equal(options.now, now);
      assert.equal(typeof options.readProcessTable, "function");
      lineageDeadlinesMs.push(options.deadlineEpochMs);
      await observationBarrier;
      return [];
    },
    readProcessTable: async () => [],
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ["parent", "lineage"]);
  releaseObservations?.();
  assert.deepEqual(await passing, {
    parentExited: true,
    survivors: [],
  });
  assert.deepEqual(parentTimeoutsMs, [4_000]);
  assert.deepEqual(lineageDeadlinesMs, [5_000]);

  const lineageDeadlineFailure = await createControlledBrowserFailureForTest(
    "browser_process_lineage_table_command_deadline_elapsed_failed",
  );
  const parentAndLineageStarts: string[] = [];
  await assert.rejects(
    observeWindowsChromeClosure({
      child,
      initialProcesses,
      closureDeadlineEpochMs: 5_000,
      now,
      waitForParentExit: async () => {
        parentAndLineageStarts.push("parent");
        return false;
      },
      waitForLineageExit: async () => {
        parentAndLineageStarts.push("lineage");
        throw lineageDeadlineFailure;
      },
      readProcessTable: async () => [],
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_parent_exit_failed",
  );
  assert.deepEqual(parentAndLineageStarts, ["parent", "lineage"]);

  await assert.rejects(
    observeWindowsChromeClosure({
      child,
      initialProcesses,
      closureDeadlineEpochMs: 5_000,
      now,
      waitForParentExit: async () => true,
      waitForLineageExit: async () => {
        throw lineageDeadlineFailure;
      },
      readProcessTable: async () => [],
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_table_command_deadline_elapsed_failed",
  );

  await assert.rejects(
    observeWindowsChromeClosure({
      child,
      initialProcesses,
      closureDeadlineEpochMs: 5_000,
      now,
      waitForParentExit: async () => true,
      waitForLineageExit: async () => [101],
      readProcessTable: async () => [],
      diagnoseLineageAfterGate: async () =>
        "browser_process_lineage_cleared_by_10s_failed",
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_cleared_by_10s_failed",
  );

  let diagnosisCallCount = 0;
  await assert.rejects(
    observeWindowsChromeClosure({
      child,
      initialProcesses,
      closureDeadlineEpochMs: 5_000,
      now,
      waitForParentExit: async () => false,
      waitForLineageExit: async () => [101],
      readProcessTable: async () => [],
      diagnoseLineageAfterGate: async () => {
        diagnosisCallCount += 1;
        return "browser_process_lineage_cleared_by_10s_failed";
      },
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_parent_exit_failed",
  );
  assert.equal(diagnosisCallCount, 0);
});

test("GATE-014-B1 process-tree verification catches surviving descendants after the root exits", () => {
  const initial = [
    { processId: 100, parentProcessId: 10 },
    { processId: 101, parentProcessId: 100 },
    { processId: 102, parentProcessId: 101 },
    { processId: 900, parentProcessId: 10 },
  ];
  assert.deepEqual(
    findSurvivingWindowsProcessTree(
      initial,
      [{ processId: 100, parentProcessId: 10 }],
      100,
    ),
    [100],
  );
  assert.deepEqual(
    findSurvivingWindowsProcessTree(
      initial,
      [
        { processId: 101, parentProcessId: 100 },
        { processId: 102, parentProcessId: 101 },
        { processId: 103, parentProcessId: 102 },
        { processId: 900, parentProcessId: 10 },
      ],
      100,
    ),
    [101, 102, 103],
  );
  assert.deepEqual(
    findSurvivingWindowsProcessTree(
      initial,
      [{ processId: 103, parentProcessId: 102 }],
      100,
    ),
    [103],
  );
  assert.deepEqual(
    findSurvivingWindowsProcessTree(
      initial,
      [{ processId: 101, parentProcessId: 900 }],
      100,
    ),
    [101],
  );
  assert.deepEqual(
    findSurvivingWindowsProcessTree(
      initial,
      [{ processId: 104, parentProcessId: 103 }],
      100,
      [103],
    ),
    [104],
  );
  assert.deepEqual(findSurvivingWindowsProcessTree(initial, [], 100), []);
  assert.throws(
    () =>
      findSurvivingWindowsProcessTree(
        initial,
        [
          { processId: 101, parentProcessId: 100 },
          { processId: 101, parentProcessId: 100 },
        ],
        100,
      ),
    /current_process_table_invalid/,
  );
});

test("GATE-014-B1 waits within one deadline for the captured Windows lineage to disappear", async () => {
  const initial = [
    { processId: 100, parentProcessId: 1 },
    { processId: 101, parentProcessId: 100 },
  ];
  let nowMs = 0;
  let readCount = 0;
  const readTimeoutsMs: number[] = [];
  const transient = await waitForWindowsProcessTreeExit(initial, 100, {
    deadlineEpochMs: 100,
    now: () => nowMs,
    wait: async (milliseconds: number) => {
      nowMs += milliseconds;
    },
    readProcessTable: async (options: { timeoutMs?: number } = {}) => {
      readTimeoutsMs.push(options.timeoutMs ?? -1);
      readCount += 1;
      if (readCount === 1) {
        return [
          { processId: 101, parentProcessId: 100 },
          { processId: 102, parentProcessId: 101 },
          { processId: 103, parentProcessId: 102 },
        ];
      }
      if (readCount === 2) {
        return [{ processId: 103, parentProcessId: 102 }];
      }
      return [];
    },
    pollIntervalMs: 40,
  });
  assert.deepEqual(transient, []);
  assert.equal(readCount, 3);
  assert.deepEqual(readTimeoutsMs, [100, 60, 20]);

  nowMs = 100;
  let deadlineReadCount = 0;
  await assert.rejects(
    () =>
      waitForWindowsProcessTreeExit(initial, 100, {
        deadlineEpochMs: 100,
        now: () => nowMs,
        wait: async () => {},
        readProcessTable: async () => {
          deadlineReadCount += 1;
          return [];
        },
      }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_deadline_before_observation_failed",
  );
  assert.equal(deadlineReadCount, 0);

  nowMs = 0;
  const persistent = await waitForWindowsProcessTreeExit(initial, 100, {
    deadlineEpochMs: 100,
    now: () => nowMs,
    wait: async (milliseconds: number) => {
      nowMs += milliseconds;
    },
    readProcessTable: async () => [
      { processId: 101, parentProcessId: 100 },
    ],
  });
  assert.deepEqual(persistent, [101]);
  assert.throws(
    () =>
      validateWindowsChromeTerminationEvidence({
        nativeTerminationCompleted: true,
        nativeTerminationOutcome: "exit_zero",
        rootObservedBeforeTermination: true,
        rootRunningBeforeTermination: true,
        parentExited: true,
        survivingProcessIds: persistent,
      }),
    /chrome_process_tree_termination_failed/,
  );

  await assert.rejects(
    () =>
      waitForWindowsProcessTreeExit(initial, 100, {
        deadlineEpochMs: 100,
        now: () => 0,
        wait: async () => {},
        readProcessTable: async () => {
          throw new Error("process_table_unavailable");
        },
      }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_table_observation_failed",
  );

  nowMs = 90;
  let finalReadTimeoutMs = null;
  await assert.rejects(
    () =>
      waitForWindowsProcessTreeExit(initial, 100, {
        deadlineEpochMs: 100,
        now: () => nowMs,
        wait: async (milliseconds: number) => {
          nowMs += milliseconds;
        },
        readProcessTable: async (options: { timeoutMs?: number } = {}) => {
          finalReadTimeoutMs = options.timeoutMs ?? null;
          nowMs = 101;
          return [];
        },
      }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_deadline_after_observation_failed",
  );
  assert.equal(finalReadTimeoutMs, 10);
});

test("GATE-014-B1 diagnoses late Windows lineage convergence without changing the five-second failure", async () => {
  const initial = [
    { processId: 100, parentProcessId: 1 },
    { processId: 101, parentProcessId: 100 },
  ];
  const observedWindows: Array<{
    deadlineEpochMs: number;
    observedLineageProcessIds: number[];
  }> = [];
  const byTen = await diagnoseWindowsChromeLineageAfterGate(
    initial,
    100,
    [101],
    {
      gateDeadlineEpochMs: 5_000,
      now: () => 5_000,
      readProcessTable: async () => [],
      waitForLineageExit: async (
        _initial: typeof initial,
        _rootProcessId: number,
        options: {
          deadlineEpochMs: number;
          observedLineageProcessIds: number[];
        },
      ) => {
        observedWindows.push({
          deadlineEpochMs: options.deadlineEpochMs,
          observedLineageProcessIds: [
            ...options.observedLineageProcessIds,
          ],
        });
        return [];
      },
    },
  );
  assert.equal(
    byTen,
    "browser_process_lineage_cleared_by_10s_failed",
  );
  assert.deepEqual(observedWindows, [
    { deadlineEpochMs: 10_000, observedLineageProcessIds: [101] },
  ]);

  const byFifteenWindows: typeof observedWindows = [];
  let byFifteenCallCount = 0;
  const byFifteen = await diagnoseWindowsChromeLineageAfterGate(
    initial,
    100,
    [101],
    {
      gateDeadlineEpochMs: 5_000,
      now: () => 5_000,
      readProcessTable: async () => [],
      waitForLineageExit: async (
        _initial: typeof initial,
        _rootProcessId: number,
        options: {
          deadlineEpochMs: number;
          observedLineageProcessIds: number[];
        },
      ) => {
        byFifteenWindows.push({
          deadlineEpochMs: options.deadlineEpochMs,
          observedLineageProcessIds: [
            ...options.observedLineageProcessIds,
          ],
        });
        byFifteenCallCount += 1;
        return byFifteenCallCount === 1 ? [102] : [];
      },
    },
  );
  assert.equal(
    byFifteen,
    "browser_process_lineage_cleared_by_15s_failed",
  );
  assert.deepEqual(byFifteenWindows, [
    { deadlineEpochMs: 10_000, observedLineageProcessIds: [101] },
    { deadlineEpochMs: 15_000, observedLineageProcessIds: [102] },
  ]);

  let persistentCallCount = 0;
  assert.equal(
    await diagnoseWindowsChromeLineageAfterGate(initial, 100, [101], {
      gateDeadlineEpochMs: 5_000,
      now: () => 5_000,
      readProcessTable: async () => [],
      waitForLineageExit: async () => [101 + ++persistentCallCount],
    }),
    "browser_process_lineage_persistent_at_15s_failed",
  );
  assert.equal(persistentCallCount, 2);

  assert.equal(
    await diagnoseWindowsChromeLineageAfterGate(initial, 100, [101], {
      gateDeadlineEpochMs: 5_000,
      now: () => 5_000,
      readProcessTable: async () => [],
      waitForLineageExit: async () => {
        throw new Error("private diagnostic detail");
      },
    }),
    "browser_process_lineage_diagnostic_observation_failed",
  );
});

test("GATE-014-B1 classifies Windows lineage process-table failures without parsing error text", async () => {
  const commandError = Object.assign(new Error("private command detail"), {
    cause: new Error("private command cause"),
  });
  const observedTimeoutsMs: number[] = [];
  let commandCallCount = 0;
  await assert.rejects(
    readWindowsProcessTable({
      timeoutMs: 100,
      deadlineEpochMs: 200,
      now: () => 100,
      classifyLineageFailures: true,
      execFileImpl: async (
        _file: string,
        _args: string[],
        options: { timeout?: number },
      ) => {
        commandCallCount += 1;
        observedTimeoutsMs.push(options.timeout ?? -1);
        throw commandError;
      },
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
        "browser_process_lineage_table_command_failed" &&
      JSON.stringify(error).includes("private") === false,
  );
  assert.equal(commandCallCount, 1);
  assert.deepEqual(observedTimeoutsMs, [100]);

  await assert.rejects(
    readWindowsProcessTable({
      timeoutMs: 100,
      deadlineEpochMs: 200,
      now: () => 200,
      classifyLineageFailures: true,
      execFileImpl: async () => {
        throw commandError;
      },
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_table_command_deadline_elapsed_failed",
  );

  await assert.rejects(
    readWindowsProcessTable({
      timeoutMs: 100,
      deadlineEpochMs: 200,
      now: () => 100,
      classifyLineageFailures: true,
      execFileImpl: async () => ({ stdout: "not-json" }),
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_table_json_failed",
  );

  await assert.rejects(
    readWindowsProcessTable({
      timeoutMs: 100,
      deadlineEpochMs: 200,
      now: () => 100,
      classifyLineageFailures: true,
      execFileImpl: async () => ({
        stdout: JSON.stringify([
          { processId: 101, parentProcessId: 100 },
          { processId: 101, parentProcessId: 100 },
        ]),
      }),
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_lineage_table_validation_failed",
  );
});

test("GATE-014-B1 accepts a completed native tree termination only after the lineage is gone", () => {
  assert.equal(
    readCompletedWindowsTerminationOutcome({
      code: 128,
      killed: false,
      signal: null,
    }),
    "exit_numeric_nonzero",
  );
  for (const error of [
    { code: "ENOENT", killed: false, signal: null },
    { code: null, killed: true, signal: "SIGTERM" },
    { code: 128, killed: false, signal: "SIGTERM" },
    { code: 128, killed: undefined, signal: null },
    { code: 128, killed: false, signal: undefined },
  ]) {
    assert.throws(
      () => readCompletedWindowsTerminationOutcome(error),
      /chrome_process_tree_termination_failed/,
    );
  }
  assert.doesNotThrow(() =>
    validateWindowsChromeTerminationEvidence({
      nativeTerminationCompleted: true,
      nativeTerminationOutcome: "exit_zero",
      rootObservedBeforeTermination: true,
      rootRunningBeforeTermination: true,
      parentExited: true,
      survivingProcessIds: [],
    }),
  );
  assert.doesNotThrow(() =>
    validateWindowsChromeTerminationEvidence({
      nativeTerminationCompleted: true,
      nativeTerminationOutcome: "exit_numeric_nonzero",
      rootObservedBeforeTermination: true,
      rootRunningBeforeTermination: true,
      parentExited: true,
      survivingProcessIds: [],
    }),
  );
  assert.throws(
    () =>
      validateWindowsChromeTerminationEvidence({
        nativeTerminationCompleted: false,
        nativeTerminationOutcome: null,
        rootObservedBeforeTermination: true,
        rootRunningBeforeTermination: true,
        parentExited: true,
        survivingProcessIds: [],
      }),
    /chrome_process_tree_termination_failed/,
  );
  assert.throws(
    () =>
      validateWindowsChromeTerminationEvidence({
        nativeTerminationCompleted: true,
        nativeTerminationOutcome: "exit_zero",
        rootObservedBeforeTermination: false,
        rootRunningBeforeTermination: true,
        parentExited: true,
        survivingProcessIds: [],
      }),
    /chrome_process_tree_termination_failed/,
  );
  assert.throws(
    () =>
      validateWindowsChromeTerminationEvidence({
        nativeTerminationCompleted: true,
        nativeTerminationOutcome: "unexpected",
        rootObservedBeforeTermination: true,
        rootRunningBeforeTermination: true,
        parentExited: true,
        survivingProcessIds: [],
      }),
    /chrome_process_tree_termination_failed/,
  );
  assert.throws(
    () =>
      validateWindowsChromeTerminationEvidence({
        nativeTerminationCompleted: true,
        nativeTerminationOutcome: "exit_zero",
        rootObservedBeforeTermination: true,
        rootRunningBeforeTermination: false,
        parentExited: true,
        survivingProcessIds: [],
      }),
    /chrome_process_tree_termination_failed/,
  );
  assert.throws(
    () =>
      validateWindowsChromeTerminationEvidence({
        nativeTerminationCompleted: true,
        nativeTerminationOutcome: "exit_zero",
        rootObservedBeforeTermination: true,
        rootRunningBeforeTermination: true,
        parentExited: false,
        survivingProcessIds: [],
      }),
    /chrome_process_exit_timeout/,
  );
  assert.throws(
    () =>
      validateWindowsChromeTerminationEvidence({
        nativeTerminationCompleted: true,
        nativeTerminationOutcome: "exit_zero",
        rootObservedBeforeTermination: true,
        rootRunningBeforeTermination: true,
        parentExited: true,
        survivingProcessIds: [101],
      }),
    /chrome_process_tree_termination_failed/,
  );
});

test("GATE-014-B1 accepts only an explicit structured harness failure code", () => {
  const failureEnvelope = {
    contract: "gate-014-b1-controlled-evaluation-v1",
    status: "fail",
    value: null,
    failureCode: "fixture_read_batch_timing_unavailable:versions",
    storesSensitiveText: false,
  };
  let controlled: Error | null = null;
  try {
    unwrapControlledHarnessEvaluation(
      failureEnvelope,
      "browser_fixture_lifecycle_after_restart_failed",
    );
  } catch (error) {
    controlled = error as Error;
  }
  assert.notEqual(controlled, null);
  assert.equal(
    controlled?.message,
    "browser_fixture_lifecycle_after_restart_failed",
  );
  assert.equal(
    Object.hasOwn(controlled ?? {}, "gate014FailureCode"),
    true,
  );
  assert.equal(
    readB1BrowserControlledFailureCode(controlled),
    "fixture_read_batch_timing_unavailable:versions",
  );
  assert.equal(JSON.stringify(controlled), "{}");
});

test("GATE-014-B1 browser stages preserve proven codes and replace spoofed fields", async () => {
  const structuredEnvelope = {
    contract: "gate-014-b1-controlled-evaluation-v1",
    status: "fail",
    value: null,
    failureCode: "fixture_read_batch_timing_unavailable:versions",
    storesSensitiveText: false,
  };
  let proven: Error | null = null;
  try {
    unwrapControlledHarnessEvaluation(
      structuredEnvelope,
      "browser_fixture_lifecycle_after_restart_failed",
    );
  } catch (error) {
    proven = error as Error;
  }
  await assert.rejects(
    executeB1BrowserStage("browser_after_restart_control_failed", () => {
      throw proven;
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "fixture_read_batch_timing_unavailable:versions",
  );

  const spoofed = new Error("C:\\private\\raw browser failure") as Error & {
    gate014FailureCode?: string;
  };
  Object.defineProperty(spoofed, "gate014FailureCode", {
    enumerable: false,
    value: "synthetic_untrusted_code",
  });
  await assert.rejects(
    executeB1BrowserStage("browser_before_restart_control_failed", () => {
      throw spoofed;
    }),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
        "browser_before_restart_control_failed" &&
      JSON.stringify(error).includes("private") === false,
  );
  await assert.rejects(
    executeB1BrowserStage("untrusted_stage", async () => undefined),
    /browser_controlled_stage_invalid/,
  );

  const diagnosticStages = [
    "browser_production_stage_setup_failed",
    "browser_production_stage_cleanup_failed",
    "browser_environment_validation_failed",
    "browser_process_spawn_failed",
    "browser_target_observer_setup_failed",
    "browser_harness_load_failed",
    "browser_production_load_failed",
    "browser_runner_target_setup_failed",
    "browser_harness_ready_failed",
    "browser_extension_inventory_failed",
    "browser_production_worker_setup_failed",
    "browser_synthetic_startup_failed",
    "browser_production_uninstall_failed",
    "browser_harness_evaluation_failed",
    "browser_observation_settle_failed",
    "browser_process_cleanup_failed",
    "browser_process_termination_failed",
    "browser_cdp_close_failed",
    "browser_process_identity_failed",
    "browser_process_table_observation_failed",
    "browser_process_pretermination_state_failed",
    "browser_process_native_termination_failed",
    "browser_process_parent_exit_failed",
    "browser_process_lineage_cleanup_failed",
    "browser_process_lineage_observation_failed",
    "browser_process_lineage_deadline_before_observation_failed",
    "browser_process_lineage_table_observation_failed",
    "browser_process_lineage_table_command_failed",
    "browser_process_lineage_table_command_deadline_elapsed_failed",
    "browser_process_lineage_table_json_failed",
    "browser_process_lineage_table_validation_failed",
    "browser_process_lineage_deadline_after_observation_failed",
    "browser_process_lineage_survivors_failed",
    "browser_process_lineage_cleared_by_10s_failed",
    "browser_process_lineage_cleared_by_15s_failed",
    "browser_process_lineage_persistent_at_15s_failed",
    "browser_process_lineage_diagnostic_observation_failed",
    "browser_process_termination_validation_failed",
  ];
  for (const stageCode of diagnosticStages) {
    await assert.rejects(
      executeB1BrowserStage(stageCode, () => {
        throw new Error("synthetic stage failure");
      }),
      (error: unknown) =>
        readB1BrowserControlledFailureCode(error) === stageCode,
    );
  }
});

test("GATE-014-B1 browser cleanup runs without replacing a proven primary failure", async () => {
  let proven: Error | null = null;
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
    proven = error as Error;
  }
  let cleanupAttempted = false;
  await assert.rejects(
    executeB1BrowserOperationWithCleanup(
      async () => {
        throw proven;
      },
      () =>
        executeB1BrowserStage(
          "browser_lifecycle_server_cleanup_failed",
          async () => {
            cleanupAttempted = true;
            throw new Error("C:\\private\\server cleanup failed");
          },
        ),
    ),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "fixture_read_batch_timing_unavailable:versions",
  );
  assert.equal(cleanupAttempted, true);

  let firstServerClosed = false;
  await assert.rejects(
    executeB1BrowserOperationWithCleanup(
      () =>
        executeB1BrowserStage(
          "browser_lifecycle_server_setup_failed",
          async () => {
            throw new Error("second synthetic server failed");
          },
        ),
      async () => {
        firstServerClosed = true;
      },
    ),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_lifecycle_server_setup_failed",
  );
  assert.equal(firstServerClosed, true);
});

test("GATE-014-B1 async browser spawn errors stay controlled and still clean up", async () => {
  const child = new EventEmitter();
  let cleanupAttempted = false;
  const operation = executeB1BrowserOperationWithCleanup(
    () =>
      executeB1BrowserStage("browser_process_spawn_failed", () =>
        waitForB1BrowserProcessSpawn(child),
      ),
    async () => {
      cleanupAttempted = true;
    },
  );
  queueMicrotask(() => {
    child.emit("error", new Error("synthetic asynchronous spawn failure"));
  });
  await assert.rejects(
    operation,
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_spawn_failed",
  );
  assert.equal(cleanupAttempted, true);
  assert.equal(child.listenerCount("spawn"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("GATE-014-B1 process termination failure wins while CDP close still runs", async () => {
  let cdpCloseAttempted = false;
  await assert.rejects(
    executeB1BrowserStage("browser_process_cleanup_failed", () =>
      executeB1BrowserOperationWithCleanup(
        () =>
          executeB1BrowserStage("browser_process_parent_exit_failed", () => {
            throw new Error("synthetic parent exit timeout");
          }),
        () =>
          executeB1BrowserStage("browser_cdp_close_failed", () => {
            cdpCloseAttempted = true;
            throw new Error("synthetic CDP close failure");
          }),
      ),
    ),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_parent_exit_failed",
  );
  assert.equal(cdpCloseAttempted, true);
});

test("GATE-014-B1 observes the real asynchronous spawn error boundary", async () => {
  const child = spawnChildProcess(
    path.join(tmpdir(), "gate-014-b1-executable-does-not-exist"),
    [],
    { stdio: "ignore" },
  );
  await assert.rejects(
    executeB1BrowserStage("browser_process_spawn_failed", () =>
      waitForB1BrowserProcessSpawn(child),
    ),
    (error: unknown) =>
      readB1BrowserControlledFailureCode(error) ===
      "browser_process_spawn_failed",
  );
});

test("GATE-014-B1 browser cleanup treats nullish throws as failures and awaits every close", async () => {
  let primaryRejected = false;
  try {
    await executeB1BrowserOperationWithCleanup(
      async () => {
        throw null;
      },
      async () => undefined,
    );
  } catch (error) {
    primaryRejected = true;
    assert.equal(error, null);
  }
  assert.equal(primaryRejected, true);

  let cleanupRejected = false;
  try {
    await executeB1BrowserOperationWithCleanup(
      async () => "completed",
      async () => Promise.reject(undefined),
    );
  } catch (error) {
    cleanupRejected = true;
    assert.equal(error, undefined);
  }
  assert.equal(cleanupRejected, true);

  let delayedCloseSettled = false;
  const delayedClose = new Promise<void>((resolve) => {
    setTimeout(() => {
      delayedCloseSettled = true;
      resolve();
    }, 30);
  });
  await assert.rejects(
    settleB1FixtureServerCleanup([
      {
        close: () =>
          closeB1FixtureHttpServer({
            close: (callback: (error?: Error) => void) => {
              callback(new Error("synthetic callback close failure"));
            },
          }),
      },
      { close: async () => delayedClose },
    ]),
    /browser_fixture_server_cleanup_incomplete/,
  );
  assert.equal(delayedCloseSettled, true);
});

test("GATE-014-B1 validates the controlled browser evaluation envelope", () => {
  const pass = {
    contract: "gate-014-b1-controlled-evaluation-v1",
    status: "pass",
    value: { status: "pass" },
    failureCode: null,
    storesSensitiveText: false,
  };
  assert.equal(validateControlledHarnessEvaluation(pass), pass);
  const fail = {
    contract: "gate-014-b1-controlled-evaluation-v1",
    status: "fail",
    value: null,
    failureCode: "fixture_read_batch_timing_unavailable:versions",
    storesSensitiveText: false,
  };
  assert.equal(validateControlledHarnessEvaluation(fail), fail);
  for (const invalid of [
    { ...pass, extra: true },
    { ...pass, status: "fail" },
    { ...fail, failureCode: "C:\\private\\raw-error" },
    { ...fail, value: {} },
  ]) {
    assert.throws(
      () => validateControlledHarnessEvaluation(invalid),
      /browser_controlled_harness_evaluation_invalid/,
    );
  }
});

test("GATE-014-B1 harness wrapper returns only an owned controlled code", async () => {
  await import("./fixtures/gate-014/b1-extension/runner.js");
  const runControlled = (
    globalThis as typeof globalThis & {
      runGate014B1ControlledEvaluation: (
        operation: () => unknown,
      ) => Promise<Record<string, unknown>>;
    }
  ).runGate014B1ControlledEvaluation;
  const controlledCode = "fixture_read_batch_timing_unavailable:versions";
  const factoryError = createFixtureHarnessError(controlledCode);
  assert.equal(readFixtureHarnessFailureCode(factoryError), controlledCode);
  const controlled = await runControlled(() => {
    throw factoryError;
  });
  assert.equal(controlled.status, "fail");
  assert.equal(controlled.failureCode, controlledCode);
  assert.equal(JSON.stringify(controlled).includes("private"), false);

  const raw = await runControlled(() => {
    throw new Error("C:\\private\\raw browser error");
  });
  assert.equal(raw.status, "fail");
  assert.equal(raw.failureCode, null);
  assert.equal(JSON.stringify(raw).includes("private"), false);

  const spoofed = new Error("generic harness failure") as Error & {
    gate014FailureCode?: string;
  };
  Object.defineProperty(spoofed, "gate014FailureCode", {
    enumerable: false,
    value: "synthetic_untrusted_code",
  });
  assert.equal(readFixtureHarnessFailureCode(spoofed), null);
  const rejectedSpoof = await runControlled(() => {
    throw spoofed;
  });
  assert.equal(rejectedSpoof.status, "fail");
  assert.equal(rejectedSpoof.failureCode, null);
});

test("GATE-014-B1 generated controlled evaluation expression compiles and unwraps both outcomes", async () => {
  const expression = createControlledHarnessEvaluationExpression(
    "Promise.resolve({ status: 'pass', operationCount: 13 })",
  );
  const evaluate = new Function("globalThis", `return ${expression}`) as (
    controlledGlobal: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  const envelope = await evaluate({
    async runGate014B1ControlledEvaluation(operation: () => unknown) {
      return {
        contract: "gate-014-b1-controlled-evaluation-v1",
        status: "pass",
        value: await operation(),
        failureCode: null,
        storesSensitiveText: false,
      };
    },
  });
  assert.deepEqual(
    unwrapControlledHarnessEvaluation(
      envelope,
      "browser_fixture_lifecycle_after_restart_failed",
    ),
    { status: "pass", operationCount: 13 },
  );

  const failureEnvelope = {
    contract: "gate-014-b1-controlled-evaluation-v1",
    status: "fail",
    value: null,
    failureCode: "fixture_read_batch_timing_unavailable:versions",
    storesSensitiveText: false,
  };
  assert.throws(
    () =>
      unwrapControlledHarnessEvaluation(
        failureEnvelope,
        "browser_fixture_lifecycle_after_restart_failed",
      ),
    (error: unknown) =>
      error instanceof Error &&
      (
        error as Error & { gate014FailureCode?: string }
      ).gate014FailureCode ===
        "fixture_read_batch_timing_unavailable:versions",
  );
  assert.throws(
    () => createControlledHarnessEvaluationExpression("  "),
    /browser_controlled_harness_expression_invalid/,
  );
});

test("GATE-014-B1 attributes extension errors without treating Chrome internal logs as extension failures", () => {
  assert.equal(
    classifyObservedErrorEvent({ method: "Runtime.exceptionThrown" }),
    "extension_error",
  );
  assert.equal(
    classifyObservedErrorEvent({
      method: "Runtime.consoleAPICalled",
      params: { type: "error" },
    }),
    "extension_error",
  );
  assert.equal(
    classifyObservedErrorEvent({
      method: "Log.entryAdded",
      params: {
        entry: {
          level: "error",
          source: "network",
          url: `chrome-extension://${B1_HARNESS_EXTENSION_ID}/runner.js`,
        },
      },
    }),
    "extension_error",
  );
  assert.equal(
    classifyObservedErrorEvent({
      method: "Log.entryAdded",
      params: { entry: { level: "error", source: "other" } },
    }),
    "unattributed_log_error",
  );
  assert.equal(
    classifyObservedErrorEvent({
      method: "Log.entryAdded",
      params: {
        entry: {
          level: "error",
          source: "other",
          url: `chrome-extension://${B1_HARNESS_EXTENSION_ID}/runner.js`,
        },
      },
    }),
    "unattributed_log_error",
  );
  assert.equal(
    classifyObservedErrorEvent({
      method: "Log.entryAdded",
      params: { entry: { level: "error", source: "javascript" } },
    }),
    "extension_error",
  );
  assert.equal(
    classifyObservedErrorEvent({
      method: "Log.entryAdded",
      params: { entry: { level: "warning", source: "other" } },
    }),
    null,
  );
});

test("GATE-014-B1 fulfills production startup API requests with a synthetic unauthenticated response", async () => {
  const productionExtensionId = "b".repeat(32);
  const listeners = new Set<(message: Record<string, unknown>) => void>();
  const sent: Array<{
    method: string;
    params: Record<string, unknown>;
    sessionId?: string;
  }> = [];
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ) {
      sent.push({ method, params, sessionId });
      return {};
    },
  };
  const emit = (message: Record<string, unknown>) => {
    for (const listener of listeners) listener(message);
  };
  const observation = createCdpExecutionObservation(client);
  observation.observeSession("production-session", productionExtensionId);
  observation.observeSession("harness-session", B1_HARNESS_EXTENSION_ID);

  emit({
    sessionId: "production-session",
    method: "Network.requestWillBeSent",
    params: {
      requestId: "network-request-1",
      request: {
        method: "GET",
        url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      },
    },
  });
  emit({
    sessionId: "production-session",
    method: "Fetch.requestPaused",
    params: {
      requestId: "fetch-request-1",
      networkId: "network-request-1",
      request: {
        method: "GET",
        url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      },
    },
  });
  observation.setRequiredExtensionIds({
    productionExtensionId,
    harnessExtensionId: B1_HARNESS_EXTENSION_ID,
  });
  emit({
    sessionId: "production-session",
    method: "Network.responseReceived",
    params: {
      requestId: "network-request-1",
      response: {
        url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      },
    },
  });
  await observation.waitForSyntheticUnauthenticatedResponse();

  const receipt = observation.finish();
  assert.equal(receipt.contract, "gate-014-b1-browser-observation-v4");
  assert.equal(receipt.externalRequestAttemptCount, 1);
  assert.equal(receipt.syntheticUnauthenticatedResponseCount, 1);
  assert.equal(receipt.externalResponseCount, 0);
  assert.equal(receipt.consoleErrorCount, 0);
  const fulfillment = sent.find(
    ({ method }) => method === "Fetch.fulfillRequest",
  );
  assert.equal(fulfillment?.sessionId, "production-session");
  const body = JSON.parse(
    Buffer.from(String(fulfillment?.params.body), "base64").toString("utf8"),
  );
  assert.equal(body.code, -101);
});

test("GATE-014-B1 requires the production startup response before workload execution", async () => {
  const productionExtensionId = "b".repeat(32);
  const observation = createCdpExecutionObservation({
    onEvent() {
      return () => {};
    },
    async send() {
      return {};
    },
  });
  observation.observeSession("production-session", productionExtensionId);
  observation.setRequiredExtensionIds({
    productionExtensionId,
    harnessExtensionId: B1_HARNESS_EXTENSION_ID,
  });
  await assert.rejects(
    () => observation.waitForSyntheticUnauthenticatedResponse({ timeoutMs: 5 }),
    /browser_synthetic_response_observation_incomplete|cdp_command_timeout/,
  );
});

test("GATE-014-B1 bounds a pending startup fulfillment by the shared deadline", async () => {
  const productionExtensionId = "b".repeat(32);
  let listener: ((message: Record<string, unknown>) => void) | null = null;
  const observation = createCdpExecutionObservation({
    onEvent(nextListener: (message: Record<string, unknown>) => void) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    async send(method: string) {
      if (method === "Fetch.fulfillRequest") {
        return new Promise(() => {});
      }
      return {};
    },
  });
  observation.observeSession("production-session", productionExtensionId);
  observation.setRequiredExtensionIds({
    productionExtensionId,
    harnessExtensionId: B1_HARNESS_EXTENSION_ID,
  });
  listener?.({
    sessionId: "production-session",
    method: "Fetch.requestPaused",
    params: {
      requestId: "pending-fetch-request",
      networkId: "pending-network-request",
      request: {
        method: "GET",
        url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      },
    },
  });
  const deadlineEpochMs = Date.now() + 20;
  await assert.rejects(
    () =>
      observation.waitForSyntheticUnauthenticatedResponse({
        deadlineEpochMs,
      }),
    /cdp_command_timeout/,
  );
  const deadlineOverrunMs = Date.now() - deadlineEpochMs;
  assert.equal(deadlineOverrunMs >= 0 && deadlineOverrunMs < 200, true);
});

test("GATE-014-B1 accepts exactly eight pre-identity startup requests", async () => {
  const productionExtensionId = "b".repeat(32);
  const listeners = new Set<(message: Record<string, unknown>) => void>();
  const observation = createCdpExecutionObservation({
    onEvent(listener: (message: Record<string, unknown>) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send() {
      return {};
    },
  });
  const emit = (message: Record<string, unknown>) => {
    for (const listener of listeners) listener(message);
  };
  observation.observeSession("production-session", productionExtensionId);
  observation.observeSession("harness-session", B1_HARNESS_EXTENSION_ID);
  for (let index = 0; index < 8; index += 1) {
    const networkId = `network-request-${index}`;
    const request = {
      method: "GET",
      url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
    };
    emit({
      sessionId: "production-session",
      method: "Network.requestWillBeSent",
      params: { requestId: networkId, request },
    });
    emit({
      sessionId: "production-session",
      method: "Fetch.requestPaused",
      params: {
        requestId: `fetch-request-${index}`,
        networkId,
        request,
      },
    });
  }
  observation.setRequiredExtensionIds({
    productionExtensionId,
    harnessExtensionId: B1_HARNESS_EXTENSION_ID,
  });
  for (let index = 0; index < 8; index += 1) {
    emit({
      sessionId: "production-session",
      method: "Network.responseReceived",
      params: {
        requestId: `network-request-${index}`,
        response: {
          url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
        },
      },
    });
  }
  await observation.settle();
  assert.equal(observation.finish().syntheticUnauthenticatedResponseCount, 8);
});

test("GATE-014-B1 fails closed on a ninth pre-identity startup request", async () => {
  const productionExtensionId = "b".repeat(32);
  let listener: ((message: Record<string, unknown>) => void) | null = null;
  const sentMethods: string[] = [];
  const observation = createCdpExecutionObservation({
    onEvent(nextListener: (message: Record<string, unknown>) => void) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    async send(method: string) {
      sentMethods.push(method);
      return {};
    },
  });
  observation.observeSession("production-session", productionExtensionId);
  const request = {
    method: "GET",
    url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
  };
  for (let index = 0; index < 9; index += 1) {
    listener?.({
      sessionId: "production-session",
      method: "Fetch.requestPaused",
      params: {
        requestId: `fetch-request-${index}`,
        networkId: `network-request-${index}`,
        request,
      },
    });
  }
  await assert.rejects(
    () => observation.settle(),
    /browser_synthetic_unauthenticated_response_failed/,
  );
  assert.equal(sentMethods.includes("Fetch.failRequest"), true);
});

test("GATE-014-B1 rejects a queued pre-identity request from another extension", async () => {
  const productionExtensionId = "b".repeat(32);
  const otherExtensionId = "c".repeat(32);
  let listener: ((message: Record<string, unknown>) => void) | null = null;
  const sentMethods: string[] = [];
  const observation = createCdpExecutionObservation({
    onEvent(nextListener: (message: Record<string, unknown>) => void) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    async send(method: string) {
      sentMethods.push(method);
      return {};
    },
  });
  observation.observeSession("other-session", otherExtensionId);
  observation.observeSession("production-session", productionExtensionId);
  observation.observeSession("harness-session", B1_HARNESS_EXTENSION_ID);
  listener?.({
    sessionId: "other-session",
    method: "Fetch.requestPaused",
    params: {
      requestId: "fetch-request-1",
      networkId: "network-request-1",
      request: {
        method: "GET",
        url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      },
    },
  });
  observation.setRequiredExtensionIds({
    productionExtensionId,
    harnessExtensionId: B1_HARNESS_EXTENSION_ID,
  });
  await assert.rejects(
    () => observation.settle(),
    /browser_synthetic_unauthenticated_response_failed/,
  );
  assert.deepEqual(sentMethods, ["Fetch.failRequest"]);
});

test("GATE-014-B1 fails closed when the synthetic unauthenticated response cannot be delivered", async () => {
  const productionExtensionId = "b".repeat(32);
  let listener: ((message: Record<string, unknown>) => void) | null = null;
  const observation = createCdpExecutionObservation({
    onEvent(nextListener: (message: Record<string, unknown>) => void) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    async send(method: string) {
      if (method === "Fetch.fulfillRequest") {
        throw new Error("synthetic transport unavailable");
      }
      return {};
    },
  });
  observation.observeSession("production-session", productionExtensionId);
  observation.observeSession("harness-session", B1_HARNESS_EXTENSION_ID);
  observation.setRequiredExtensionIds({
    productionExtensionId,
    harnessExtensionId: B1_HARNESS_EXTENSION_ID,
  });
  listener?.({
    sessionId: "production-session",
    method: "Fetch.requestPaused",
    params: {
      requestId: "fetch-request-1",
      networkId: "network-request-1",
      request: {
        method: "GET",
        url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      },
    },
  });
  await assert.rejects(
    () => observation.settle(),
    /browser_synthetic_unauthenticated_response_failed/,
  );
});

test("GATE-014-B1 rejects synthetic responses outside the verified production startup request", async () => {
  const productionExtensionId = "b".repeat(32);
  const otherExtensionId = "c".repeat(32);

  for (const testCase of [
    {
      sessionId: "other-session",
      observedExtensionId: otherExtensionId,
      url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
    },
    {
      sessionId: "production-session",
      observedExtensionId: productionExtensionId,
      url: "https://api.bilibili.com/x/web-interface/nav",
    },
    {
      sessionId: "production-session",
      observedExtensionId: productionExtensionId,
      url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=20",
    },
    {
      sessionId: "production-session",
      observedExtensionId: productionExtensionId,
      url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30&",
    },
    {
      sessionId: "production-session",
      observedExtensionId: productionExtensionId,
      url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=%33%30",
    },
    {
      sessionId: "production-session",
      observedExtensionId: productionExtensionId,
      url: "https://api.bilibili.com/x/unused/../web-interface/history/cursor?ps=30",
    },
  ]) {
    let listener: ((message: Record<string, unknown>) => void) | null = null;
    const sentMethods: string[] = [];
    const observation = createCdpExecutionObservation({
      onEvent(nextListener: (message: Record<string, unknown>) => void) {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      async send(method: string) {
        sentMethods.push(method);
        return {};
      },
    });
    observation.observeSession(testCase.sessionId, testCase.observedExtensionId);
    observation.observeSession("harness-session", B1_HARNESS_EXTENSION_ID);
    if (testCase.observedExtensionId !== productionExtensionId) {
      observation.observeSession("production-session", productionExtensionId);
    }
    observation.setRequiredExtensionIds({
      productionExtensionId,
      harnessExtensionId: B1_HARNESS_EXTENSION_ID,
    });
    listener?.({
      sessionId: testCase.sessionId,
      method: "Fetch.requestPaused",
      params: {
        requestId: "fetch-request-1",
        networkId: "network-request-1",
        request: { method: "GET", url: testCase.url },
      },
    });
    await assert.rejects(
      () => observation.settle(),
      /browser_synthetic_unauthenticated_response_failed/,
    );
    assert.deepEqual(sentMethods, ["Fetch.failRequest"]);
  }
});

test("GATE-014-B1 rejects an unclosed synthetic request and response correlation", async () => {
  const productionExtensionId = "b".repeat(32);
  let listener: ((message: Record<string, unknown>) => void) | null = null;
  const observation = createCdpExecutionObservation({
    onEvent(nextListener: (message: Record<string, unknown>) => void) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    async send() {
      return {};
    },
  });
  observation.observeSession("production-session", productionExtensionId);
  observation.observeSession("harness-session", B1_HARNESS_EXTENSION_ID);
  observation.setRequiredExtensionIds({
    productionExtensionId,
    harnessExtensionId: B1_HARNESS_EXTENSION_ID,
  });
  listener?.({
    sessionId: "production-session",
    method: "Fetch.requestPaused",
    params: {
      requestId: "fetch-request-1",
      networkId: "network-request-1",
      request: {
        method: "GET",
        url: "https://api.bilibili.com/x/web-interface/history/cursor?ps=30",
      },
    },
  });
  await assert.rejects(
    () => observation.settle(5),
    /browser_synthetic_response_observation_incomplete/,
  );
  assert.throws(
    () => observation.finish(),
    /browser_synthetic_unauthenticated_response_failed/,
  );
});

test("GATE-014-B1 browser observation fails closed on external requests or console errors", () => {
  const passing = {
    contract: "gate-014-b1-browser-observation-v4",
    browserLaunchCount: 1,
    observationScope:
      "extension_targets_after_devtools_attach_with_production_worker_barrier",
    preAttachEventsObserved: false,
    productionServiceWorkerStartupBarrierEnabled: true,
    observedTargetCount: 2,
    productionExtensionTargetCount: 1,
    harnessExtensionTargetCount: 1,
    networkMetricAvailable: true,
    networkRequestCount: 3,
    loopbackRequestCount: 1,
    extensionRequestCount: 1,
    externalRequestAttemptCount: 1,
    syntheticUnauthenticatedResponseCount: 1,
    externalResponseCount: 0,
    consoleMetricAvailable: true,
    consoleErrorCount: 0,
    unattributedLogErrorCount: 1,
  };
  assert.equal(
    validateBrowserExecutionObservation(passing).browserLaunchCount,
    1,
  );
  assert.equal(
    combineBrowserExecutionObservations(passing, passing).browserLaunchCount,
    2,
  );
  assert.equal(
    combineBrowserExecutionObservations(passing, passing)
      .productionExtensionTargetCount,
    2,
  );
  assert.throws(
    () =>
      validateBrowserExecutionObservation({
        ...passing,
        productionExtensionTargetCount: 0,
      }),
    /observation_failed/,
  );
  assert.throws(
    () =>
      validateBrowserExecutionObservation({
        ...passing,
        externalResponseCount: 1,
      }),
    /observation_failed/,
  );
  assert.throws(
    () =>
      validateBrowserExecutionObservation({
        ...passing,
        consoleErrorCount: 1,
      }),
    /observation_failed/,
  );
  assert.throws(
    () =>
      validateBrowserExecutionObservation({
        ...passing,
        externalRequestAttemptCount: 0,
      }),
    /observation_failed/,
  );
  assert.throws(
    () =>
      validateBrowserExecutionObservation({
        ...passing,
        syntheticUnauthenticatedResponseCount: 0,
      }),
    /observation_failed/,
  );
  assert.throws(
    () =>
      validateBrowserExecutionObservation({
        ...passing,
        contract: "gate-014-b1-browser-observation-v2",
      }),
    /observation_failed/,
  );
  assert.throws(
    () =>
      validateBrowserExecutionObservation({
        ...passing,
        unexpected: true,
      }),
    /observation_failed/,
  );
});

test("GATE-014-B1 proves the expected production and harness extensions are loaded", () => {
  const expectedProduction = {
    name: "Bili-Bill",
    version: "0.13.0",
    versionName: "0.13.0-alpha",
  };
  const productionExtensionId = "b".repeat(32);
  const harness = {
    id: B1_HARNESS_EXTENSION_ID,
    name: "Bili-Bill GATE-014-B1 Harness",
    version: "1.0.0",
    versionName: null,
    enabled: true,
    type: "extension",
  };
  const production = {
    id: productionExtensionId,
    ...expectedProduction,
    enabled: true,
    type: "extension",
  };
  assert.deepEqual(
    validateLoadedExtensionInventory(
      [
        {
          id: "c".repeat(32),
          name: "Unrelated component",
          version: "1.0.0",
          versionName: null,
          enabled: true,
          type: "extension",
        },
        harness,
        production,
      ],
      expectedProduction,
    ),
    { productionExtensionId },
  );
  for (const inventory of [
    [harness],
    [production],
    [harness, { ...production, enabled: false }],
    [harness, production, { ...production, id: "d".repeat(32) }],
  ]) {
    assert.throws(
      () => validateLoadedExtensionInventory(inventory, expectedProduction),
      /required_extensions_not_loaded/,
    );
  }
});

test("GATE-014-B1 binds production runtime proof only to its service worker and polls", async () => {
  const productionExtensionId = "b".repeat(32);
  const pageTarget = {
    targetId: "product-page",
    type: "page",
    url: `chrome-extension://${productionExtensionId}/dashboard/index.html`,
  };
  const workerTarget = {
    targetId: "production-worker",
    type: "service_worker",
    url: `chrome-extension://${productionExtensionId}/background.js`,
  };
  assert.equal(
    selectProductionServiceWorkerTarget([pageTarget], productionExtensionId),
    null,
  );
  assert.deepEqual(
    selectProductionServiceWorkerTarget(
      [pageTarget, workerTarget],
      productionExtensionId,
    ),
    workerTarget,
  );

  let discoveryCount = 0;
  const client = {
    async send(method) {
      assert.equal(method, "Target.getTargets");
      discoveryCount += 1;
      return {
        targetInfos:
          discoveryCount === 1 ? [pageTarget] : [pageTarget, workerTarget],
      };
    },
  };
  const targetObserver = {
    async ensureServiceWorkerTargetId(targetId, extensionId) {
      assert.equal(targetId, workerTarget.targetId);
      assert.equal(extensionId, productionExtensionId);
      return "production-worker-session";
    },
  };
  assert.equal(
    await findProductionServiceWorkerSession(
      client,
      targetObserver,
      productionExtensionId,
      { timeoutMs: 100, pollIntervalMs: 0 },
    ),
    "production-worker-session",
  );
  assert.equal(discoveryCount, 2);

  let lateTargetAttached = false;
  const lateClient = {
    async send() {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { targetInfos: [workerTarget] };
    },
  };
  assert.equal(
    await findProductionServiceWorkerSession(
      lateClient,
      {
        async ensureServiceWorkerTargetId() {
          lateTargetAttached = true;
          return "late-session";
        },
      },
      productionExtensionId,
      { timeoutMs: 5, pollIntervalMs: 0 },
    ),
    null,
  );
  assert.equal(lateTargetAttached, false);

  const expectedProduction = {
    name: "Bili-Bill",
    version: "0.13.0",
    versionName: "0.13.0-alpha",
  };
  await assert.rejects(
    () =>
      waitForProductionExtensionReady(
        {
          async send() {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
              result: {
                value: { id: productionExtensionId, ...expectedProduction },
              },
            };
          },
        },
        "production-worker-session",
        productionExtensionId,
        expectedProduction,
        { timeoutMs: 5, pollIntervalMs: 0 },
      ),
    /runtime_identity_failed/,
  );
});

test("GATE-014-B1 keeps a cached production attachment inside the shared setup deadline", async () => {
  const productionExtensionId = "b".repeat(32);
  const workerTarget = {
    targetId: "production-worker",
    type: "service_worker",
    url: `chrome-extension://${productionExtensionId}/background.js`,
  };
  const expectedProduction = {
    name: "Bili-Bill",
    version: "0.13.0",
    versionName: "0.13.0-alpha",
  };
  let eventListener: ((message: Record<string, unknown>) => void) | null = null;
  let discoveryCount = 0;
  let resumeCount = 0;
  let runtimeIdentityCount = 0;
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
    async send(method, params) {
      if (method === "Target.setAutoAttach") {
        return {};
      }
      if (method === "Target.setDiscoverTargets") {
        return {};
      }
      if (method === "Target.getTargets") {
        discoveryCount += 1;
        return { targetInfos: discoveryCount === 1 ? [] : [workerTarget] };
      }
      if (method === "Target.getTargetInfo") {
        return { targetInfo: workerTarget };
      }
      if (method === "Target.attachToTarget") {
        throw new Error("service_worker_must_use_auto_attach");
      }
      if (
        ["Runtime.enable", "Network.enable", "Log.enable", "Fetch.enable"].includes(
          method,
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {};
      }
      if (method === "Runtime.runIfWaitingForDebugger") {
        resumeCount += 1;
        return {};
      }
      if (method === "Runtime.evaluate") {
        runtimeIdentityCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 180));
        return {
          result: {
            value: { id: productionExtensionId, ...expectedProduction },
          },
        };
      }
      throw new Error(`unexpected_method:${method}`);
    },
  };
  const observer = createExtensionTargetObserver(client, {
    observeSession() {},
  });
  const sharedDeadlineEpochMs = Date.now() + 200;
  await observer.start({ deadlineEpochMs: sharedDeadlineEpochMs });
  eventListener?.({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "cached-production-session",
      targetInfo: workerTarget,
      waitingForDebugger: true,
    },
  });
  const sessionId = await findProductionServiceWorkerSession(
    client,
    observer,
    productionExtensionId,
    { deadlineEpochMs: sharedDeadlineEpochMs, pollIntervalMs: 0 },
  );
  assert.equal(sessionId, "cached-production-session");
  assert.equal(resumeCount, 1);
  await assert.rejects(
    () =>
      waitForProductionExtensionReady(
        client,
        sessionId,
        productionExtensionId,
        expectedProduction,
        { deadlineEpochMs: sharedDeadlineEpochMs, pollIntervalMs: 0 },
      ),
    /runtime_identity_failed/,
  );
  assert.equal(runtimeIdentityCount, 1);
  observer.completeSetup();
  await observer.stop();
});

test("GATE-014-B1 rejects a worker not configured before the setup deadline", async () => {
  const extensionId = "b".repeat(32);
  const workerTarget = {
    targetId: "slow-production-worker",
    type: "service_worker",
    url: `chrome-extension://${extensionId}/background.js`,
  };
  let attachmentCompleted = false;
  let eventListener: ((message: Record<string, unknown>) => void) | null = null;
  const client = {
    onEvent(listener: (message: Record<string, unknown>) => void) {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
    async send(method, params) {
      if (method === "Target.setAutoAttach") {
        return {};
      }
      if (method === "Target.setDiscoverTargets") {
        if (params.discover === true) {
          setImmediate(() => {
            eventListener?.({
              method: "Target.attachedToTarget",
              params: {
                sessionId: "late-initial-session",
                targetInfo: workerTarget,
                waitingForDebugger: true,
              },
            });
          });
        }
        return {};
      }
      if (method === "Target.getTargets") {
        return { targetInfos: [workerTarget] };
      }
      if (method === "Target.attachToTarget") {
        throw new Error("service_worker_must_use_auto_attach");
      }
      if (
        ["Runtime.enable", "Network.enable", "Log.enable", "Fetch.enable"].includes(
          method,
        )
      ) {
        if (method === "Runtime.enable") {
          await new Promise((resolve) => setTimeout(resolve, 30));
          attachmentCompleted = true;
        }
        return {};
      }
      if (method === "Runtime.runIfWaitingForDebugger") {
        return {};
      }
      throw new Error(`unexpected_method:${method}`);
    },
  };
  const observer = createExtensionTargetObserver(client, {
    observeSession() {},
  });
  await assert.rejects(
    () => observer.start({ deadlineEpochMs: Date.now() + 5 }),
    /cdp_command_timeout|browser_extension_startup_barrier_missing/,
  );
  assert.equal(attachmentCompleted, false);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(attachmentCompleted, true);
  observer.completeSetup();
  await assert.rejects(
    () => observer.stop(),
    /browser_extension_startup_barrier_missing/,
  );
});

test("GATE-014-B1 browser smoke accepts only the fixed public-safe harness identity", () => {
  const result = validateSmokeResult({
    contract: "gate-014-b1-browser-smoke-v1",
    status: "pass",
    extensionId: B1_HARNESS_EXTENSION_ID,
    indexedDbAvailable: true,
    readbackVerified: true,
    storesSensitiveText: false,
  });
  assert.equal(result.status, "pass");
  assert.equal(Object.isFrozen(result), true);

  assert.throws(
    () =>
      validateSmokeResult({
        ...result,
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    /identity_mismatch/,
  );
  assert.throws(
    () => validateSmokeResult({ ...result, storesSensitiveText: true }),
    /public_safety_failed/,
  );
});

test("GATE-014-B1 accepts only profiles created by its temporary-profile manager", async () => {
  const profile = await createB1TemporaryProfile();
  assert.equal(profile.contract, "gate-014-b1-temporary-profile-v1");
  await removeB1TemporaryProfile(profile);

  await assert.rejects(
    () => removeB1TemporaryProfile(profile),
    /profile_not_managed/,
  );
  await assert.rejects(
    () =>
      removeB1TemporaryProfile({
        contract: "gate-014-b1-temporary-profile-v1",
        directory: path.resolve("not-a-managed-profile"),
      }),
    /profile_not_managed/,
  );
});
