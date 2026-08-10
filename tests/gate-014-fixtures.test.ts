import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SEED,
  FIXTURE_DEFINITIONS,
  GENERATED_FIXTURE_RELATIVE_DIR,
  GENERATOR_VERSION,
  MALFORMED_CANDIDATE_SUITE,
  MIB,
  cleanupGeneratedFixtureArtifacts,
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
  createPersistedIndexSizeReceipt,
  createRestartReceipt,
  createTimingReceipt,
  createCleanupReadbackReceipt,
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
    assert.equal(receipt.distributionProfile.segmentLengthBytes.accumulator, "bounded_histogram_v1");
    assert.equal(receipt.distributionProfile.canonicalSegmentRecordBytes.accumulator, "bounded_histogram_v1");
    assert.equal(receipt.distributionProfile.overlap.overlapSeconds.accumulator, "bounded_histogram_v1");
    assert.equal(receipt.syntheticEdgeCaseProfile.futureLocalTranscriptRows.claimsAsrCapability, false);
    assert.equal(
      receipt.syntheticEdgeCaseProfile.futureLocalTranscriptRows.status,
      "synthetic_schema_load_only",
    );
    assert.equal(
      receipt.syntheticEdgeCaseProfile.sourceTypes.bilibili_subtitle
        + receipt.syntheticEdgeCaseProfile.sourceTypes.local_transcript,
      receipt.canonical.versionCount,
    );
    assert.equal(receipt.malformedRowExclusions.total, MALFORMED_CANDIDATE_SUITE.length);
    assert.equal(receipt.malformedRowExclusions.emittedCanonicalBytes, 0);
    assert.equal(receipt.malformedRowExclusions.byReason.empty_text, 1);
    assert.equal(receipt.malformedRowExclusions.byReason.invalid_timing, 2);
    assert.equal(receipt.malformedRowExclusions.byReason.non_finite_timing, 1);
    assert.equal(receipt.malformedRowExclusions.byReason.negative_zero, 1);
    assert.equal(receipt.malformedRowExclusions.byReason.lone_surrogate, 1);
    assert.equal(receipt.malformedRowExclusions.byReason.invalid_identity, 2);
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
        "createPersistedIndexSizeReceipt",
        "createRestartReceipt",
        "createFailureInjectionReceipt",
        "createCleanupReadbackReceipt",
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
    reasonCode: "browser_metric_unavailable",
  });
  const indexedDb = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
  });
  const persistedIndex = createPersistedIndexSizeReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "indexing_sources",
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
  });
  const restart = createRestartReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "mv3-worker-restart",
    attempted: false,
    reasonCode: "browser_gate_not_run",
  });
  const failure = createFailureInjectionReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "transaction-abort",
    injectionPoint: "after-metadata-before-segments",
    attempted: false,
    reasonCode: "storage_candidate_not_selected",
  });

  assert.equal(timing.status, "pass");
  assert.equal(timing.durationMs, 240);
  for (const receipt of [memory, indexedDb, persistedIndex, restart, failure]) {
    assert.equal(receipt.status, INSUFFICIENT_EVIDENCE);
    assert.equal(receipt.storesSensitiveText, false);
    assert.ok(typeof receipt.reasonCode === "string");
    assert.doesNotMatch(JSON.stringify(receipt), RAW_RUNTIME_DETAIL_PATTERN);
    assert.doesNotMatch(JSON.stringify(receipt), SENSITIVE_RECEIPT_TOKEN_PATTERN);
  }
});

test("GATE-014-A reusable receipt helpers reject false-pass values and arbitrary text", () => {
  assert.throws(() => createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: "true",
    heapUsedBytes: 1,
    heapTotalBytes: 1,
    rssBytes: 1,
    peakHeapGrowthBytes: 1,
  }), /metricAvailable must be a boolean/);

  assert.throws(() => createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    heapUsedBytes: 1,
    heapTotalBytes: 1,
    rssBytes: 1,
  }), /peakHeapGrowthBytes/);

  assert.throws(() => createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    storageEstimateUsageBytes: 1,
    storageEstimateQuotaBytes: 1,
  }), /indexedDbDeltaBytes/);

  assert.throws(() => createPersistedIndexSizeReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "indexing_sources",
    metricAvailable: true,
    managedSourceBytes: 100,
  }), /persistedIndexBytes/);

  assert.throws(() => createRestartReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "mv3-worker-restart",
    attempted: true,
    completed: true,
    preRestartCheckpoint: {
      checkpointId: "batch-1",
      phase: "indexing_sources",
      batchOrdinal: 1,
      recordCount: 10,
      canonicalBytes: 100,
      operationOpen: true,
    },
  }), /postRestartCheckpoint/);

  assert.throws(() => createFailureInjectionReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "transaction-abort",
    injectionPoint: "after-metadata-before-segments",
    attempted: true,
    completed: true,
    cleanupRequired: true,
  }), /visibleRowsAfterFailure/);

  assert.throws(() => createMemoryReceipt({
    fixtureId: "../profile",
    phase: "admission",
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
  }), /fixtureId must be a public-safe id/);

  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry run",
    startedAtEpochMs: 1,
    endedAtEpochMs: 2,
  }), /operation must be a public-safe id/);

  assert.throws(() => createRestartReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "mv3-worker-restart",
    attempted: true,
    completed: true,
    preRestartCheckpoint: {
      checkpointId: "batch-1",
      phase: "indexing_sources",
      batchOrdinal: 1,
      recordCount: 10,
      canonicalBytes: 100,
      operationOpen: true,
      rawError: "disk path detail",
    },
    postRestartCheckpoint: {
      checkpointId: "batch-1",
      phase: "verifying_generation",
      batchOrdinal: 1,
      recordCount: 10,
      canonicalBytes: 100,
      operationOpen: true,
    },
  }), /unsupported checkpoint field/);

  assert.throws(() => createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: false,
    reasonCode: "Chrome failed with raw text",
  }), /reasonCode must use a closed reason code/);
});

