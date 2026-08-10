import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  FIXTURE_DEFINITIONS,
  GENERATED_FIXTURE_RELATIVE_DIR,
  cleanupGeneratedFixtureArtifacts,
  writeFixtureArtifact,
} from "./gate-014-fixture-generator.mjs";
import { B1_OPERATION_KINDS } from "./gate-014-b1-receipt.mjs";

export const B1_HARNESS_EXTENSION_ID = "aeangaiofkodlenmmejflbojmomlamoj";
export const B1_LIFECYCLE_EVALUATION_TIMEOUT_MS = 45 * 60 * 1_000;
const B1_CDP_SETUP_TIMEOUT_MS = 30_000;
const execFile = promisify(execFileCallback);
const CFT_STABLE_VERSION_SOURCE =
  "official_last_known_good_versions_with_downloads_json";

const MANAGED_PROFILE_DIRECTORIES = new Set();

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_CHROME_PATHS = [
  path.join(
    process.env.ProgramFiles ?? "",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  ),
  path.join(
    process.env["ProgramFiles(x86)"] ?? "",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  ),
  path.join(
    process.env.LOCALAPPDATA ?? "",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  ),
];

export async function createB1TemporaryProfile() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bili-bill-gate-014-b1-profile-"),
  );
  MANAGED_PROFILE_DIRECTORIES.add(directory);
  return Object.freeze({
    contract: "gate-014-b1-temporary-profile-v1",
    directory,
  });
}

export async function removeB1TemporaryProfile(profile) {
  const directory = requireManagedProfile(profile);
  try {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    });
  } finally {
    MANAGED_PROFILE_DIRECTORIES.delete(directory);
  }
}

export function buildChromeArguments({
  profileDirectory,
  productionExtension,
  harnessExtension,
}) {
  for (const [label, value] of Object.entries({
    profileDirectory,
    productionExtension,
    harnessExtension,
  })) {
    if (!path.isAbsolute(value)) {
      throw new Error(`${label} must be an absolute path`);
    }
  }
  const extensions = `${productionExtension},${harnessExtension}`;
  return [
    "--headless=new",
    `--user-data-dir=${profileDirectory}`,
    "--remote-debugging-port=0",
    `--disable-extensions-except=${extensions}`,
    `--load-extension=${extensions}`,
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-precise-memory-info",
    "--disable-features=MediaRouter,OptimizationHints,Translate",
    "--host-resolver-rules=MAP * 0.0.0.0,EXCLUDE 127.0.0.1",
    "about:blank",
  ];
}

export async function resolveChromeExecutable(explicitPath) {
  const candidates = explicitPath
    ? [path.resolve(explicitPath)]
    : DEFAULT_CHROME_PATHS;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next standard executable location.
    }
  }
  throw new Error("stable_chrome_not_found");
}

export function validateChromeForTestingMetadata(
  metadata,
  expectedStableVersion,
) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(expectedStableVersion ?? "")) {
    throw new Error("official_cft_stable_version_required");
  }
  const version = metadata?.productVersion
    ?.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (!/Chrome for Testing/i.test(metadata?.productName ?? "") || !version) {
    throw new Error("official_chrome_for_testing_required");
  }
  if (version !== expectedStableVersion) {
    throw new Error("chrome_for_testing_stable_version_mismatch");
  }
  return Object.freeze({
    flavor: "chrome_for_testing_stable",
    version,
    channel: "stable",
    officialStableVersion: expectedStableVersion,
    stableVersionSource: CFT_STABLE_VERSION_SOURCE,
    headlessMode: "new",
    sandboxEnabled: true,
  });
}

export async function readChromeForTestingMetadata(
  chromePath,
  expectedStableVersion = process.env.GATE_014_B1_CFT_STABLE_VERSION,
) {
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
  return validateChromeForTestingMetadata(
    { productName, productVersion },
    expectedStableVersion,
  );
}

