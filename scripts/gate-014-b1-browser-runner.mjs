import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
const B1_BROWSER_STAGE_FAILURE_CODES = Object.freeze([
  "browser_lifecycle_execution_failed",
  "browser_before_restart_control_failed",
  "browser_before_restart_validation_failed",
  "browser_after_restart_control_failed",
  "browser_after_restart_validation_failed",
  "browser_lifecycle_server_setup_failed",
  "browser_lifecycle_server_validation_failed",
  "browser_lifecycle_server_cleanup_failed",
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
  "browser_process_termination_validation_failed",
]);
const B1_BROWSER_FAILURE_CODES = new WeakMap();
const B1_CDP_SETUP_TIMEOUT_MS = 30_000;
const B1_HARNESS_EXTENSION_NAME = "Bili-Bill GATE-014-B1 Harness";
const B1_HARNESS_EXTENSION_VERSION = "1.0.0";
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const BILIBILI_API_HOSTNAME = "api.bilibili.com";
const BILIBILI_HISTORY_CURSOR_PATH = "/x/web-interface/history/cursor";
const BILIBILI_HISTORY_CURSOR_URL = `https://${BILIBILI_API_HOSTNAME}${BILIBILI_HISTORY_CURSOR_PATH}?ps=30`;
const B1_SYNTHETIC_RESPONSE_SETTLE_TIMEOUT_MS = 5_000;
const B1_MAX_QUEUED_SYNTHETIC_REQUESTS = 8;
const B1_MAX_CDP_PIPE_MESSAGE_BYTES = 8 * 1024 * 1024;
const SYNTHETIC_UNAUTHENTICATED_RESPONSE_BODY = Buffer.from(
  JSON.stringify({
    code: -101,
    message: "synthetic unauthenticated benchmark response",
    ttl: 1,
  }),
  "utf8",
).toString("base64");
const execFile = promisify(execFileCallback);
const CFT_STABLE_VERSION_SOURCE =
  "official_last_known_good_versions_with_downloads_json";

const MANAGED_PROFILE_DIRECTORIES = new Set();
const MANAGED_PRODUCTION_EXTENSION_STAGE_ROOTS = new Set();

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