test("GATE-014-A helper receipts pass only with concrete required measurements", () => {
  const memory = createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    heapUsedBytes: 10,
    heapTotalBytes: 20,
    rssBytes: 30,
    peakHeapGrowthBytes: 5,
  });
  const indexedDb = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    storageEstimateUsageBytes: 40,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: 30,
  });
  const persistedIndex = createPersistedIndexSizeReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "verifying_generation",
    metricAvailable: true,
    managedSourceBytes: 100,
    persistedIndexBytes: 80,
  });
  const restart = createRestartReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "mv3-worker-restart",
    attempted: true,
    completed: true,
    preRestartCheckpoint: {
      checkpointId: "batch-1",
      phase: "indexing_sources",
      batchOrdinal: 1,
      recordCount: 10,
      canonicalBytes: 100,
      operationOpen: true,
    },
    postRestartCheckpoint: {
      checkpointId: "batch-1",
      phase: "verifying_generation",
      batchOrdinal: 1,
      recordCount: 10,
      canonicalBytes: 100,
      operationOpen: true,
    },
  });
  const failure = createFailureInjectionReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "transaction-abort",
    injectionPoint: "after-metadata-before-segments",
    attempted: true,
    completed: true,
    visibleRowsAfterFailure: 0,
    cleanupRequired: true,
    readbackVerified: true,
  });
  const cleanup = createCleanupReadbackReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "cleanup-generated-artifacts",
    beforeFileCount: 2,
    removedFileCount: 2,
    afterFileCount: 0,
    tempFileCountAfterCleanup: 0,
    finalFileCountAfterCleanup: 0,
    readbackVerified: true,
  });

  for (const receipt of [memory, indexedDb, persistedIndex, restart, failure, cleanup]) {
    assert.equal(receipt.status, "pass");
    assert.equal(receipt.storesSensitiveText, false);
    assert.doesNotMatch(JSON.stringify(receipt), SENSITIVE_RECEIPT_TOKEN_PATTERN);
  }
  assert.equal(persistedIndex.indexToSourceRatioPermille, 800);
});

test("GATE-014-A artifact writer is failure-atomic and leaves no temp artifact", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-managed-full-text-atomic",
    description: "Small atomic-write fixture.",
    targetCanonicalBytes: 192 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gate-014-fixture-atomic-"));

  try {
    const success = await writeFixtureArtifact(definition, {
      seed: "artifact-seed",
      outputDirectory: tempRoot,
    });
    const originalBytes = await readFile(success.artifactPath);

    await assert.rejects(() => writeFixtureArtifact(definition, {
      seed: "artifact-seed-v2",
      outputDirectory: tempRoot,
      injectFailureAt: "after-first-record",
    }), /Injected GATE-014 artifact failure/);

    assert.deepEqual(await readFile(success.artifactPath), originalBytes);
    assert.deepEqual((await readdir(tempRoot)).filter(name => name.endsWith(".tmp")), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A generated artifact cleanup removes only known final and temp names", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gate-014-cleanup-"));

  try {
    await writeFile(path.join(tempRoot, "managed-full-text-100mib.jsonl"), "generated\n", "utf8");
    await writeFile(path.join(tempRoot, ".managed-full-text-100mib.injected.tmp"), "partial\n", "utf8");
    await writeFile(path.join(tempRoot, "unrelated-user-file.jsonl"), "keep\n", "utf8");

    const receipt = await cleanupGeneratedFixtureArtifacts({
      outputDirectory: tempRoot,
      allowCustomOutputDirectoryForTests: true,
    });

    assert.equal(receipt.status, "pass");
    assert.equal(receipt.beforeFileCount, 2);
    assert.equal(receipt.removedFileCount, 2);
    assert.equal(receipt.afterFileCount, 0);
    assert.deepEqual(await readdir(tempRoot), ["unrelated-user-file.jsonl"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A cleanup rejects unsafe targets", async () => {
  await assert.rejects(() => cleanupGeneratedFixtureArtifacts({
    outputDirectory: path.parse(process.cwd()).root,
    allowCustomOutputDirectoryForTests: true,
  }), /Refusing to clean unsafe GATE-014 fixture directory/);
});