export function validateBrowserExecutionObservation(observation) {
  const integerFields = [
    "browserLaunchCount",
    "networkRequestCount",
    "loopbackRequestCount",
    "extensionRequestCount",
    "externalRequestCount",
    "consoleErrorCount",
  ];
  if (
    observation?.contract !== "gate-014-b1-browser-observation-v1" ||
    observation.networkMetricAvailable !== true ||
    observation.consoleMetricAvailable !== true ||
    integerFields.some(
      (field) =>
        !Number.isSafeInteger(observation[field]) || observation[field] < 0,
    ) ||
    observation.browserLaunchCount < 1 ||
    observation.externalRequestCount !== 0 ||
    observation.consoleErrorCount !== 0
  ) {
    throw new Error("browser_execution_observation_failed");
  }
  return Object.freeze({ ...observation });
}

export function combineBrowserExecutionObservations(...observations) {
  const combined = {
    contract: "gate-014-b1-browser-observation-v1",
    browserLaunchCount: 0,
    networkMetricAvailable: true,
    networkRequestCount: 0,
    loopbackRequestCount: 0,
    extensionRequestCount: 0,
    externalRequestCount: 0,
    consoleMetricAvailable: true,
    consoleErrorCount: 0,
  };
  for (const observation of observations.flat()) {
    const validated = validateBrowserExecutionObservation(observation);
    for (const field of [
      "browserLaunchCount",
      "networkRequestCount",
      "loopbackRequestCount",
      "extensionRequestCount",
      "externalRequestCount",
      "consoleErrorCount",
    ]) {
      combined[field] += validated[field];
    }
  }
  return validateBrowserExecutionObservation(combined);
}

export function validateSmokeResult(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("browser_smoke_result_invalid");
  }
  if (result.contract !== "gate-014-b1-browser-smoke-v1") {
    throw new Error("browser_smoke_contract_mismatch");
  }
  if (result.extensionId !== B1_HARNESS_EXTENSION_ID) {
    throw new Error("browser_smoke_extension_identity_mismatch");
  }
  if (
    result.status !== "pass" ||
    !result.indexedDbAvailable ||
    !result.readbackVerified
  ) {
    throw new Error("browser_smoke_failed");
  }
  if (result.storesSensitiveText !== false) {
    throw new Error("browser_smoke_public_safety_failed");
  }
  return Object.freeze({ ...result });
}

export async function runBrowserSmoke(options = {}) {
  const execution = await evaluateInHarness(
    options,
    "globalThis.runGate014B1Smoke()",
    "browser_smoke_evaluation_failed",
  );
  return Object.freeze({
    ...validateSmokeResult(execution.value),
    executionObservation: execution.observation,
  });
}

export async function runBrowserFixtureSmoke(options = {}) {
  const fixtureId = options.fixtureId ?? "high-fragmentation-pathological";
  const definition = FIXTURE_DEFINITIONS.find(
    (candidate) => candidate.id === fixtureId,
  );
  if (!definition) {
    throw new Error("browser_fixture_smoke_fixture_unknown");
  }
  const generated = await writeFixtureArtifact(definition, {
    repositoryRoot: REPOSITORY_ROOT,
  });
  const server = await serveFixture(generated.artifactPath, fixtureId);
  try {
    const receipt = generated.receipt;
    const config = {
      fixtureId,
      artifactUrl: server.artifactUrl,
      expectedCanonicalBytes: receipt.canonical.totalBytes,
      expectedRecordCount: receipt.canonical.recordCount,
      expectedVersionCount: receipt.canonical.versionCount,
      expectedSegmentCount: receipt.canonical.segmentCount,
      candidate: {
        recordCap: options.recordCap ?? 1024,
        byteCapBytes: options.byteCapBytes ?? 4 * 1024 * 1024,
      },
    };
    const execution = await evaluateInHarness(
      options,
      `globalThis.runGate014B1FixtureSmoke(${JSON.stringify(config)})`,
      "browser_fixture_smoke_evaluation_failed",
    );
    const validated = validateFixtureSmokeResult(execution.value, config);
    if (server.getRequestCount() !== 1) {
      throw new Error("browser_fixture_server_request_count_invalid");
    }
    return Object.freeze({
      ...validated,
      executionObservation: execution.observation,
    });
  } finally {
    await server.close();
    await cleanupGeneratedFixtureArtifacts({ repositoryRoot: REPOSITORY_ROOT });
  }
}

