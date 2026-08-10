import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SEED,
  FIXTURE_DEFINITIONS,
  GENERATED_FIXTURE_RELATIVE_DIR,
  GENERATOR_VERSION,
  MIB,
  createCustomFixtureDefinition,
  createFixtureReceipt,
  writeFixtureArtifact,
} from "../scripts/gate-014-fixture-generator.mjs";
import {
  INSUFFICIENT_EVIDENCE,
  SENSITIVE_RECEIPT_TOKEN_PATTERN,
  createFailureInjectionReceipt,
  createIndexedDbUsageReceipt,
  createMemoryReceipt,
  createRestartReceipt,
  createTimingReceipt,
} from "../scripts/gate-014-receipt-helpers.mjs";

const RAW_RUNTIME_DETAIL_PATTERN = new RegExp([
  ['raw', '\\s+', 'error'].join(''),
  ['st', 'ack'].join(''),
].join("|"), "i");

test("GATE-014-A generator produces exact deterministic canonical bytes for a bounded sample", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-managed-full-text-384kib",
    description: "Small deterministic test seam for the public fixture generator.",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });

  const first = await createFixtureReceipt(definition, { seed: "unit-seed" });
  const second = await createFixtureReceipt(definition, { seed: "unit-seed" });

  assert.equal(first.generatorVersion, GENERATOR_VERSION);
  assert.equal(first.seed, "unit-seed");
  assert.equal(first.canonical.totalBytes, definition.targetCanonicalBytes);
  assert.equal(first.canonical.totalBytes, second.canonical.totalBytes);
  assert.equal(first.canonical.fixtureSha256, second.canonical.fixtureSha256);
  assert.equal(first.canonical.bodyManifestSha256, second.canonical.bodyManifestSha256);
  assert.equal(first.canonical.versionManifestSha256, second.canonical.versionManifestSha256);
  assert.deepEqual(first.plantedRetrievalTargets, second.plantedRetrievalTargets);
  assert.equal(
    first.distributionProfile.realBilibiliSubtitleRepresentativeness.status,
    INSUFFICIENT_EVIDENCE,
  );
});