export async function createB1ProductionExtensionStage(sourceDirectory) {
  const source = path.resolve(sourceDirectory ?? "");
  await access(path.join(source, "manifest.json"));
  const root = await mkdtemp(
    path.join(os.tmpdir(), "bili-bill-gate-014-b1-production-"),
  );
  const directory = path.join(root, "extension");
  try {
    const sourceSha256 = await hashB1ExtensionDirectory(source);
    await cp(source, directory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    if ((await hashB1ExtensionDirectory(directory)) !== sourceSha256) {
      throw new Error("browser_production_extension_stage_hash_mismatch");
    }
    MANAGED_PRODUCTION_EXTENSION_STAGE_ROOTS.add(root);
    return Object.freeze({
      contract: "gate-014-b1-production-extension-stage-v1",
      root,
      directory,
      sourceSha256,
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function removeB1ProductionExtensionStage(stage) {
  const root = requireManagedProductionExtensionStage(stage);
  try {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    });
    try {
      await access(root);
      throw new Error("browser_production_extension_stage_cleanup_failed");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  } finally {
    MANAGED_PRODUCTION_EXTENSION_STAGE_ROOTS.delete(root);
  }
}

export function buildChromeArguments({ profileDirectory }) {
  if (!path.isAbsolute(profileDirectory)) {
    throw new Error("profileDirectory must be an absolute path");
  }
  return [
    "--headless=new",
    `--user-data-dir=${profileDirectory}`,
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-proxy-server",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-precise-memory-info",
    "--disable-features=MediaRouter,OptimizationGuideModelExecution,OptimizationGuideOnDeviceModel,OptimizationHints,Translate",
    "--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1",
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

export function validateOfficialCftStableMetadata(metadata, metadataSha256) {
  const stable = metadata?.channels?.Stable;
  const version = stable?.version;
  const revision = stable?.revision;
  const metadataTimestamp = metadata?.timestamp;
  const expectedWin64Url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/win64/chrome-win64.zip`;
  const win64Download = stable?.downloads?.chrome?.find(
    (download) => download?.platform === "win64",
  );
  if (
    stable?.channel !== "Stable" ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(version ?? "") ||
    !/^\d+$/.test(revision ?? "") ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
      metadataTimestamp ?? "",
    ) ||
    !Number.isFinite(Date.parse(metadataTimestamp)) ||
    win64Download?.url !== expectedWin64Url ||
    !/^[a-f0-9]{64}$/.test(metadataSha256 ?? "")
  ) {
    throw new Error("official_cft_stable_metadata_invalid");
  }
  return Object.freeze({
    version,
    revision,
    metadataTimestamp,
    metadataSha256,
    source: CFT_STABLE_VERSION_SOURCE,
  });
}

export async function readOfficialCftStableMetadata(metadataPath) {
  if (!metadataPath) {
    throw new Error("official_cft_stable_metadata_path_required");
  }
  const raw = await readFile(path.resolve(metadataPath), "utf8");
  const metadataSha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("official_cft_stable_metadata_invalid");
  }
  return validateOfficialCftStableMetadata(parsed, metadataSha256);
}

export function validateChromeForTestingMetadata(metadata, officialStable) {
  if (
    officialStable?.source !== CFT_STABLE_VERSION_SOURCE ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(officialStable?.version ?? "") ||
    !/^\d+$/.test(officialStable?.revision ?? "") ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
      officialStable?.metadataTimestamp ?? "",
    ) ||
    !Number.isFinite(Date.parse(officialStable?.metadataTimestamp)) ||
    !/^[a-f0-9]{64}$/.test(officialStable?.metadataSha256 ?? "")
  ) {
    throw new Error("official_cft_stable_metadata_required");
  }
  const productName = metadata?.productName;
  const productVersion = metadata?.productVersion;
  if (
    productName !== "Google Chrome for Testing" ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(productVersion ?? "")
  ) {
    throw new Error("official_chrome_for_testing_required");
  }
  const version = productVersion;
  if (version !== officialStable.version) {
    throw new Error("chrome_for_testing_stable_version_mismatch");
  }
  return Object.freeze({
    flavor: "chrome_for_testing_stable",
    version,
    channel: "stable",
    officialStableVersion: officialStable.version,
    officialStableRevision: officialStable.revision,
    officialMetadataTimestamp: officialStable.metadataTimestamp,
    officialMetadataSha256: officialStable.metadataSha256,
    stableVersionSource: officialStable.source,
    headlessMode: "new",
    sandboxEnabled: true,
  });
}

export async function readChromeForTestingMetadata(
  chromePath,
  metadataPath = process.env.GATE_014_B1_CFT_METADATA_PATH,
) {
  const officialStable = await readOfficialCftStableMetadata(metadataPath);
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
    officialStable,
  );
}

export function validateBrowserExecutionObservation(observation) {
  assertPlainObject(observation, "browser_execution_observation_failed");
  const expectedFields = [
    "contract",
    "browserLaunchCount",
    "observationScope",
    "preAttachEventsObserved",
    "productionServiceWorkerStartupBarrierEnabled",
    "observedTargetCount",
    "productionExtensionTargetCount",
    "harnessExtensionTargetCount",
    "networkMetricAvailable",
    "networkRequestCount",
    "loopbackRequestCount",
    "extensionRequestCount",
    "externalRequestAttemptCount",
    "syntheticUnauthenticatedResponseCount",
    "externalResponseCount",
    "consoleMetricAvailable",
    "consoleErrorCount",
    "unattributedLogErrorCount",
  ].sort();
  if (Object.keys(observation).sort().join("|") !== expectedFields.join("|")) {
    throw new Error("browser_execution_observation_failed");
  }
  const integerFields = [
    "browserLaunchCount",
    "observedTargetCount",
    "productionExtensionTargetCount",
    "harnessExtensionTargetCount",
    "networkRequestCount",
    "loopbackRequestCount",
    "extensionRequestCount",
    "externalRequestAttemptCount",
    "syntheticUnauthenticatedResponseCount",
    "externalResponseCount",
    "consoleErrorCount",
    "unattributedLogErrorCount",
  ];
  if (
    observation?.contract !== "gate-014-b1-browser-observation-v4" ||
    observation.observationScope !==
      "extension_targets_after_devtools_attach_with_production_worker_barrier" ||
    observation.preAttachEventsObserved !== false ||
    observation.productionServiceWorkerStartupBarrierEnabled !== true ||
    observation.networkMetricAvailable !== true ||
    observation.consoleMetricAvailable !== true ||
    integerFields.some(
      (field) =>
        !Number.isSafeInteger(observation[field]) || observation[field] < 0,
    ) ||
    observation.browserLaunchCount < 1 ||
    observation.observedTargetCount < 1 ||
    observation.productionExtensionTargetCount <
      observation.browserLaunchCount ||
    observation.harnessExtensionTargetCount < observation.browserLaunchCount ||
    observation.productionExtensionTargetCount +
      observation.harnessExtensionTargetCount >
      observation.observedTargetCount ||
    observation.loopbackRequestCount +
      observation.extensionRequestCount +
      observation.externalRequestAttemptCount >
      observation.networkRequestCount ||
    observation.syntheticUnauthenticatedResponseCount >
      observation.externalRequestAttemptCount ||
    observation.syntheticUnauthenticatedResponseCount <
      observation.browserLaunchCount ||
    observation.externalResponseCount !== 0 ||
    observation.consoleErrorCount !== 0
  ) {
    throw new Error("browser_execution_observation_failed");
  }
  return Object.freeze({ ...observation });
}

export function combineBrowserExecutionObservations(...observations) {
  const combined = {
    contract: "gate-014-b1-browser-observation-v4",
    browserLaunchCount: 0,
    observationScope:
      "extension_targets_after_devtools_attach_with_production_worker_barrier",
    preAttachEventsObserved: false,
    productionServiceWorkerStartupBarrierEnabled: true,
    observedTargetCount: 0,
    productionExtensionTargetCount: 0,
    harnessExtensionTargetCount: 0,
    networkMetricAvailable: true,
    networkRequestCount: 0,
    loopbackRequestCount: 0,
    extensionRequestCount: 0,
    externalRequestAttemptCount: 0,
    syntheticUnauthenticatedResponseCount: 0,
    externalResponseCount: 0,
    consoleMetricAvailable: true,
    consoleErrorCount: 0,
    unattributedLogErrorCount: 0,
  };
  for (const observation of observations.flat()) {
    const validated = validateBrowserExecutionObservation(observation);
    for (const field of [
      "browserLaunchCount",
      "observedTargetCount",
      "productionExtensionTargetCount",
      "harnessExtensionTargetCount",
      "networkRequestCount",
      "loopbackRequestCount",
      "extensionRequestCount",
      "externalRequestAttemptCount",
      "syntheticUnauthenticatedResponseCount",
      "externalResponseCount",
      "consoleErrorCount",
      "unattributedLogErrorCount",
    ]) {
      combined[field] += validated[field];
    }
  }
  return validateBrowserExecutionObservation(combined);
}

export function validateLoadedExtensionInventory(
  inventory,
  expectedProduction,
) {
  if (!Array.isArray(inventory)) {
    throw new Error("browser_loaded_extension_inventory_invalid");
  }
  const validatedExpectedProduction =
    validateExpectedProductionExtensionIdentity(expectedProduction);
  const enabledExtensions = inventory.filter(
    (extension) =>
      extension &&
      typeof extension === "object" &&
      !Array.isArray(extension) &&
      extension.enabled === true &&
      extension.type === "extension" &&
      EXTENSION_ID_PATTERN.test(extension.id ?? ""),
  );
  const harnessMatches = enabledExtensions.filter(
    (extension) =>
      extension.id === B1_HARNESS_EXTENSION_ID &&
      extension.name === B1_HARNESS_EXTENSION_NAME &&
      extension.version === B1_HARNESS_EXTENSION_VERSION,
  );
  const productionMatches = enabledExtensions.filter(
    (extension) =>
      extension.id !== B1_HARNESS_EXTENSION_ID &&
      extension.name === validatedExpectedProduction.name &&
      extension.version === validatedExpectedProduction.version &&
      extension.versionName === validatedExpectedProduction.versionName,
  );
  if (harnessMatches.length !== 1 || productionMatches.length !== 1) {
    throw new Error("browser_required_extensions_not_loaded");
  }
  return Object.freeze({
    productionExtensionId: productionMatches[0].id,
  });
}

function validateExpectedProductionExtensionIdentity(expectedProduction) {
  const expectedFields = ["name", "version", "versionName"];
  if (
    expectedProduction === null ||
    typeof expectedProduction !== "object" ||
    Array.isArray(expectedProduction) ||
    Object.keys(expectedProduction).sort().join("|") !==
      expectedFields.sort().join("|") ||
    typeof expectedProduction.name !== "string" ||
    expectedProduction.name.length === 0 ||
    !/^\d+\.\d+\.\d+$/.test(expectedProduction.version ?? "") ||
    typeof expectedProduction.versionName !== "string" ||
    expectedProduction.versionName.length === 0
  ) {
    throw new Error("browser_production_extension_identity_invalid");
  }
  return Object.freeze({ ...expectedProduction });
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
  let admissionServer = null;
  let restoreServer = null;
  return executeB1BrowserOperationWithCleanup(
    async () => {
      await executeB1BrowserStage(
        "browser_lifecycle_server_setup_failed",
        async () => {
          admissionServer = await serveFixture(
            preparedFixture.artifactPath,
            fixtureId,
          );
          restoreServer = await serveFixture(
            preparedFixture.artifactPath,
            fixtureId,
          );
        },
      );
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
    const beforeExecution = await executeB1BrowserStage(
      "browser_before_restart_control_failed",
      () =>
        evaluateInHarnessProfile(
          options,
          profileDirectory,
          `globalThis.runGate014B1FixtureLifecycleBeforeRestart(${JSON.stringify(config)})`,
          "browser_fixture_lifecycle_before_restart_failed",
        ),
    );
    const beforeRestart = beforeExecution.value;
    await executeB1BrowserStage(
      "browser_before_restart_validation_failed",
      () => validateLifecycleBeforeRestart(beforeRestart, config),
    );

    const restartStartedEpochMs = Date.now();
    const afterExecution = await executeB1BrowserStage(
      "browser_after_restart_control_failed",
      () =>
        evaluateInHarnessProfile(
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
          [beforeExecution.productionExtensionId],
        ),
    );
    const afterRestart = afterExecution.value;
    await executeB1BrowserStage(
      "browser_after_restart_validation_failed",
      () => validateLifecycleAfterRestart(afterRestart, config),
    );
    const expectedAdmissionRequestCount = config.runMode === "warm" ? 2 : 1;
    await executeB1BrowserStage(
      "browser_lifecycle_server_validation_failed",
      () => {
        if (
          admissionServer.getRequestCount() !== expectedAdmissionRequestCount ||
          restoreServer.getRequestCount() !== 1
        ) {
          throw new Error(
            "browser_fixture_lifecycle_server_request_count_invalid",
          );
        }
      },
    );
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
    },
    () =>
      executeB1BrowserStage(
        "browser_lifecycle_server_cleanup_failed",
        () => settleB1FixtureServerCleanup([admissionServer, restoreServer]),
      ),
  );
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
  const expectedOperationOrder = [
    "restart",
    "marker_normalization",
    "ordered_read",
    "ledger_repair",
    "capacity_boundary",
    "atomic_version",
    "cancellation",
    "full_clear",
    "restore_staging",
    "quota_failure",
    "selected_version_removal",
  ];
  if (
    result.operations.map((operation) => operation?.operation).join("|") !==
    expectedOperationOrder.join("|")
  ) {
    throw new Error("browser_fixture_lifecycle_after_operation_order_invalid");
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

function requireManagedProductionExtensionStage(stage) {
  if (
    !stage ||
    stage.contract !== "gate-014-b1-production-extension-stage-v1" ||
    typeof stage.root !== "string" ||
    typeof stage.directory !== "string" ||
    !/^[a-f0-9]{64}$/.test(stage.sourceSha256 ?? "") ||
    path.resolve(stage.directory) !== path.join(stage.root, "extension") ||
    !MANAGED_PRODUCTION_EXTENSION_STAGE_ROOTS.has(stage.root)
  ) {
    throw new Error("browser_production_extension_stage_not_managed");
  }
  return stage.root;
}

async function hashB1ExtensionDirectory(directory) {
  const files = [];
  const visit = async (currentDirectory) => {
    for (const entry of await readdir(currentDirectory, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new Error("browser_production_extension_stage_entry_invalid");
      }
    }
  };
  await visit(directory);
  const hash = createHash("sha256");
  files.sort((left, right) => left.localeCompare(right));
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
  forbiddenProductionExtensionIds = [],
) {
  const productionExtensionSource = path.resolve(
    options.productionExtension ?? path.join(REPOSITORY_ROOT, "dist"),
  );
  let productionExtensionStage = null;
  return executeB1BrowserOperationWithCleanup(
    async () => {
      productionExtensionStage = await executeB1BrowserStage(
        "browser_production_stage_setup_failed",
        () => createB1ProductionExtensionStage(productionExtensionSource),
      );
      return evaluateInStagedHarnessProfile(
        options,
        profileDirectory,
        expression,
        evaluationErrorCode,
        productionExtensionStage.directory,
        forbiddenProductionExtensionIds,
      );
    },
    () =>
      executeB1BrowserStage(
        "browser_production_stage_cleanup_failed",
        () =>
          productionExtensionStage
            ? removeB1ProductionExtensionStage(productionExtensionStage)
            : undefined,
      ),
  );
}

async function evaluateInStagedHarnessProfile(
  options,
  profileDirectory,
  expression,
  evaluationErrorCode,
  productionExtension,
  forbiddenProductionExtensionIds,
) {
  const environment = await executeB1BrowserStage(
    "browser_environment_validation_failed",
    async () => {
      const chromeExecutable = await resolveChromeExecutable(options.chromePath);
      await readChromeForTestingMetadata(
        chromeExecutable,
        options.cftMetadataPath,
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
      return {
        chromeArguments: buildChromeArguments({ profileDirectory }),
        chromeExecutable,
        harnessExtension,
        productionIdentity:
          await readProductionExtensionIdentity(productionExtension),
      };
    },
  );
  let chrome = null;
  let stderr = "";
  let client = null;
  return executeB1BrowserOperationWithCleanup(
    async () => {
      await executeB1BrowserStage("browser_process_spawn_failed", async () => {
        chrome = spawn(
          environment.chromeExecutable,
          environment.chromeArguments,
          {
            stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        await waitForB1BrowserProcessSpawn(chrome);
        if (!chrome.stderr) {
          throw new Error("chrome_stderr_pipe_unavailable");
        }
        chrome.stderr.setEncoding("utf8");
        chrome.stderr.on("data", (chunk) => {
          stderr = `${stderr}${chunk}`.slice(-8_192);
        });
      });
      try {
        const setup = await executeB1BrowserStage(
          "browser_target_observer_setup_failed",
          async () => {
            const commandPipe = chrome.stdio[3];
            const eventPipe = chrome.stdio[4];
            if (!commandPipe || !eventPipe) {
              throw new Error("cdp_pipe_unavailable");
            }
            client = createPipeCdpClient(commandPipe, eventPipe);
            const observation = createCdpExecutionObservation(client);
            const targetObserver = createExtensionTargetObserver(
              client,
              observation,
              { forbiddenProductionExtensionIds },
            );
            const deadlineEpochMs = Date.now() + B1_CDP_SETUP_TIMEOUT_MS;
            await targetObserver.start({ deadlineEpochMs });
            return { deadlineEpochMs, observation, targetObserver };
          },
        );
        const { deadlineEpochMs, observation, targetObserver } = setup;
        await executeB1BrowserStage("browser_harness_load_failed", async () => {
          const loadedHarnessExtensionId = await loadUnpackedExtension(
            client,
            environment.harnessExtension,
            { deadlineEpochMs },
          );
          if (loadedHarnessExtensionId !== B1_HARNESS_EXTENSION_ID) {
            throw new Error("browser_smoke_extension_identity_mismatch");
          }
        });
        const productionExtensionId = await executeB1BrowserStage(
          "browser_production_load_failed",
          async () => {
            const loadedProductionExtensionId = await loadUnpackedExtension(
              client,
              productionExtension,
              { deadlineEpochMs },
            );
            if (loadedProductionExtensionId === B1_HARNESS_EXTENSION_ID) {
              throw new Error("browser_production_extension_identity_invalid");
            }
            targetObserver.requireProductionServiceWorkerBarrier(
              loadedProductionExtensionId,
            );
            observation.setRequiredExtensionIds({
              productionExtensionId: loadedProductionExtensionId,
              harnessExtensionId: B1_HARNESS_EXTENSION_ID,
            });
            return loadedProductionExtensionId;
          },
        );
        const sessionId = await executeB1BrowserStage(
          "browser_runner_target_setup_failed",
          async () => {
            const { targetId } = await sendCdpWithinDeadline(
              client,
              "Target.createTarget",
              {
                url: `chrome-extension://${B1_HARNESS_EXTENSION_ID}/runner.html`,
              },
              undefined,
              deadlineEpochMs,
            );
            const runnerAttachmentRemainingMs = remainingSetupMs(deadlineEpochMs);
            const observedSessionId = await settleWithin(
              targetObserver.ensureTargetId(
                targetId,
                runnerAttachmentRemainingMs,
              ),
              runnerAttachmentRemainingMs,
            );
            if (!observedSessionId) {
              throw new Error("browser_runner_target_not_observed");
            }
            return observedSessionId;
          },
        );
        await executeB1BrowserStage("browser_harness_ready_failed", () =>
          waitForHarnessReady(client, sessionId, { deadlineEpochMs }),
        );
        await executeB1BrowserStage(
          "browser_extension_inventory_failed",
          async () => {
            const inventory = await readLoadedExtensionInventory(
              client,
              sessionId,
              { deadlineEpochMs },
            );
            const inventoryIdentity = validateLoadedExtensionInventory(
              inventory,
              environment.productionIdentity,
            );
            if (
              inventoryIdentity.productionExtensionId !== productionExtensionId
            ) {
              throw new Error("browser_production_extension_identity_invalid");
            }
          },
        );
        await executeB1BrowserStage(
          "browser_production_worker_setup_failed",
          async () => {
            const productionSessionId =
              await findProductionServiceWorkerSession(
                client,
                targetObserver,
                productionExtensionId,
                { deadlineEpochMs },
              );
            if (!productionSessionId) {
              throw new Error("browser_production_extension_target_not_observed");
            }
            await waitForProductionExtensionReady(
              client,
              productionSessionId,
              productionExtensionId,
              environment.productionIdentity,
              { deadlineEpochMs },
            );
          },
        );
        await executeB1BrowserStage(
          "browser_synthetic_startup_failed",
          () =>
            observation.waitForSyntheticUnauthenticatedResponse({
              deadlineEpochMs,
            }),
        );
        await executeB1BrowserStage(
          "browser_production_uninstall_failed",
          async () => {
            await uninstallUnpackedExtension(client, productionExtensionId, {
              deadlineEpochMs,
            });
            targetObserver.completeSetup();
          },
        );
        const controlledValue = await executeB1BrowserStage(
          "browser_harness_evaluation_failed",
          async () => {
            const resolvedExpression =
              typeof expression === "function"
                ? expression({ harnessReadyEpochMs: Date.now() })
                : expression;
            const controlledExpression =
              createControlledHarnessEvaluationExpression(resolvedExpression);
            const evaluation = await client.send(
              "Runtime.evaluate",
              {
                expression: controlledExpression,
                awaitPromise: true,
                returnByValue: true,
              },
              sessionId,
              B1_LIFECYCLE_EVALUATION_TIMEOUT_MS,
            );
            if (evaluation.exceptionDetails) {
              const failure = createHarnessEvaluationError(evaluationErrorCode);
              if (process.env.GATE_014_B1_DEBUG === "1") {
                process.stderr.write(
                  "Harness exception code: unknown_exception\n",
                );
              }
              throw failure;
            }
            return unwrapControlledHarnessEvaluation(
              evaluation.result?.value,
              evaluationErrorCode,
            );
          },
        );
        const observationReceipt = await executeB1BrowserStage(
          "browser_observation_settle_failed",
          async () => {
            await targetObserver.settle();
            await observation.settle();
            await targetObserver.stop();
            await observation.settle();
            return observation.finish();
          },
        );
        if (process.env.GATE_014_B1_DEBUG === "1") {
          process.stderr.write(
            `Browser observation counts: ${JSON.stringify(observationReceipt)}\n`,
          );
        }
        return {
          value: controlledValue,
          observation: validateBrowserExecutionObservation(observationReceipt),
          productionExtensionId,
        };
      } catch (error) {
        if (stderr && process.env.GATE_014_B1_DEBUG === "1") {
          process.stderr.write(stderr);
        }
        throw error;
      }
    },
    () =>
      chrome
        ? executeB1BrowserStage("browser_process_cleanup_failed", () =>
            executeB1BrowserOperationWithCleanup(
              () =>
                executeB1BrowserStage(
                  "browser_process_termination_failed",
                  () => terminateChromeProcessTree(chrome),
                ),
              () =>
                executeB1BrowserStage(
                  "browser_cdp_close_failed",
                  () => client?.close(),
                ),
            ),
          )
        : undefined,
  );
}