export async function runBrowserFixtureLifecycle(options = {}) {
  const fixtureId = options.fixtureId ?? "high-fragmentation-pathological";
  const definition = FIXTURE_DEFINITIONS.find(
    (candidate) => candidate.id === fixtureId,
  );
  if (!definition) {
    throw new Error("browser_fixture_lifecycle_fixture_unknown");
  }
  await cleanupGeneratedFixtureArtifacts({ repositoryRoot: REPOSITORY_ROOT });
  const generated = await writeFixtureArtifact(definition, {
    repositoryRoot: REPOSITORY_ROOT,
  });
  const profile = await createB1TemporaryProfile();
  try {
    return await runBrowserFixtureLifecycleWithPreparedFixture({
      ...options,
      fixtureId,
      preparedFixture: generated,
      profile,
    });
  } finally {
    await removeB1TemporaryProfile(profile);
    await cleanupGeneratedFixtureArtifacts({ repositoryRoot: REPOSITORY_ROOT });
  }
}

export async function runBrowserFixtureLifecycleWithPreparedFixture(
  options = {},
) {
  const fixtureId = options.fixtureId ?? "high-fragmentation-pathological";
  const definition = FIXTURE_DEFINITIONS.find(
    (candidate) => candidate.id === fixtureId,
  );
  if (!definition) {
    throw new Error("browser_fixture_lifecycle_fixture_unknown");
  }
  const preparedFixture = await validatePreparedFixture(
    options.preparedFixture,
    definition,
  );
  const profileDirectory = requireManagedProfile(options.profile);
  const admissionServer = await serveFixture(
    preparedFixture.artifactPath,
    fixtureId,
  );
  const restoreServer = await serveFixture(
    preparedFixture.artifactPath,
    fixtureId,
  );
  try {
    const receipt = preparedFixture.receipt;
    const config = {
      fixtureId,
      artifactUrl: admissionServer.artifactUrl,
      restoreArtifactUrl: restoreServer.artifactUrl,
      databaseName: `gate-014-b1-lifecycle-${randomUUID()}`,
      expectedCanonicalBytes: receipt.canonical.totalBytes,
      expectedRecordCount: receipt.canonical.recordCount,
      expectedVersionCount: receipt.canonical.versionCount,
      expectedSegmentCount: receipt.canonical.segmentCount,
      runMode: options.runMode ?? "cold",
      ...(options.restorePreflightRequiredFreeQuotaBytes === undefined
        ? {}
        : {
            restorePreflightRequiredFreeQuotaBytes:
              options.restorePreflightRequiredFreeQuotaBytes,
          }),
      candidate: {
        recordCap: options.recordCap ?? 1024,
        byteCapBytes: options.byteCapBytes ?? 4 * 1024 * 1024,
      },
    };
    const beforeExecution = await evaluateInHarnessProfile(
      options,
      profileDirectory,
      `globalThis.runGate014B1FixtureLifecycleBeforeRestart(${JSON.stringify(config)})`,
      "browser_fixture_lifecycle_before_restart_failed",
    );
    const beforeRestart = beforeExecution.value;
    validateLifecycleBeforeRestart(beforeRestart, config);

    const restartStartedEpochMs = Date.now();
    const afterExecution = await evaluateInHarnessProfile(
      options,
      profileDirectory,
      ({ harnessReadyEpochMs }) => {
        const restartedConfig = {
          ...config,
          restartStartedEpochMs,
          restartHarnessReadyEpochMs: harnessReadyEpochMs,
        };
        return `globalThis.runGate014B1FixtureLifecycleAfterRestart(${JSON.stringify(
          restartedConfig,
        )}, ${JSON.stringify(beforeRestart.checkpoint)})`;
      },
      "browser_fixture_lifecycle_after_restart_failed",
    );
    const afterRestart = afterExecution.value;
    validateLifecycleAfterRestart(afterRestart, config);
    const expectedAdmissionRequestCount = config.runMode === "warm" ? 2 : 1;
    if (
      admissionServer.getRequestCount() !== expectedAdmissionRequestCount ||
      restoreServer.getRequestCount() !== 1
    ) {
      throw new Error("browser_fixture_lifecycle_server_request_count_invalid");
    }
    return validateFixtureLifecycleResult(
      {
        contract: "gate-014-b1-browser-lifecycle-v1",
        status:
          beforeRestart.status === "pass" && afterRestart.status === "pass"
            ? "pass"
            : "fail",
        fixtureId,
        candidate: config.candidate,
        sourceCanonicalBytes: config.expectedCanonicalBytes,
        operations: [
          ...beforeRestart.operations,
          ...afterRestart.operations,
        ].map((operation) => ({
          ...operation,
          cleanupUsageBytes:
            afterRestart.finalCleanupStorage?.usageBytes ?? null,
        })),
        assertions: afterRestart.assertions,
        finalCleanupStorage: afterRestart.finalCleanupStorage,
        readbackVerified:
          beforeRestart.status === "pass" && afterRestart.readbackVerified,
        executionObservation: combineBrowserExecutionObservations(
          beforeExecution.observation,
          afterExecution.observation,
        ),
        storesSensitiveText: false,
      },
      config,
    );
  } finally {
    await Promise.all([admissionServer.close(), restoreServer.close()]);
  }
}

