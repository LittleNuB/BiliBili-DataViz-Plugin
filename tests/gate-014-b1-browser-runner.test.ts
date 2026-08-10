import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  B1_HARNESS_EXTENSION_ID,
  B1_LIFECYCLE_EVALUATION_TIMEOUT_MS,
  buildChromeArguments,
  createB1TemporaryProfile,
  removeB1TemporaryProfile,
  validateSmokeResult,
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
  assert.equal(
    argumentsList.includes(
      "--host-resolver-rules=MAP * 0.0.0.0,EXCLUDE 127.0.0.1",
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