export function validateControlledHarnessEvaluation(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join("|") !==
      ["contract", "failureCode", "status", "storesSensitiveText", "value"]
        .sort()
        .join("|") ||
    value.contract !== "gate-014-b1-controlled-evaluation-v1" ||
    value.storesSensitiveText !== false ||
    !["pass", "fail"].includes(value.status) ||
    (value.status === "pass" && value.failureCode !== null) ||
    (value.status === "fail" && value.value !== null) ||
    (value.failureCode !== null &&
      (typeof value.failureCode !== "string" ||
        !/^[a-z0-9_:-]{1,96}$/.test(value.failureCode)))
  ) {
    throw new Error("browser_controlled_harness_evaluation_invalid");
  }
  return value;
}

export function createControlledHarnessEvaluationExpression(expression) {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new Error("browser_controlled_harness_expression_invalid");
  }
  return (
    `globalThis.runGate014B1ControlledEvaluation(` +
    `() => (${expression}))`
  );
}

export function unwrapControlledHarnessEvaluation(value, evaluationErrorCode) {
  const controlled = validateControlledHarnessEvaluation(value);
  if (controlled.status === "fail") {
    throw createHarnessEvaluationError(
      evaluationErrorCode,
      controlled.failureCode,
    );
  }
  return controlled.value;
}

function createHarnessEvaluationError(
  evaluationErrorCode,
  structuredFailureCode = null,
) {
  const error = new Error(evaluationErrorCode);
  if (
    typeof structuredFailureCode === "string" &&
    /^[a-z0-9_:-]{1,96}$/.test(structuredFailureCode)
  ) {
    Object.defineProperty(error, "gate014FailureCode", {
      configurable: false,
      enumerable: false,
      value: structuredFailureCode,
      writable: false,
    });
    B1_BROWSER_FAILURE_CODES.set(error, structuredFailureCode);
  }
  return error;
}

export function readB1BrowserControlledFailureCode(error) {
  if (
    !error ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return null;
  }
  return B1_BROWSER_FAILURE_CODES.get(error) ?? null;
}

export async function executeB1BrowserStage(stageCode, task) {
  if (
    !B1_BROWSER_STAGE_FAILURE_CODES.includes(stageCode) ||
    typeof task !== "function"
  ) {
    throw new Error("browser_controlled_stage_invalid");
  }
  try {
    return await task();
  } catch (error) {
    if (readB1BrowserControlledFailureCode(error) !== null) {
      throw error;
    }
    const controlled = new Error("browser_controlled_stage_failed");
    Object.defineProperty(controlled, "gate014FailureCode", {
      configurable: false,
      enumerable: false,
      value: stageCode,
      writable: false,
    });
    B1_BROWSER_FAILURE_CODES.set(controlled, stageCode);
    throw controlled;
  }
}

export async function waitForB1BrowserProcessSpawn(child) {
  if (
    !child ||
    typeof child.once !== "function" ||
    typeof child.removeListener !== "function"
  ) {
    throw new Error("browser_process_spawn_observer_invalid");
  }
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
    };
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
  return child;
}

export async function executeB1BrowserOperationWithCleanup(task, cleanup) {
  if (typeof task !== "function" || typeof cleanup !== "function") {
    throw new Error("browser_controlled_cleanup_invalid");
  }
  let result;
  let primaryFailed = false;
  let primaryError;
  try {
    result = await task();
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  }
  let cleanupFailed = false;
  let cleanupError;
  try {
    await cleanup();
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }
  if (
    primaryFailed &&
    readB1BrowserControlledFailureCode(primaryError) !== null
  ) {
    throw primaryError;
  }
  if (cleanupFailed) {
    throw cleanupError;
  }
  if (primaryFailed) {
    throw primaryError;
  }
  return result;
}