export function validateFixtureLifecycleResult(result, config) {
  assertPlainObject(result, "browser_fixture_lifecycle_result_invalid");
  if (result.contract !== "gate-014-b1-browser-lifecycle-v1") {
    throw new Error("browser_fixture_lifecycle_contract_mismatch");
  }
  if (
    result.fixtureId !== config.fixtureId ||
    result.storesSensitiveText !== false
  ) {
    throw new Error("browser_fixture_lifecycle_public_safety_failed");
  }
  if (
    !Number.isSafeInteger(result.sourceCanonicalBytes) ||
    result.sourceCanonicalBytes !== config.expectedCanonicalBytes
  ) {
    throw new Error("browser_fixture_lifecycle_source_bytes_invalid");
  }
  if (
    !Array.isArray(result.operations) ||
    result.operations.length !== B1_OPERATION_KINDS.length
  ) {
    throw new Error("browser_fixture_lifecycle_operation_count_invalid");
  }
  const operationKinds = result.operations
    .map((operation) => operation?.operation)
    .sort();
  if (operationKinds.join("|") !== [...B1_OPERATION_KINDS].sort().join("|")) {
    throw new Error("browser_fixture_lifecycle_operation_set_invalid");
  }
  if (
    !result.finalCleanupStorage ||
    !Number.isSafeInteger(result.finalCleanupStorage.usageBytes)
  ) {
    throw new Error("browser_fixture_lifecycle_cleanup_metric_invalid");
  }
  if (
    typeof result.readbackVerified !== "boolean" ||
    !["pass", "fail"].includes(result.status)
  ) {
    throw new Error("browser_fixture_lifecycle_status_invalid");
  }
  validateBrowserExecutionObservation(result.executionObservation);
  return Object.freeze({ ...result });
}

function validateLifecycleBeforeRestart(result, config) {
  assertPlainObject(result, "browser_fixture_lifecycle_before_result_invalid");
  if (
    result.contract !== "gate-014-b1-browser-lifecycle-before-restart-v1" ||
    result.fixtureId !== config.fixtureId ||
    result.storesSensitiveText !== false ||
    result.status !== "pass"
  ) {
    throw new Error("browser_fixture_lifecycle_before_result_failed");
  }
  if (
    !Array.isArray(result.operations) ||
    result.operations.length !== 2 ||
    result.operations[0]?.operation !== "admission" ||
    result.operations[1]?.operation !== "commit_visibility"
  ) {
    throw new Error("browser_fixture_lifecycle_before_operations_invalid");
  }
  assertPlainObject(
    result.checkpoint,
    "browser_fixture_lifecycle_checkpoint_invalid",
  );
  return result;
}

function validateLifecycleAfterRestart(result, config) {
  assertPlainObject(result, "browser_fixture_lifecycle_after_result_invalid");
  if (
    result.contract !== "gate-014-b1-browser-lifecycle-v1" ||
    result.fixtureId !== config.fixtureId ||
    result.storesSensitiveText !== false
  ) {
    throw new Error("browser_fixture_lifecycle_after_result_failed");
  }
  if (
    !Array.isArray(result.operations) ||
    result.operations.length !== B1_OPERATION_KINDS.length - 2
  ) {
    throw new Error("browser_fixture_lifecycle_after_operations_invalid");
  }
  return result;
}

