import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  B1_HARNESS_EXTENSION_ID,
  B1_LIFECYCLE_EVALUATION_TIMEOUT_MS,
  buildChromeArguments,
  combineBrowserExecutionObservations,
  createB1TemporaryProfile,
  findProductionServiceWorkerSession,
  removeB1TemporaryProfile,
  selectProductionServiceWorkerTarget,
  validateBrowserExecutionObservation,
  validateChromeForTestingMetadata,
  validateLoadedExtensionInventory,
  validateOfficialCftStableMetadata,
  validateSmokeResult,
  waitForProcessExit,
} from "../scripts/gate-014-b1-browser-runner.mjs";
import {
  assertFixtureRecordFitsCandidate,
  shouldFlushFixtureBatch,
} from "./fixtures/gate-014/b1-extension/storage-harness.js";
import { restorePreflightAllows } from "./fixtures/gate-014/b1-extension/restore-preflight.js";

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

test("GATE-014-B1 Chrome arguments isolate a fresh profile and block external name resolution", () => {
  const argumentsList = buildChromeArguments({
    profileDirectory: path.resolve("temporary-profile"),
    productionExtension: path.resolve("dist"),
    harnessExtension: path.resolve("tests/fixtures/gate-014/b1-extension"),
  });

  assert.equal(argumentsList.includes("--headless=new"), true);
  assert.equal(
    argumentsList.some((argument) => argument.startsWith("--user-data-dir=")),
    true,
  );
  assert.equal(argumentsList.includes("--disable-background-networking"), true);
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

test("GATE-014-B1 browser observation fails closed on external requests or console errors", () => {
  const passing = {
    contract: "gate-014-b1-browser-observation-v1",
    browserLaunchCount: 1,
    observationScope: "all_loaded_extension_targets_after_devtools_attach",
    preAttachEventsObserved: false,
    observedTargetCount: 2,
    productionExtensionTargetCount: 1,
    harnessExtensionTargetCount: 1,
    networkMetricAvailable: true,
    networkRequestCount: 3,
    loopbackRequestCount: 1,
    extensionRequestCount: 1,
    externalRequestAttemptCount: 1,
    externalResponseCount: 0,
    consoleMetricAvailable: true,
    consoleErrorCount: 0,
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