export async function settleB1FixtureServerCleanup(servers) {
  if (!Array.isArray(servers)) {
    throw new Error("browser_fixture_server_cleanup_invalid");
  }
  const closeResults = await Promise.allSettled(
    servers
      .filter((server) => server != null)
      .map((server) => Promise.resolve().then(() => server.close())),
  );
  if (closeResults.some((result) => result.status === "rejected")) {
    throw new Error("browser_fixture_server_cleanup_incomplete");
  }
}

export function createCdpExecutionObservation(client) {
  const observedSessionIds = new Set();
  const observedExtensionIds = new Map();
  const syntheticResponseNetworkIds = new Map();
  const pendingSyntheticResponses = new Set();
  const queuedSyntheticRequests = [];
  let requiredExtensionIds = null;
  let syntheticResponseFailure = null;
  const counts = {
    networkRequestCount: 0,
    loopbackRequestCount: 0,
    extensionRequestCount: 0,
    externalRequestAttemptCount: 0,
    syntheticUnauthenticatedResponseCount: 0,
    externalResponseCount: 0,
    consoleErrorCount: 0,
    unattributedLogErrorCount: 0,
  };
  const unsubscribe = client.onEvent((message) => {
    if (!observedSessionIds.has(message.sessionId)) {
      return;
    }
    const observedExtensionId = observedExtensionIds.get(message.sessionId);
    if (message.method === "Fetch.requestPaused") {
      if (!requiredExtensionIds) {
        if (
          queuedSyntheticRequests.length >=
          B1_MAX_QUEUED_SYNTHETIC_REQUESTS
        ) {
          trackSyntheticUnauthenticatedResponse(
            client,
            message,
            observedExtensionId,
            null,
            syntheticResponseNetworkIds,
            pendingSyntheticResponses,
            counts,
            (error) => {
              syntheticResponseFailure ??= error;
            },
          );
          return;
        }
        queuedSyntheticRequests.push({ message, observedExtensionId });
        return;
      }
      trackSyntheticUnauthenticatedResponse(
        client,
        message,
        observedExtensionId,
        requiredExtensionIds.productionExtensionId,
        syntheticResponseNetworkIds,
        pendingSyntheticResponses,
        counts,
        (error) => {
          syntheticResponseFailure ??= error;
        },
      );
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      counts.networkRequestCount += 1;
      const classification = classifyNetworkUrl(message.params?.request?.url);
      if (classification.kind === "loopback") {
        counts.loopbackRequestCount += 1;
      } else if (classification.kind === "extension") {
        counts.extensionRequestCount += 1;
      } else if (classification.kind === "external") {
        counts.externalRequestAttemptCount += 1;
        debugExternalNetworkClass("request", classification);
      }
      return;
    }
    if (message.method === "Network.responseReceived") {
      if (
        consumeSyntheticNetworkResponse(
          syntheticResponseNetworkIds,
          message.sessionId,
          message.params?.requestId,
        )
      ) {
        return;
      }
      const classification = classifyNetworkUrl(message.params?.response?.url);
      if (classification.kind === "external") {
        counts.externalResponseCount += 1;
        debugExternalNetworkClass("response", classification);
      }
      return;
    }
    const errorClassification = classifyObservedErrorEvent(message);
    if (errorClassification === "extension_error") {
      counts.consoleErrorCount += 1;
    } else if (errorClassification === "unattributed_log_error") {
      counts.unattributedLogErrorCount += 1;
    }
  });
  return {
    observeSession(sessionId, extensionId) {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("browser_observation_session_invalid");
      }
      if (!EXTENSION_ID_PATTERN.test(extensionId ?? "")) {
        throw new Error("browser_observation_extension_identity_invalid");
      }
      observedSessionIds.add(sessionId);
      observedExtensionIds.set(sessionId, extensionId);
    },
    setRequiredExtensionIds({ productionExtensionId, harnessExtensionId }) {
      if (
        !EXTENSION_ID_PATTERN.test(productionExtensionId ?? "") ||
        !EXTENSION_ID_PATTERN.test(harnessExtensionId ?? "") ||
        productionExtensionId === harnessExtensionId
      ) {
        throw new Error("browser_observation_required_identity_invalid");
      }
      requiredExtensionIds = { productionExtensionId, harnessExtensionId };
      for (const queued of queuedSyntheticRequests.splice(0)) {
        trackSyntheticUnauthenticatedResponse(
          client,
          queued.message,
          queued.observedExtensionId,
          productionExtensionId,
          syntheticResponseNetworkIds,
          pendingSyntheticResponses,
          counts,
          (error) => {
            syntheticResponseFailure ??= error;
          },
        );
      }
    },
    async settle(timeoutMs = B1_SYNTHETIC_RESPONSE_SETTLE_TIMEOUT_MS) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
        throw new Error("browser_synthetic_response_settle_timeout_invalid");
      }
      const deadlineEpochMs = Date.now() + timeoutMs;
      while (true) {
        await Promise.all([...pendingSyntheticResponses]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (syntheticResponseFailure) {
          throw syntheticResponseFailure;
        }
        if (
          pendingSyntheticResponses.size === 0 &&
          syntheticResponseNetworkIds.size === 0
        ) {
          return;
        }
        if (Date.now() >= deadlineEpochMs) {
          throw new Error("browser_synthetic_response_observation_incomplete");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    async waitForSyntheticUnauthenticatedResponse(
      options = {},
    ) {
      const deadlineEpochMs = resolveSetupDeadline({
        ...options,
        timeoutMs:
          options.timeoutMs ?? B1_SYNTHETIC_RESPONSE_SETTLE_TIMEOUT_MS,
      });
      while (Date.now() < deadlineEpochMs) {
        await settleWithin(
          Promise.all([...pendingSyntheticResponses]),
          remainingSetupMs(deadlineEpochMs),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (syntheticResponseFailure) {
          throw syntheticResponseFailure;
        }
        if (
          counts.syntheticUnauthenticatedResponseCount >= 1 &&
          pendingSyntheticResponses.size === 0 &&
          syntheticResponseNetworkIds.size === 0
        ) {
          return;
        }
        await delay(
          Math.min(10, Math.max(1, remainingSetupMs(deadlineEpochMs))),
        );
      }
      throw new Error("browser_synthetic_response_observation_incomplete");
    },
    finish() {
      if (!requiredExtensionIds) {
        throw new Error("browser_observation_required_identity_missing");
      }
      if (
        syntheticResponseFailure ||
        pendingSyntheticResponses.size > 0 ||
        syntheticResponseNetworkIds.size > 0 ||
        queuedSyntheticRequests.length > 0
      ) {
        throw new Error("browser_synthetic_unauthenticated_response_failed");
      }
      unsubscribe();
      const extensionIds = [...observedExtensionIds.values()];
      return {
        contract: "gate-014-b1-browser-observation-v4",
        browserLaunchCount: 1,
        observationScope:
          "extension_targets_after_devtools_attach_with_production_worker_barrier",
        preAttachEventsObserved: false,
        productionServiceWorkerStartupBarrierEnabled: true,
        observedTargetCount: observedSessionIds.size,
        productionExtensionTargetCount: extensionIds.filter(
          (extensionId) =>
            extensionId === requiredExtensionIds.productionExtensionId,
        ).length,
        harnessExtensionTargetCount: extensionIds.filter(
          (extensionId) =>
            extensionId === requiredExtensionIds.harnessExtensionId,
        ).length,
        networkMetricAvailable: true,
        ...counts,
        consoleMetricAvailable: true,
      };
    },
  };
}

export function classifyObservedErrorEvent(message) {
  if (
    message?.method === "Runtime.exceptionThrown" ||
    (message?.method === "Runtime.consoleAPICalled" &&
      ["error", "assert"].includes(message.params?.type))
  ) {
    return "extension_error";
  }
  if (
    message?.method !== "Log.entryAdded" ||
    message.params?.entry?.level !== "error"
  ) {
    return null;
  }
  if (message.params.entry.source === "javascript") {
    return "extension_error";
  }
  if (message.params.entry.source === "other") {
    return "unattributed_log_error";
  }
  const extensionId = getExtensionIdFromTargetUrl(message.params.entry.url);
  return EXTENSION_ID_PATTERN.test(extensionId ?? "")
    ? "extension_error"
    : "unattributed_log_error";
}

function trackSyntheticUnauthenticatedResponse(
  client,
  message,
  observedExtensionId,
  productionExtensionId,
  syntheticResponseNetworkIds,
  pendingSyntheticResponses,
  counts,
  recordFailure,
) {
  const response = fulfillSyntheticUnauthenticatedResponse(
    client,
    message,
    observedExtensionId,
    productionExtensionId,
    syntheticResponseNetworkIds,
  )
    .then(() => {
      counts.syntheticUnauthenticatedResponseCount += 1;
    })
    .catch(() => {
      recordFailure(
        new Error("browser_synthetic_unauthenticated_response_failed"),
      );
    })
    .finally(() => {
      pendingSyntheticResponses.delete(response);
    });
  pendingSyntheticResponses.add(response);
}

async function fulfillSyntheticUnauthenticatedResponse(
  client,
  message,
  observedExtensionId,
  productionExtensionId,
  syntheticResponseNetworkIds,
) {
  const requestId = message.params?.requestId;
  const networkId = message.params?.networkId;
  const request = message.params?.request;
  if (
    !EXTENSION_ID_PATTERN.test(productionExtensionId ?? "") ||
    observedExtensionId !== productionExtensionId ||
    typeof requestId !== "string" ||
    requestId.length === 0 ||
    typeof networkId !== "string" ||
    networkId.length === 0 ||
    !isSyntheticUnauthenticatedRequest(request)
  ) {
    if (typeof requestId === "string" && requestId.length > 0) {
      await client.send(
        "Fetch.failRequest",
        { requestId, errorReason: "BlockedByClient" },
        message.sessionId,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
    }
    throw new Error("browser_synthetic_unauthenticated_request_invalid");
  }
  rememberSyntheticNetworkResponse(
    syntheticResponseNetworkIds,
    message.sessionId,
    networkId,
  );
  await client.send(
    "Fetch.fulfillRequest",
    {
      requestId,
      responseCode: 200,
      responsePhrase: "OK",
      responseHeaders: [
        { name: "Content-Type", value: "application/json; charset=utf-8" },
        { name: "Cache-Control", value: "no-store" },
      ],
      body: SYNTHETIC_UNAUTHENTICATED_RESPONSE_BODY,
    },
    message.sessionId,
    B1_CDP_SETUP_TIMEOUT_MS,
  );
}

function isSyntheticUnauthenticatedRequest(request) {
  return (
    request?.method === "GET" && request.url === BILIBILI_HISTORY_CURSOR_URL
  );
}

function rememberSyntheticNetworkResponse(store, sessionId, networkId) {
  if (!store.has(sessionId)) {
    store.set(sessionId, new Set());
  }
  store.get(sessionId).add(networkId);
}

function consumeSyntheticNetworkResponse(store, sessionId, networkId) {
  const sessionNetworkIds = store.get(sessionId);
  if (!sessionNetworkIds?.delete(networkId)) {
    return false;
  }
  if (sessionNetworkIds.size === 0) {
    store.delete(sessionId);
  }
  return true;
}

function classifyNetworkUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "chrome-extension:") {
      return { kind: "extension", protocol: parsed.protocol, hostname: "" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { kind: "other", protocol: parsed.protocol, hostname: "" };
    }
    if (["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
      return {
        kind: "loopback",
        protocol: parsed.protocol,
        hostname: parsed.hostname,
      };
    }
    return {
      kind: "external",
      protocol: parsed.protocol,
      hostname: parsed.hostname,
    };
  } catch {
    return { kind: "external", protocol: "invalid:", hostname: "" };
  }
}

function debugExternalNetworkClass(eventKind, classification) {
  if (process.env.GATE_014_B1_DEBUG !== "1") {
    return;
  }
  process.stderr.write(
    `External ${eventKind} class: ${classification.protocol}//${classification.hostname}\n`,
  );
}

export async function loadUnpackedExtension(client, extensionPath, options = {}) {
  if (!path.isAbsolute(extensionPath)) {
    throw new Error("browser_extension_path_invalid");
  }
  const deadlineEpochMs = resolveSetupDeadline(options);
  const { id } = await sendCdpWithinDeadline(
    client,
    "Extensions.loadUnpacked",
    { path: extensionPath },
    undefined,
    deadlineEpochMs,
  );
  if (!EXTENSION_ID_PATTERN.test(id ?? "")) {
    throw new Error("browser_extension_dynamic_load_failed");
  }
  return id;
}

export async function uninstallUnpackedExtension(
  client,
  extensionId,
  options = {},
) {
  if (!EXTENSION_ID_PATTERN.test(extensionId ?? "")) {
    throw new Error("browser_extension_identity_invalid");
  }
  const deadlineEpochMs = resolveSetupDeadline(options);
  await sendCdpWithinDeadline(
    client,
    "Extensions.uninstall",
    { id: extensionId },
    undefined,
    deadlineEpochMs,
  );
  const { extensions } = await sendCdpWithinDeadline(
    client,
    "Extensions.getExtensions",
    {},
    undefined,
    deadlineEpochMs,
  );
  if (
    !Array.isArray(extensions) ||
    extensions.some((extension) => extension?.id === extensionId)
  ) {
    throw new Error("browser_extension_uninstall_failed");
  }
}

export function createExtensionTargetObserver(
  client,
  observation,
  options = {},
) {
  const observedTargetTypes = new Set([
    "page",
    "background_page",
    "service_worker",
    "shared_worker",
  ]);
  const attachedTargets = new Map();
  const attachmentPromises = new Set();
  const forbiddenProductionExtensionIdList =
    options.forbiddenProductionExtensionIds ?? [];
  if (!Array.isArray(forbiddenProductionExtensionIdList)) {
    throw new Error("browser_production_extension_identity_invalid");
  }
  const forbiddenProductionExtensionIds = new Set(
    forbiddenProductionExtensionIdList,
  );
  if (
    [...forbiddenProductionExtensionIds].some(
      (extensionId) =>
        !EXTENSION_ID_PATTERN.test(extensionId ?? "") ||
        extensionId === B1_HARNESS_EXTENSION_ID,
    )
  ) {
    throw new Error("browser_production_extension_identity_invalid");
  }
  const unpausedServiceWorkerExtensionIds = new Set();
  let requiredProductionExtensionId = null;
  let attachmentFailure = null;
  let unsubscribe = null;
  let setupDeadlineEpochMs = null;

  const shouldObserve = (targetInfo) =>
    observedTargetTypes.has(targetInfo?.type) &&
    typeof targetInfo?.url === "string" &&
    targetInfo.url.startsWith("chrome-extension://");

  const trackAttachment = (targetId, attachment) => {
    const tracked = attachment.catch((error) => {
      attachmentFailure ??= error;
      throw error;
    });
    if (targetId) {
      attachedTargets.set(targetId, tracked);
    }
    attachmentPromises.add(tracked);
    return tracked;
  };

  const waitForAutoAttachedTarget = async (targetId, timeoutMs) => {
    const deadlineEpochMs = Date.now() + timeoutMs;
    while (Date.now() < deadlineEpochMs) {
      if (attachmentFailure) {
        throw attachmentFailure;
      }
      const attachment = attachedTargets.get(targetId);
      if (attachment) {
        return attachment;
      }
      await delay(Math.min(10, Math.max(0, deadlineEpochMs - Date.now())));
    }
    throw new Error("browser_extension_startup_barrier_missing");
  };

  const ensureTarget = (targetInfo, timeoutMs = B1_CDP_SETUP_TIMEOUT_MS) => {
    if (!shouldObserve(targetInfo)) {
      return Promise.resolve(null);
    }
    if (targetInfo.type === "service_worker") {
      return waitForAutoAttachedTarget(targetInfo.targetId, timeoutMs).catch(
        (error) => {
          attachmentFailure ??= error;
          throw error;
        },
      );
    }
    if (attachedTargets.has(targetInfo.targetId)) {
      return attachedTargets.get(targetInfo.targetId);
    }
    return trackAttachment(
      targetInfo.targetId,
      attachObservedTarget(client, observation, targetInfo, timeoutMs),
    );
  };

  const waitForObservedTargetId = async (targetId, timeoutMs) => {
    const deadlineEpochMs = Date.now() + timeoutMs;
    while (Date.now() < deadlineEpochMs) {
      if (attachmentFailure) {
        throw attachmentFailure;
      }
      const existingAttachment = attachedTargets.get(targetId);
      if (existingAttachment) {
        return existingAttachment;
      }
      const remainingMs = Math.max(1, deadlineEpochMs - Date.now());
      const { targetInfo } = await client.send(
        "Target.getTargetInfo",
        { targetId },
        undefined,
        remainingMs,
      );
      const attachment = await ensureTarget(targetInfo, remainingMs);
      if (attachment !== null) {
        return attachment;
      }
      await delay(Math.min(10, Math.max(0, deadlineEpochMs - Date.now())));
    }
    return null;
  };

  const handleAutoAttachedTarget = (params, timeoutMs) => {
    const sessionId = params?.sessionId;
    const targetInfo = params?.targetInfo;
    const waitingForDebugger = params?.waitingForDebugger;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return trackAttachment(
        null,
        Promise.reject(new Error("browser_auto_attach_session_invalid")),
      );
    }
    if (targetInfo?.type !== "service_worker") {
      if (waitingForDebugger !== true) {
        return Promise.resolve(null);
      }
      return trackAttachment(
        null,
        client.send(
          "Runtime.runIfWaitingForDebugger",
          {},
          sessionId,
          timeoutMs,
        ),
      );
    }
    if (!shouldObserve(targetInfo)) {
      if (waitingForDebugger !== true) {
        return Promise.resolve(null);
      }
      return trackAttachment(
        null,
        client.send(
          "Runtime.runIfWaitingForDebugger",
          {},
          sessionId,
          timeoutMs,
        ),
      );
    }
    const extensionId = getExtensionIdFromTargetUrl(targetInfo.url);
    if (forbiddenProductionExtensionIds.has(extensionId)) {
      return trackAttachment(
        targetInfo.targetId,
        Promise.reject(new Error("browser_extension_startup_barrier_missing")),
      );
    }
    if (waitingForDebugger !== true) {
      if (extensionId !== B1_HARNESS_EXTENSION_ID) {
        unpausedServiceWorkerExtensionIds.add(extensionId);
      }
      if (extensionId === requiredProductionExtensionId) {
        return trackAttachment(
          targetInfo.targetId,
          Promise.reject(new Error("browser_extension_startup_barrier_missing")),
        );
      }
      return trackAttachment(
        targetInfo.targetId,
        configureObservedSession(
          client,
          observation,
          targetInfo,
          sessionId,
          timeoutMs,
          false,
        ),
      );
    }
    return trackAttachment(
      targetInfo.targetId,
      configureObservedSession(
        client,
        observation,
        targetInfo,
        sessionId,
        timeoutMs,
        true,
      ),
    );
  };

  const settleAttachments = async () => {
    while (true) {
      const attachmentCount = attachmentPromises.size;
      await Promise.all([...attachmentPromises]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (attachmentFailure) {
        throw attachmentFailure;
      }
      if (attachmentPromises.size === attachmentCount) {
        return;
      }
    }
  };

  const currentAttachmentTimeoutMs = () =>
    setupDeadlineEpochMs === null
      ? B1_CDP_SETUP_TIMEOUT_MS
      : remainingSetupMs(setupDeadlineEpochMs);

  return {
    async start(options = {}) {
      setupDeadlineEpochMs = resolveSetupDeadline(options);
      unsubscribe = client.onEvent((message) => {
        if (message.sessionId !== undefined) {
          return;
        }
        let timeoutMs;
        try {
          timeoutMs = currentAttachmentTimeoutMs();
        } catch {
          return;
        }
        if (message.method === "Target.attachedToTarget") {
          void settleWithin(
            handleAutoAttachedTarget(message.params, timeoutMs),
            timeoutMs,
          ).catch(() => {});
          return;
        }
        if (
          ["Target.targetCreated", "Target.targetInfoChanged"].includes(
            message.method,
          )
        ) {
          void settleWithin(
            ensureTarget(message.params?.targetInfo, timeoutMs),
            timeoutMs,
          ).catch(() => {});
        }
      });
      await sendCdpWithinDeadline(
        client,
        "Target.setAutoAttach",
        {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
          filter: [
            { type: "service_worker", exclude: false },
            { exclude: true },
          ],
        },
        undefined,
        setupDeadlineEpochMs,
      );
      await sendCdpWithinDeadline(
        client,
        "Target.setDiscoverTargets",
        { discover: true },
        undefined,
        setupDeadlineEpochMs,
      );
      const { targetInfos = [] } = await sendCdpWithinDeadline(
        client,
        "Target.getTargets",
        {},
        undefined,
        setupDeadlineEpochMs,
      );
      const attachmentTimeoutMs = currentAttachmentTimeoutMs();
      await settleWithin(
        Promise.all(
          targetInfos.map((targetInfo) =>
            ensureTarget(targetInfo, attachmentTimeoutMs),
          ),
        ),
        attachmentTimeoutMs,
      );
    },
    async ensureTargetId(targetId, timeoutMs = B1_CDP_SETUP_TIMEOUT_MS) {
      return waitForObservedTargetId(targetId, timeoutMs);
    },
    requireProductionServiceWorkerBarrier(extensionId) {
      if (
        !EXTENSION_ID_PATTERN.test(extensionId ?? "") ||
        extensionId === B1_HARNESS_EXTENSION_ID ||
        forbiddenProductionExtensionIds.has(extensionId)
      ) {
        throw new Error("browser_production_extension_identity_invalid");
      }
      requiredProductionExtensionId = extensionId;
      if (unpausedServiceWorkerExtensionIds.has(extensionId)) {
        throw new Error("browser_extension_startup_barrier_missing");
      }
    },
    async ensureServiceWorkerTargetId(
      targetId,
      extensionId,
      timeoutMs = B1_CDP_SETUP_TIMEOUT_MS,
    ) {
      const { targetInfo } = await client.send(
        "Target.getTargetInfo",
        { targetId },
        undefined,
        timeoutMs,
      );
      if (
        targetInfo?.type !== "service_worker" ||
        getExtensionIdFromTargetUrl(targetInfo?.url) !== extensionId
      ) {
        throw new Error("browser_production_service_worker_target_invalid");
      }
      return ensureTarget(targetInfo, timeoutMs);
    },
    async settle() {
      await settleAttachments();
    },
    completeSetup() {
      setupDeadlineEpochMs = null;
    },
    async stop() {
      await settleAttachments();
      await client.send(
        "Target.setDiscoverTargets",
        { discover: false },
        undefined,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
      await client.send(
        "Target.setAutoAttach",
        {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: true,
        },
        undefined,
        B1_CDP_SETUP_TIMEOUT_MS,
      );
      await settleAttachments();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

async function attachObservedTarget(
  client,
  observation,
  targetInfo,
  timeoutMs = B1_CDP_SETUP_TIMEOUT_MS,
) {
  const { sessionId } = await client.send(
    "Target.attachToTarget",
    { targetId: targetInfo.targetId, flatten: true },
    undefined,
    timeoutMs,
  );
  return configureObservedSession(
    client,
    observation,
    targetInfo,
    sessionId,
    timeoutMs,
    false,
  );
}

async function configureObservedSession(
  client,
  observation,
  targetInfo,
  sessionId,
  timeoutMs,
  resumeWhenReady,
) {
  const extensionId = new URL(targetInfo.url).hostname;
  observation.observeSession(sessionId, extensionId);
  const enableCommands = [
    client.send("Runtime.enable", {}, sessionId, timeoutMs),
    client.send("Network.enable", {}, sessionId, timeoutMs),
    client.send("Log.enable", {}, sessionId, timeoutMs),
  ];
  if (extensionId !== B1_HARNESS_EXTENSION_ID) {
    enableCommands.push(
      client.send(
        "Fetch.enable",
        {
          patterns: [
            {
              urlPattern: `https://${BILIBILI_API_HOSTNAME}/*`,
              requestStage: "Request",
            },
          ],
        },
        sessionId,
        timeoutMs,
      ),
    );
  }
  await Promise.all(enableCommands);
  if (resumeWhenReady) {
    await client.send(
      "Runtime.runIfWaitingForDebugger",
      {},
      sessionId,
      timeoutMs,
    );
  }
  return sessionId;
}

async function readProductionExtensionIdentity(productionExtension) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(productionExtension, "manifest.json"), "utf8"),
    );
  } catch {
    throw new Error("browser_production_extension_manifest_invalid");
  }
  const identity = {
    name: manifest?.name,
    version: manifest?.version,
    versionName: manifest?.version_name,
  };
  return validateExpectedProductionExtensionIdentity(identity);
}

async function readLoadedExtensionInventory(client, sessionId, options = {}) {
  const deadline = resolveSetupDeadline(options);
  const evaluation = await sendCdpWithinDeadline(
    client,
    "Runtime.evaluate",
    {
      expression: "globalThis.runGate014B1LoadedExtensionInventory()",
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
    deadline,
  );
  if (evaluation.exceptionDetails || !Array.isArray(evaluation.result?.value)) {
    throw new Error("browser_loaded_extension_inventory_failed");
  }
  return evaluation.result.value;
}

export async function waitForProductionExtensionReady(
  client,
  sessionId,
  expectedExtensionId,
  expectedIdentity,
  options = {},
) {
  const deadline = resolveSetupDeadline(options);
  const pollIntervalMs = validatePollInterval(options.pollIntervalMs);
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    let evaluation;
    try {
      evaluation = await settleWithin(
        client.send(
          "Runtime.evaluate",
          {
            expression:
              "(() => { const manifest = chrome.runtime.getManifest(); return { id: chrome.runtime.id, name: manifest.name, version: manifest.version, versionName: manifest.version_name ?? null }; })()",
            returnByValue: true,
          },
          sessionId,
          remainingMs,
        ),
        remainingMs,
      );
    } catch {
      if (Date.now() >= deadline) {
        break;
      }
      await delay(Math.min(pollIntervalMs, deadline - Date.now()));
      continue;
    }
    if (Date.now() >= deadline) {
      break;
    }
    const identity = evaluation.result?.value;
    if (
      !evaluation.exceptionDetails &&
      identity?.id === expectedExtensionId &&
      identity?.name === expectedIdentity.name &&
      identity?.version === expectedIdentity.version &&
      identity?.versionName === expectedIdentity.versionName
    ) {
      return;
    }
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error("browser_production_extension_runtime_identity_failed");
}

export function selectProductionServiceWorkerTarget(targetInfos, extensionId) {
  if (!Array.isArray(targetInfos) || !EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error("browser_production_service_worker_target_invalid");
  }
  const matches = targetInfos.filter(
    (candidate) =>
      candidate?.type === "service_worker" &&
      getExtensionIdFromTargetUrl(candidate?.url) === extensionId,
  );
  if (matches.length > 1) {
    throw new Error("browser_production_service_worker_target_ambiguous");
  }
  return matches[0] ?? null;
}

export async function findProductionServiceWorkerSession(
  client,
  targetObserver,
  extensionId,
  options = {},
) {
  const deadline = resolveSetupDeadline(options);
  const pollIntervalMs = validatePollInterval(options.pollIntervalMs);
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    let targetInfos;
    try {
      ({ targetInfos = [] } = await settleWithin(
        client.send("Target.getTargets", {}, undefined, remainingMs),
        remainingMs,
      ));
    } catch {
      if (Date.now() >= deadline) {
        return null;
      }
      await delay(Math.min(pollIntervalMs, deadline - Date.now()));
      continue;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    const target = selectProductionServiceWorkerTarget(
      targetInfos,
      extensionId,
    );
    if (target) {
      const attachRemainingMs = deadline - Date.now();
      if (attachRemainingMs <= 0) {
        return null;
      }
      try {
        const sessionId = await settleWithin(
          targetObserver.ensureServiceWorkerTargetId(
            target.targetId,
            extensionId,
            attachRemainingMs,
          ),
          attachRemainingMs,
        );
        return Date.now() < deadline ? sessionId : null;
      } catch {
        // A Manifest V3 worker can stop between discovery and attachment.
      }
    }
    if (Date.now() < deadline) {
      await delay(Math.min(pollIntervalMs, deadline - Date.now()));
    }
  }
  return null;
}

function resolveSetupDeadline(options) {
  if (options.deadlineEpochMs !== undefined) {
    if (!Number.isSafeInteger(options.deadlineEpochMs)) {
      throw new Error("browser_production_service_worker_poll_invalid");
    }
    return options.deadlineEpochMs;
  }
  const timeoutMs = options.timeoutMs ?? B1_CDP_SETUP_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("browser_production_service_worker_poll_invalid");
  }
  return Date.now() + timeoutMs;
}

function validatePollInterval(value) {
  const pollIntervalMs = value ?? 50;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error("browser_production_service_worker_poll_invalid");
  }
  return pollIntervalMs;
}

function remainingSetupMs(deadlineEpochMs) {
  const remainingMs = deadlineEpochMs - Date.now();
  if (!Number.isSafeInteger(deadlineEpochMs) || remainingMs <= 0) {
    throw new Error("cdp_command_timeout");
  }
  return remainingMs;
}

async function sendCdpWithinDeadline(
  client,
  method,
  params,
  sessionId,
  deadlineEpochMs,
) {
  const timeoutMs = remainingSetupMs(deadlineEpochMs);
  const result = await settleWithin(
    client.send(method, params, sessionId, timeoutMs),
    timeoutMs,
  );
  if (Date.now() >= deadlineEpochMs) {
    throw new Error("cdp_command_timeout");
  }
  return result;
}

async function settleWithin(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("cdp_command_timeout");
  }
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("cdp_command_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function getExtensionIdFromTargetUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "chrome-extension:" ? parsed.hostname : null;
  } catch {
    return null;
  }
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
    await closeB1FixtureHttpServer(server);
    throw new Error("browser_fixture_server_address_invalid");
  }
  return {
    port: address.port,
    artifactUrl: `http://127.0.0.1:${address.port}${expectedPath}`,
    getRequestCount() {
      return requestCount;
    },
    async close() {
      await closeB1FixtureHttpServer(server);
    },
  };
}