function assertPlainObject(value, errorCode) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(errorCode);
  }
}

async function validatePreparedFixture(preparedFixture, definition) {
  assertPlainObject(
    preparedFixture,
    "browser_fixture_prepared_fixture_invalid",
  );
  assertPlainObject(
    preparedFixture.receipt,
    "browser_fixture_prepared_receipt_invalid",
  );
  const expectedArtifactPath = path.resolve(
    REPOSITORY_ROOT,
    GENERATED_FIXTURE_RELATIVE_DIR,
    `${definition.id}.jsonl`,
  );
  if (
    path.resolve(preparedFixture.artifactPath) !== expectedArtifactPath ||
    preparedFixture.receipt.fixture?.id !== definition.id ||
    preparedFixture.artifactSha256 !==
      preparedFixture.receipt.canonical?.fixtureSha256
  ) {
    throw new Error("browser_fixture_prepared_fixture_mismatch");
  }
  await access(expectedArtifactPath);
  return preparedFixture;
}

function requireManagedProfile(profile) {
  if (
    !profile ||
    profile.contract !== "gate-014-b1-temporary-profile-v1" ||
    typeof profile.directory !== "string" ||
    !MANAGED_PROFILE_DIRECTORIES.has(profile.directory)
  ) {
    throw new Error("browser_fixture_profile_not_managed");
  }
  return profile.directory;
}

export function validateFixtureSmokeResult(result, config) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("browser_fixture_smoke_result_invalid");
  }
  if (result.contract !== "gate-014-b1-browser-fixture-smoke-v1") {
    throw new Error("browser_fixture_smoke_contract_mismatch");
  }
  if (
    result.status !== "pass" ||
    !result.readbackVerified ||
    !result.databaseDeleted
  ) {
    throw new Error("browser_fixture_smoke_failed");
  }
  if (
    result.fixtureId !== config.fixtureId ||
    result.receivedCanonicalBytes !== config.expectedCanonicalBytes ||
    result.receivedRecordCount !== config.expectedRecordCount
  ) {
    throw new Error("browser_fixture_smoke_receipt_mismatch");
  }
  if (!result.heapMetricAvailable || !result.mainThreadMetricAvailable) {
    throw new Error("browser_fixture_smoke_required_metric_unavailable");
  }
  if (result.storesSensitiveText !== false) {
    throw new Error("browser_fixture_smoke_public_safety_failed");
  }
  return Object.freeze({ ...result });
}

async function evaluateInHarness(options, expression, evaluationErrorCode) {
  const profileDirectory = await mkdtemp(
    path.join(os.tmpdir(), "bili-bill-gate-014-b1-profile-"),
  );
  try {
    return await evaluateInHarnessProfile(
      options,
      profileDirectory,
      expression,
      evaluationErrorCode,
    );
  } finally {
    await rm(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    });
  }
}