test("GATE-014-A artifact writer emits bytes matching the receipt without using repo-local large output", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-managed-full-text-artifact",
    description: "Small artifact write smoke for the public fixture generator.",
    targetCanonicalBytes: 192 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gate-014-fixture-"));

  try {
    const result = await writeFixtureArtifact(definition, {
      seed: "artifact-seed",
      outputDirectory: tempRoot,
    });
    const file = await stat(result.artifactPath);

    assert.equal(file.size, definition.targetCanonicalBytes);
    assert.equal(result.receipt.canonical.totalBytes, definition.targetCanonicalBytes);
    assert.equal(result.receipt.canonical.fixtureSha256, result.artifactSha256);
    assert.equal(result.receipt.generatedArtifactCommitted, false);
    assert.equal(
      result.receipt.generatedArtifactRelativePath,
      `${GENERATED_FIXTURE_RELATIVE_DIR}/${definition.id}.jsonl`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("committed GATE-014-A golden receipts cover every required large fixture without committing data", async () => {
  const expectedTargets = new Map([
    ["managed-full-text-100mib", 100 * MIB],
    ["managed-full-text-400mib", 400 * MIB],
    ["managed-full-text-500mib", 500 * MIB],
    ["single-version-64mib", 64 * MIB],
    ["high-fragmentation-pathological", 16 * MIB],
  ]);

  assert.deepEqual(
    FIXTURE_DEFINITIONS.map(definition => definition.id),
    [...expectedTargets.keys()],
  );

  for (const [fixtureId, targetBytes] of expectedTargets) {
    const receipt = JSON.parse(
      await readFile(
        new URL(`./fixtures/gate-014/receipts/${fixtureId}.receipt.json`, import.meta.url),
        "utf8",
      ),
    );
    const raw = JSON.stringify(receipt);

    assert.equal(receipt.receiptContract, "gate-014-fixture-receipt-v1");
    assert.equal(receipt.generatorVersion, GENERATOR_VERSION);
    assert.equal(receipt.seed, DEFAULT_SEED);
    assert.equal(receipt.fixture.id, fixtureId);
    assert.equal(receipt.fixture.targetCanonicalBytes, targetBytes);
    assert.equal(receipt.canonical.totalBytes, targetBytes);
    assert.match(receipt.canonical.fixtureSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.canonical.bodyManifestSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.canonical.timelineManifestSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.canonical.versionManifestSha256, /^[0-9a-f]{64}$/);
    assert.ok(receipt.canonical.versionCount >= 1);
    assert.ok(receipt.canonical.segmentCount >= receipt.canonical.versionCount);
    assert.equal(receipt.generatedArtifactCommitted, false);
    assert.equal(
      receipt.generatedArtifactRelativePath,
      `${GENERATED_FIXTURE_RELATIVE_DIR}/${fixtureId}.jsonl`,
    );
    assert.equal(receipt.releasePackagingExcluded, true);
    assert.equal(
      receipt.distributionProfile.realBilibiliSubtitleRepresentativeness.status,
      INSUFFICIENT_EVIDENCE,
    );
    assert.equal(receipt.malformedRowExclusions.total, 0);
    assert.equal(receipt.querySuiteSummary.total, 145);
    assert.deepEqual(receipt.querySuiteSummary.byKind, {
      chinese_exact: 50,
      chinese_multi_term: 25,
      mixed_cjk_latin: 20,
      english: 20,
      punctuation_number: 10,
      common_term_distractor: 20,
    });
    assert.equal(receipt.plantedRetrievalTargetSummary.total, 125);
    assert.deepEqual(receipt.plantedRetrievalTargetSummary.byKind, {
      chinese_exact: 50,
      chinese_multi_term: 25,
      mixed_cjk_latin: 20,
      english: 20,
      punctuation_number: 10,
    });
    assert.equal(receipt.plantedRetrievalTargets.length, 125);
    assert.equal(receipt.commonTermDistractorQueries.length, 20);
    assert.ok(receipt.distributionProfile.segmentLengthBytes.percentiles.p50 > 0);
    assert.ok(receipt.distributionProfile.segmentsPerVersion.percentiles.p50 >= 1);
    assert.ok(receipt.distributionProfile.characterMix.cjk.proportion > 0);
    assert.ok(receipt.distributionProfile.characterMix.latin.proportion > 0);
    assert.ok(receipt.syntheticEdgeCaseProfile.versionStates.current >= 1);
    assert.ok(receipt.syntheticEdgeCaseProfile.languages["zh-cn"] >= 1);
    assert.equal(receipt.syntheticEdgeCaseProfile.unicodeCoverage.loneSurrogateExcluded, true);
    if (fixtureId !== "single-version-64mib") {
      assert.ok(receipt.syntheticEdgeCaseProfile.multiPartVideoCount >= 1);
      assert.ok(receipt.syntheticEdgeCaseProfile.duplicateSourceScopePairs >= 1);
      assert.ok(receipt.syntheticEdgeCaseProfile.changedTimelineDuplicateSourcePairs >= 1);
    }
    assert.deepEqual(
      receipt.reusableReceiptHelpers.map((helper: { helper: string }) => helper.helper),
      [
        "createTimingReceipt",
        "createMemoryReceipt",
        "createIndexedDbUsageReceipt",
        "createRestartReceipt",
        "createFailureInjectionReceipt",
      ],
    );
    assert.doesNotMatch(
      raw,
      SENSITIVE_RECEIPT_TOKEN_PATTERN,
    );
  }
});

test("large generated fixture outputs are ignored and outside release packaging inputs", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const packager = await readFile(new URL("../scripts/package-release.ps1", import.meta.url), "utf8");

  assert.match(gitignore, /\/tests\/fixtures\/gate-014\/generated\//);
  assert.equal(GENERATED_FIXTURE_RELATIVE_DIR, "tests/fixtures/gate-014/generated");
  assert.match(packager, /\$distRoot/);
  assert.doesNotMatch(packager, /tests[\\/]fixtures[\\/]gate-014[\\/]generated/);
});

test("GATE-014-A reusable receipt helpers fail closed when browser metrics are unavailable", () => {
  const timing = createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    startedAtEpochMs: 1000,
    endedAtEpochMs: 1240,
    sampleCount: 1,
  });
  const memory = createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "dry-run-generation",
    metricAvailable: false,
    unavailableReason: "Chrome JS heap metric was not measured by this Node-only receipt.",
  });
  const indexedDb = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: false,
    unavailableReason: "IndexedDB usage requires a browser gate run.",
  });
  const restart = createRestartReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "mv3-worker-restart",
    attempted: false,
    unavailableReason: "Restart behavior requires a browser gate run.",
  });
  const failure = createFailureInjectionReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "transaction-abort",
    injectionPoint: "after-metadata-before-segments",
    attempted: false,
    unavailableReason: "Failure injection requires the storage candidate selected by later gates.",
  });

  assert.equal(timing.status, "pass");
  assert.equal(timing.durationMs, 240);
  for (const receipt of [memory, indexedDb, restart, failure]) {
    assert.equal(receipt.status, INSUFFICIENT_EVIDENCE);
    assert.equal(receipt.storesSensitiveText, false);
    assert.doesNotMatch(JSON.stringify(receipt), RAW_RUNTIME_DETAIL_PATTERN);
    assert.doesNotMatch(JSON.stringify(receipt), SENSITIVE_RECEIPT_TOKEN_PATTERN);
  }
});