export async function closeB1FixtureHttpServer(server) {
  if (!server || typeof server.close !== "function") {
    throw new Error("browser_fixture_server_close_invalid");
  }
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitForHarnessReady(client, sessionId, options = {}) {
  const deadline = resolveSetupDeadline(options);
  let lastState = null;
  while (Date.now() < deadline) {
    const evaluation = await sendCdpWithinDeadline(
      client,
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
      deadline,
    );
    lastState = evaluation.result?.value ?? null;
    if (!evaluation.exceptionDetails && lastState?.ready === true) {
      return;
    }
    await delay(Math.min(50, Math.max(0, deadline - Date.now())));
  }
  if (process.env.GATE_014_B1_DEBUG === "1" && lastState) {
    process.stderr.write(`Harness state: ${JSON.stringify(lastState)}\n`);
  }
  throw new Error("browser_smoke_harness_start_timeout");
}

export function createPipeCdpClient(commandPipe, eventPipe) {
  if (
    typeof commandPipe?.write !== "function" ||
    typeof commandPipe?.end !== "function" ||
    typeof eventPipe?.on !== "function"
  ) {
    throw new Error("cdp_pipe_invalid");
  }
  const client = new CdpClient({
    send(message) {
      commandPipe.write(`${message}\0`, "utf8");
    },
    close() {
      commandPipe.end();
    },
  });
  let buffer = Buffer.alloc(0);
  const fail = () => client.fail(new Error("cdp_connection_closed"));
  const onData = (chunk) => {
    const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, nextChunk]);
    while (true) {
      const separatorIndex = buffer.indexOf(0);
      if (separatorIndex < 0) {
        break;
      }
      const messageBuffer = buffer.subarray(0, separatorIndex);
      buffer = buffer.subarray(separatorIndex + 1);
      if (messageBuffer.length === 0) {
        continue;
      }
      if (messageBuffer.length > B1_MAX_CDP_PIPE_MESSAGE_BYTES) {
        client.fail(new Error("cdp_pipe_message_too_large"));
        return;
      }
      try {
        client.receive(JSON.parse(messageBuffer.toString("utf8")));
      } catch {
        client.fail(new Error("cdp_pipe_message_invalid"));
        return;
      }
    }
    if (buffer.length > B1_MAX_CDP_PIPE_MESSAGE_BYTES) {
      client.fail(new Error("cdp_pipe_message_too_large"));
    }
  };
  eventPipe.on("data", onData);
  eventPipe.once("end", fail);
  eventPipe.once("close", fail);
  eventPipe.once("error", fail);
  commandPipe.once("error", fail);
  client.setTransportCleanup(() => {
    eventPipe.removeListener("data", onData);
    eventPipe.removeListener("end", fail);
    eventPipe.removeListener("close", fail);
    eventPipe.removeListener("error", fail);
    commandPipe.removeListener("error", fail);
  });
  return client;
}