async function evaluateInHarnessProfile(
  options,
  profileDirectory,
  expression,
  evaluationErrorCode,
) {
  const chromeExecutable = await resolveChromeExecutable(options.chromePath);
  await readChromeForTestingMetadata(
    chromeExecutable,
    options.expectedStableVersion,
  );
  const productionExtension = path.resolve(
    options.productionExtension ?? path.join(REPOSITORY_ROOT, "dist"),
  );
  const harnessExtension = path.resolve(
    options.harnessExtension ??
      path.join(
        REPOSITORY_ROOT,
        "tests",
        "fixtures",
        "gate-014",
        "b1-extension",
      ),
  );
  await Promise.all([
    access(path.join(productionExtension, "manifest.json")),
    access(path.join(harnessExtension, "manifest.json")),
  ]);
  await rm(path.join(profileDirectory, "DevToolsActivePort"), { force: true });
  const chromeArguments = buildChromeArguments({
    profileDirectory,
    productionExtension,
    harnessExtension,
  });
  const chrome = spawn(chromeExecutable, chromeArguments, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });

  try {
    const { port, browserPath } = await waitForDevToolsPort(
      profileDirectory,
      chrome,
    );
    const discoveredExtensionId = await discoverHarnessExtensionId(port);
    if (discoveredExtensionId !== B1_HARNESS_EXTENSION_ID) {
      throw new Error("browser_smoke_extension_identity_mismatch");
    }
    const client = await CdpClient.connect(
      `ws://127.0.0.1:${port}${browserPath}`,
    );
    try {
      const { targetId } = await client.send(
        "Target.createTarget",
        {
          url: `chrome-extension://${B1_HARNESS_EXTENSION_ID}/runner.html`,
        },
        undefined,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
      const { sessionId } = await client.send(
        "Target.attachToTarget",
        { targetId, flatten: true },
        undefined,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
      const observation = createCdpExecutionObservation(client, sessionId);
      await client.send(
        "Runtime.enable",
        {},
        sessionId,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
      await client.send(
        "Network.enable",
        {},
        sessionId,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
      await client.send(
        "Log.enable",
        {},
        sessionId,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
      await waitForHarnessReady(client, sessionId);
      const resolvedExpression =
        typeof expression === "function"
          ? expression({ harnessReadyEpochMs: Date.now() })
          : expression;
      const evaluation = await client.send(
        "Runtime.evaluate",
        {
          expression: resolvedExpression,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
        B1_LIFECYCLE_EVALUATION_TIMEOUT_MS,
      );
      if (evaluation.exceptionDetails) {
        if (process.env.GATE_014_B1_DEBUG === "1") {
          const description =
            evaluation.exceptionDetails.exception?.description ??
            "unknown_exception";
          const safeCode =
            description.match(/Error: ([a-z0-9_:-]+)/i)?.[1] ??
            "unknown_exception";
          process.stderr.write(`Harness exception code: ${safeCode}\n`);
        }
        throw new Error(evaluationErrorCode);
      }
      const observationReceipt = observation.finish();
      return {
        value: evaluation.result?.value,
        observation: validateBrowserExecutionObservation(observationReceipt),
      };
    } finally {
      client.close();
    }
  } catch (error) {
    if (stderr && process.env.GATE_014_B1_DEBUG === "1") {
      process.stderr.write(stderr);
    }
    throw error;
  } finally {
    if (!chrome.killed) {
      chrome.kill();
    }
    await waitForProcessExit(chrome);
  }
}

function createCdpExecutionObservation(client, sessionId) {
  const counts = {
    networkRequestCount: 0,
    loopbackRequestCount: 0,
    extensionRequestCount: 0,
    externalRequestCount: 0,
    consoleErrorCount: 0,
  };
  const unsubscribe = client.onEvent((message) => {
    if (message.sessionId !== sessionId) {
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      counts.networkRequestCount += 1;
      const url = message.params?.request?.url;
      try {
        const parsed = new URL(url);
        if (
          parsed.protocol === "http:" ||
          parsed.protocol === "https:"
        ) {
          if (["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
            counts.loopbackRequestCount += 1;
          } else {
            counts.externalRequestCount += 1;
          }
        } else if (parsed.protocol === "chrome-extension:") {
          counts.extensionRequestCount += 1;
        }
      } catch {
        counts.externalRequestCount += 1;
      }
      return;
    }
    if (
      message.method === "Runtime.exceptionThrown" ||
      (message.method === "Runtime.consoleAPICalled" &&
        ["error", "assert"].includes(message.params?.type)) ||
      (message.method === "Log.entryAdded" &&
        message.params?.entry?.level === "error")
    ) {
      counts.consoleErrorCount += 1;
    }
  });
  return {
    finish() {
      unsubscribe();
      return {
        contract: "gate-014-b1-browser-observation-v1",
        browserLaunchCount: 1,
        networkMetricAvailable: true,
        ...counts,
        consoleMetricAvailable: true,
      };
    },
  };
}

async function serveFixture(artifactPath, fixtureId) {
  const token = randomUUID();
  const expectedPath = `/${fixtureId}.jsonl?token=${token}`;
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" || request.url !== expectedPath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not_found");
      return;
    }
    if (
      request.headers.origin &&
      request.headers.origin !== `chrome-extension://${B1_HARNESS_EXTENSION_ID}`
    ) {
      if (process.env.GATE_014_B1_DEBUG === "1") {
        process.stderr.write(
          `Fixture request origin: ${request.headers.origin ?? "none"}\n`,
        );
      }
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("forbidden");
      return;
    }
    requestCount += 1;
    response.writeHead(200, {
      "Access-Control-Allow-Origin": `chrome-extension://${B1_HARNESS_EXTENSION_ID}`,
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    });
    createReadStream(artifactPath).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("browser_fixture_server_address_invalid");
  }
  return {
    port: address.port,
    artifactUrl: `http://127.0.0.1:${address.port}${expectedPath}`,
    getRequestCount() {
      return requestCount;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function discoverHarnessExtensionId(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(B1_CDP_SETUP_TIMEOUT_MS),
    });
    const targets = await response.json();
    const target = targets.find(
      (candidate) =>
        candidate.type === "service_worker" &&
        candidate.url ===
          `chrome-extension://${B1_HARNESS_EXTENSION_ID}/service-worker.js`,
    );
    if (target) {
      return new URL(target.url).hostname;
    }
    await delay(50);
  }
  throw new Error("browser_smoke_harness_extension_not_loaded");
}

async function waitForHarnessReady(client, sessionId) {
  let lastState = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const evaluation = await client.send(
      "Runtime.evaluate",
      {
        expression: `({
        ready: typeof globalThis.runGate014B1Smoke === "function",
        href: location.href,
        readyState: document.readyState,
        scriptCount: document.scripts.length,
      })`,
        returnByValue: true,
      },
      sessionId,
      B1_CDP_SETUP_TIMEOUT_MS,
    );
    lastState = evaluation.result?.value ?? null;
    if (!evaluation.exceptionDetails && lastState?.ready === true) {
      return;
    }
    await delay(50);
  }
  if (process.env.GATE_014_B1_DEBUG === "1" && lastState) {
    process.stderr.write(`Harness state: ${JSON.stringify(lastState)}\n`);
  }
  throw new Error("browser_smoke_harness_start_timeout");
}

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        socket.close();
        reject(new Error("cdp_connection_timeout"));
      }, B1_CDP_SETUP_TIMEOUT_MS);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeoutId);
          reject(new Error("cdp_connection_failed"));
        },
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        for (const listener of this.eventListeners) {
          listener(message);
        }
        return;
      }
      if (!this.pending.has(message.id)) {
        return;
      }
      const { resolve, reject, timeoutId } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timeoutId);
      if (message.error) {
        reject(new Error(`cdp_command_failed:${message.error.code}`));
      } else {
        resolve(message.result ?? {});
      }
    });
    socket.addEventListener("close", () => {
      for (const { reject, timeoutId } of this.pending.values()) {
        clearTimeout(timeoutId);
        reject(new Error("cdp_connection_closed"));
      }
      this.pending.clear();
    });
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  send(method, params = {}, sessionId, timeoutMs = B1_CDP_SETUP_TIMEOUT_MS) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("cdp_timeout_invalid");
    }
    const id = this.nextId;
    this.nextId += 1;
    const message = { id, method, params };
    if (sessionId) {
      message.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!this.pending.delete(id)) {
          return;
        }
        reject(new Error("cdp_command_timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeoutId });
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForDevToolsPort(profileDirectory, chrome) {
  const activePortPath = path.join(profileDirectory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (chrome.exitCode !== null) {
      throw new Error("chrome_exited_before_devtools_ready");
    }
    try {
      const [portLine, browserPath] = (await readFile(activePortPath, "utf8"))
        .trim()
        .split(/\r?\n/);
      const port = Number(portLine);
      if (
        Number.isInteger(port) &&
        port > 0 &&
        browserPath?.startsWith("/devtools/browser/")
      ) {
        return { port, browserPath };
      }
    } catch {
      // Chrome writes DevToolsActivePort only after the temporary profile is ready.
    }
    await delay(50);
  }
  throw new Error("chrome_devtools_start_timeout");
}

function waitForProcessExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 5_000).unref();
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const result = await runBrowserSmoke({
    chromePath: process.env.GATE_014_B1_CHROME_PATH,
    expectedStableVersion: process.env.GATE_014_B1_CFT_STABLE_VERSION,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write(
      "GATE-014-B1 browser smoke failed. Set GATE_014_B1_DEBUG=1 for Chrome diagnostics.\n",
    );
    process.exitCode = 1;
  });
}