class CdpClient {
  constructor(transport) {
    this.transport = transport;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.transportCleanup = null;
    this.connectionFailure = null;
  }

  setTransportCleanup(cleanup) {
    this.transportCleanup = cleanup;
  }

  receive(message) {
    if (!Number.isSafeInteger(message?.id)) {
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
  }

  fail(error) {
    if (this.connectionFailure) {
      return;
    }
    this.connectionFailure = error;
    for (const { reject, timeoutId } of this.pending.values()) {
      clearTimeout(timeoutId);
      reject(error);
    }
    this.pending.clear();
    this.transportCleanup?.();
    this.transportCleanup = null;
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  send(method, params = {}, sessionId, timeoutMs = B1_CDP_SETUP_TIMEOUT_MS) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("cdp_timeout_invalid");
    }
    if (this.connectionFailure) {
      return Promise.reject(this.connectionFailure);
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
        this.transport.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    this.transportCleanup?.();
    this.transportCleanup = null;
    this.transport.close();
    this.fail(new Error("cdp_connection_closed"));
  }
}

export function waitForProcessExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeoutId);
      resolve(true);
    };
    const timeoutId = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    timeoutId.unref();
    child.once("exit", onExit);
  });
}

export async function settleWindowsChromeClosureObservations(
  parentExitObservation,
  lineageObservation,
) {
  if (
    typeof parentExitObservation !== "function" ||
    typeof lineageObservation !== "function"
  ) {
    throw new Error("chrome_process_closure_observation_invalid");
  }
  const [parentExitResult, lineageResult] = await Promise.allSettled([
    Promise.resolve().then(parentExitObservation),
    Promise.resolve().then(lineageObservation),
  ]);
  if (parentExitResult.status === "rejected") {
    throw parentExitResult.reason;
  }
  if (lineageResult.status === "rejected") {
    throw lineageResult.reason;
  }
  return Object.freeze({
    parentExited: parentExitResult.value,
    survivors: lineageResult.value,
  });
}

export async function observeWindowsChromeClosure(options = {}) {
  const child = options.child;
  const initialProcesses = options.initialProcesses;
  const closureDeadlineEpochMs = options.closureDeadlineEpochMs;
  const now = options.now ?? Date.now;
  const waitForParentExit = options.waitForParentExit ?? waitForProcessExit;
  const waitForLineageExit =
    options.waitForLineageExit ?? waitForWindowsProcessTreeExit;
  const readProcessTable =
    options.readProcessTable ??
    ((readOptions) =>
      readWindowsProcessTable({
        ...readOptions,
        classifyLineageFailures: true,
      }));
  if (
    !child ||
    !Number.isSafeInteger(child.pid) ||
    child.pid < 1 ||
    !Array.isArray(initialProcesses) ||
    !Number.isFinite(closureDeadlineEpochMs) ||
    typeof now !== "function" ||
    typeof waitForParentExit !== "function" ||
    typeof waitForLineageExit !== "function" ||
    typeof readProcessTable !== "function"
  ) {
    throw new Error("chrome_process_closure_observation_invalid");
  }
  return settleWindowsChromeClosureObservations(
    () =>
      executeB1BrowserStage(
        "browser_process_parent_exit_failed",
        async () => {
          const observationStartedEpochMs = now();
          if (!Number.isFinite(observationStartedEpochMs)) {
            throw new Error("chrome_process_exit_observation_invalid");
          }
          const exited = await waitForParentExit(
            child,
            Math.max(
              0,
              closureDeadlineEpochMs - observationStartedEpochMs,
            ),
          );
          if (!exited) {
            throw new Error("chrome_process_exit_timeout");
          }
          return exited;
        },
      ),
    () =>
      executeB1BrowserStage(
        "browser_process_lineage_cleanup_failed",
        async () => {
          const remaining = await executeB1BrowserStage(
            "browser_process_lineage_observation_failed",
            () =>
              waitForLineageExit(initialProcesses, child.pid, {
                deadlineEpochMs: closureDeadlineEpochMs,
                now,
                readProcessTable,
              }),
          );
          await executeB1BrowserStage(
            "browser_process_lineage_survivors_failed",
            () => {
              if (remaining.length > 0) {
                throw new Error("chrome_process_tree_termination_failed");
              }
            },
          );
          return remaining;
        },
      ),
  );
}

export function findSurvivingWindowsProcessTree(
  initialProcesses,
  currentProcesses,
  rootProcessId,
  observedLineageProcessIds = [],
) {
  if (!Number.isSafeInteger(rootProcessId) || rootProcessId < 1) {
    throw new Error("chrome_process_identity_unavailable");
  }
  const initial = validateWindowsProcessTable(
    initialProcesses,
    "initial_process_table",
  );
  const current = validateWindowsProcessTable(
    currentProcesses,
    "current_process_table",
  );
  const observedLineage = validateWindowsLineageProcessIds(
    observedLineageProcessIds,
  );
  const initialLineage = collectDescendantProcessIds(initial, [rootProcessId]);
  const currentLineage = collectDescendantProcessIds(current, [
    ...initialLineage,
    ...observedLineage,
  ]);
  const currentProcessIds = new Set(
    current.map((process) => process.processId),
  );
  return Object.freeze(
    [...currentLineage]
      .filter((processId) => currentProcessIds.has(processId))
      .sort((left, right) => left - right),
  );
}

export async function waitForWindowsProcessTreeExit(
  initialProcesses,
  rootProcessId,
  options = {},
) {
  const deadlineEpochMs = options.deadlineEpochMs;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? delay;
  const readProcessTable =
    options.readProcessTable ?? readWindowsProcessTable;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  if (
    !Number.isFinite(deadlineEpochMs) ||
    typeof now !== "function" ||
    typeof wait !== "function" ||
    typeof readProcessTable !== "function" ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs <= 0
  ) {
    throw new Error("chrome_process_tree_wait_invalid");
  }
  const immutableInitialProcesses = Object.freeze(
    validateWindowsProcessTable(
      initialProcesses,
      "initial_process_table",
    ).map((process) => Object.freeze(process)),
  );
  const observedLineageProcessIds = new Set();
  let lastSurvivors = null;
  while (true) {
    const readStartedEpochMs = now();
    const remainingBeforeReadMs = deadlineEpochMs - readStartedEpochMs;
    if (
      !Number.isFinite(readStartedEpochMs) ||
      !Number.isFinite(remainingBeforeReadMs)
    ) {
      throw new Error("chrome_process_tree_wait_invalid");
    }
    if (remainingBeforeReadMs <= 0) {
      if (lastSurvivors !== null) {
        return lastSurvivors;
      }
      await executeB1BrowserStage(
        "browser_process_lineage_deadline_before_observation_failed",
        () => {
          throw new Error("chrome_process_tree_wait_timeout");
        },
      );
    }
    const currentProcesses = await executeB1BrowserStage(
      "browser_process_lineage_table_observation_failed",
      () =>
        readProcessTable({
          timeoutMs: Math.max(1, Math.ceil(remainingBeforeReadMs)),
          deadlineEpochMs,
          now,
        }),
    );
    const survivors = findSurvivingWindowsProcessTree(
      immutableInitialProcesses,
      currentProcesses,
      rootProcessId,
      [...observedLineageProcessIds],
    );
    for (const processId of survivors) {
      observedLineageProcessIds.add(processId);
    }
    const readCompletedEpochMs = now();
    if (!Number.isFinite(readCompletedEpochMs)) {
      throw new Error("chrome_process_tree_wait_invalid");
    }
    if (readCompletedEpochMs > deadlineEpochMs) {
      await executeB1BrowserStage(
        "browser_process_lineage_deadline_after_observation_failed",
        () => {
          throw new Error("chrome_process_tree_wait_timeout");
        },
      );
    }
    if (survivors.length === 0) {
      return survivors;
    }
    lastSurvivors = survivors;
    const remainingMs = deadlineEpochMs - readCompletedEpochMs;
    if (!Number.isFinite(remainingMs)) {
      throw new Error("chrome_process_tree_wait_invalid");
    }
    if (remainingMs <= 0) {
      return survivors;
    }
    await wait(Math.min(pollIntervalMs, remainingMs));
  }
}

export function validateWindowsChromeTerminationEvidence({
  nativeTerminationCompleted,
  nativeTerminationOutcome,
  rootObservedBeforeTermination,
  rootRunningBeforeTermination,
  parentExited,
  survivingProcessIds,
}) {
  if (
    nativeTerminationCompleted !== true ||
    !["exit_zero", "exit_numeric_nonzero"].includes(
      nativeTerminationOutcome,
    ) ||
    rootObservedBeforeTermination !== true ||
    rootRunningBeforeTermination !== true
  ) {
    throw new Error("chrome_process_tree_termination_failed");
  }
  if (parentExited !== true) {
    throw new Error("chrome_process_exit_timeout");
  }
  if (
    !Array.isArray(survivingProcessIds) ||
    survivingProcessIds.some(
      (processId) => !Number.isSafeInteger(processId) || processId < 1,
    ) ||
    survivingProcessIds.length > 0
  ) {
    throw new Error("chrome_process_tree_termination_failed");
  }
}

export function readCompletedWindowsTerminationOutcome(error) {
  if (
    error === null ||
    typeof error !== "object" ||
    !Number.isSafeInteger(error.code) ||
    error.code < 1 ||
    error.killed !== false ||
    error.signal !== null
  ) {
    throw new Error("chrome_process_tree_termination_failed");
  }
  return "exit_numeric_nonzero";
}

function validateWindowsProcessTable(processes, label) {
  if (!Array.isArray(processes)) {
    throw new Error(`${label}_invalid`);
  }
  const seenProcessIds = new Set();
  return processes.map((process) => {
    if (
      process === null ||
      typeof process !== "object" ||
      Array.isArray(process) ||
      !Number.isSafeInteger(process.processId) ||
      process.processId < 0 ||
      !Number.isSafeInteger(process.parentProcessId) ||
      process.parentProcessId < 0 ||
      seenProcessIds.has(process.processId)
    ) {
      throw new Error(`${label}_invalid`);
    }
    seenProcessIds.add(process.processId);
    return {
      processId: process.processId,
      parentProcessId: process.parentProcessId,
    };
  });
}

function validateWindowsLineageProcessIds(processIds) {
  if (
    !Array.isArray(processIds) ||
    processIds.some(
      (processId) => !Number.isSafeInteger(processId) || processId < 1,
    ) ||
    new Set(processIds).size !== processIds.length
  ) {
    throw new Error("observed_process_lineage_invalid");
  }
  return processIds;
}

function collectDescendantProcessIds(processes, seedProcessIds) {
  const lineage = new Set(seedProcessIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (
        lineage.has(process.parentProcessId) &&
        !lineage.has(process.processId)
      ) {
        lineage.add(process.processId);
        changed = true;
      }
    }
  }
  return lineage;
}

export async function readWindowsProcessTable(options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const execFileImpl = options.execFileImpl ?? execFile;
  const classifyLineageFailures = options.classifyLineageFailures === true;
  const deadlineEpochMs = options.deadlineEpochMs;
  const now = options.now ?? Date.now;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    typeof execFileImpl !== "function" ||
    (classifyLineageFailures &&
      (!Number.isFinite(deadlineEpochMs) || typeof now !== "function"))
  ) {
    throw new Error("chrome_process_tree_observation_failed");
  }
  const script = [
    "$rows = @(Get-CimInstance -ClassName Win32_Process | ForEach-Object { [pscustomobject]@{ processId = [int64]$_.ProcessId; parentProcessId = [int64]$_.ParentProcessId } })",
    "ConvertTo-Json -Compress -InputObject $rows",
  ].join("; ");
  let stdout;
  try {
    ({ stdout } = await execFileImpl(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      {
        windowsHide: true,
        timeout: Math.max(1, Math.floor(timeoutMs)),
        maxBuffer: 16 * 1024 * 1024,
      },
    ));
  } catch (error) {
    if (classifyLineageFailures) {
      const commandRejectedEpochMs = now();
      await executeB1BrowserStage(
        Number.isFinite(commandRejectedEpochMs) &&
          commandRejectedEpochMs >= deadlineEpochMs
          ? "browser_process_lineage_table_command_deadline_elapsed_failed"
          : "browser_process_lineage_table_command_failed",
        () => {
          throw error;
        },
      );
    }
    throw new Error("chrome_process_tree_observation_failed");
  }
  let processes;
  try {
    processes = JSON.parse(stdout.trim());
  } catch (error) {
    if (classifyLineageFailures) {
      await executeB1BrowserStage(
        "browser_process_lineage_table_json_failed",
        () => {
          throw error;
        },
      );
    }
    throw new Error("chrome_process_tree_observation_failed");
  }
  try {
    return validateWindowsProcessTable(
      processes,
      "chrome_process_tree_observation",
    );
  } catch (error) {
    if (classifyLineageFailures) {
      await executeB1BrowserStage(
        "browser_process_lineage_table_validation_failed",
        () => {
          throw error;
        },
      );
    }
    throw new Error("chrome_process_tree_observation_failed");
  }
}

async function terminateChromeProcessTree(child) {
  await executeB1BrowserStage("browser_process_identity_failed", () => {
    if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
      throw new Error("chrome_process_identity_unavailable");
    }
  });
  if (process.platform === "win32") {
    const initialProcesses = await executeB1BrowserStage(
      "browser_process_table_observation_failed",
      () => readWindowsProcessTable(),
    );
    const rootObservedBeforeTermination = initialProcesses.some(
      (candidate) => candidate.processId === child.pid,
    );
    const rootRunningBeforeTermination = child.exitCode === null;
    await executeB1BrowserStage(
      "browser_process_pretermination_state_failed",
      () => {
        if (!rootRunningBeforeTermination || !rootObservedBeforeTermination) {
          throw new Error("chrome_process_tree_termination_failed");
        }
      },
    );
    const nativeTerminationOutcome = await executeB1BrowserStage(
      "browser_process_native_termination_failed",
      async () => {
        try {
          await execFile(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            {
              windowsHide: true,
              timeout: 10_000,
            },
          );
          return "exit_zero";
        } catch (error) {
          return readCompletedWindowsTerminationOutcome(error);
        }
      },
    );
    const closureDeadlineEpochMs = Date.now() + 5_000;
    const { parentExited, survivors } = await observeWindowsChromeClosure({
      child,
      initialProcesses,
      closureDeadlineEpochMs,
    });
    await executeB1BrowserStage(
      "browser_process_termination_validation_failed",
      () =>
        validateWindowsChromeTerminationEvidence({
          nativeTerminationCompleted: true,
          nativeTerminationOutcome,
          rootObservedBeforeTermination,
          rootRunningBeforeTermination,
          parentExited,
          survivingProcessIds: survivors,
        }),
    );
    return;
  }
  await executeB1BrowserStage(
    "browser_process_native_termination_failed",
    () => {
      if (child.exitCode === null && !child.kill("SIGKILL")) {
        throw new Error("chrome_process_tree_termination_failed");
      }
    },
  );
  const parentExited = await waitForProcessExit(child);
  await executeB1BrowserStage("browser_process_parent_exit_failed", () => {
    if (!parentExited) {
      throw new Error("chrome_process_exit_timeout");
    }
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const result = await runBrowserSmoke({
    chromePath: process.env.GATE_014_B1_CHROME_PATH,
    cftMetadataPath: process.env.GATE_014_B1_CFT_METADATA_PATH,
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
