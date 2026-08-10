import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SEED,
  FIXTURE_DEFINITIONS,
  GENERATED_FIXTURE_RELATIVE_DIR,
  GENERATOR_VERSION,
  GOLDEN_RECEIPT_RELATIVE_DIR,
  MALFORMED_CANDIDATE_SUITE,
  MIB,
  RECEIPT_CONTRACT,
  cleanupGeneratedFixtureArtifacts,
  createCustomFixtureDefinition,
  createFixtureReceipt,
  validateManagedFullTextCandidate,
  verifyGoldenFixtureReceipt,
  writeFixtureArtifact,
  writeGoldenFixtureReceipt,
} from "../scripts/gate-014-fixture-generator.mjs";
import {
  GATE_014_RECEIPT_HELPER_CONTRACT,
  INDEXED_DB_EXPECTED_DIRECTIONS,
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

const EXPECTED_GOLDEN_REGRESSION = {
  "managed-full-text-100mib": {
    totalBytes: 104857600,
    fixtureSha256: "563d407a09a5203e5e8fed4606f2a189da52e641e874daf84c3016d0424a08da",
    bodyManifestSha256: "d74c8197c1a08d34066065bfb1a17b5dd93f59c0af3bff0d077e228880d8e882",
    timelineManifestSha256: "97e051f402c97d4dc6fac7f70049ac9dd5cb783dcc97d0bdd4c73c83a922f2ed",
    versionManifestSha256: "cfee18fcbc8173683e6d393631bd5cca365d881f01699a35d53cc8c70bc1d70c",
    querySuiteSha256: "d780fe6c48a5ff29c40d9ceeefd5e46d6a0b82777561b6cead632f2145b83ab3",
    versionCount: 132,
    segmentCount: 76352,
    recordCount: 76484,
  },
  "managed-full-text-400mib": {
    totalBytes: 419430400,
    fixtureSha256: "4483a915d032375d655897b52d3dbf3b696e4218ae040f4da46601c5c7709ed4",
    bodyManifestSha256: "c347063e777cb287786e9035f8d1277d9801b189edd4643879748410911bea45",
    timelineManifestSha256: "26068839e1fd47177bdf2f01679e86160a9361daaf0b9dd91665f100e939f923",
    versionManifestSha256: "bedb694a14286c254101420d042010275fa3cbc162941efe8552860695fe52da",
    querySuiteSha256: "6b16a0d046fceb6ed847ca37ed2847e3387f655e5aa07b94f749d2c8a867401a",
    versionCount: 534,
    segmentCount: 305402,
    recordCount: 305936,
  },
  "managed-full-text-500mib": {
    totalBytes: 524288000,
    fixtureSha256: "0bfad1762617af97ab58cd4df072a94e77d9b6b94e7d296b8c285e77edba743a",
    bodyManifestSha256: "a02b10c30c3004a67240c8270f94e8bd163831041d3f33312959c62dc47cb2aa",
    timelineManifestSha256: "a35ab00a020953e962881676726b559adf1374102768aaa70f22de61fb085230",
    versionManifestSha256: "0f75a295a064621aa9ccd4442ee87ffe04fdabc85ce1acd5033c1caca8dab1b2",
    querySuiteSha256: "8819d38eaf65b55b9ba5403d355f007d5bb529538d96553ca873b5a4cf71442a",
    versionCount: 667,
    segmentCount: 381415,
    recordCount: 382082,
  },
  "single-version-64mib": {
    totalBytes: 67108864,
    fixtureSha256: "158cdad82896df70e66fc7e7d94fd318fe8b7d6f9139a88eaea03b0e6e54b249",
    bodyManifestSha256: "6375d934a2e08074abe0c92f511ee6c13e92070a853e084e32a0b980a9114663",
    timelineManifestSha256: "91284680a7ae6fc98ed4dc75513cc266b591e278b1a1077c3e92adc23c109617",
    versionManifestSha256: "6127c065639dcb4fd94e70413a1d6d8219744d09236a15f692a8d0ff1a79533c",
    querySuiteSha256: "acbedb94a49ebd3ebcf48ece589a6da2c2ed3d3a7e6e890dc27e5108ae5b878c",
    versionCount: 1,
    segmentCount: 38746,
    recordCount: 38747,
  },
  "high-fragmentation-pathological": {
    totalBytes: 16777216,
    fixtureSha256: "ededecbc4ef07e405830b63107806469d5812e4cb8605e853c7e0304d8376c47",
    bodyManifestSha256: "14d4931450a9d7d6e25d1fba747d89bb7f6d3863b3f6e9f1dd483d397675e03c",
    timelineManifestSha256: "810a8666598aeeec14ccf835f3505c9d63a64a76f84fd0eb9bb5a9398615313b",
    versionManifestSha256: "0a1fa67818cc5b33a9d8eca2ff35689bd54be961bbaca5934a4c43a170c42462",
    querySuiteSha256: "44c8148bfc9a1e0b4fba400b748e54f73ef2c095009e2fdc7bb31a463bcfeae7",
    versionCount: 63,
    segmentCount: 90840,
    recordCount: 90903,
  },
};

async function createFakeRepositoryRoot(prefix) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  await writeFile(
    path.join(repositoryRoot, "package.json"),
    `${JSON.stringify({ name: "bili-bill", private: true })}\n`,
    "utf8",
  );
  return repositoryRoot;
}

test("GATE-014-A1 generator produces exact deterministic canonical bytes for a bounded sample", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-managed-full-text-384kib",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });

  const first = await createFixtureReceipt(definition, { seed: "unit-seed" });
  const second = await createFixtureReceipt(definition, { seed: "unit-seed" });

  assert.equal(first.generatorVersion, GENERATOR_VERSION);
  assert.equal(GENERATOR_VERSION, "gate-014-fixture-generator-v5");
  assert.equal(RECEIPT_CONTRACT, "gate-014-fixture-receipt-v5");
  assert.equal(GATE_014_RECEIPT_HELPER_CONTRACT, "gate-014-receipt-helper-v5");
  assert.deepEqual(INDEXED_DB_EXPECTED_DIRECTIONS, ["increase", "decrease"]);
  assert.equal(Object.isFrozen(INDEXED_DB_EXPECTED_DIRECTIONS), true);
  assert.equal(first.seed, "unit-seed");
  assert.equal(first.canonical.totalBytes, definition.targetCanonicalBytes);
  assert.equal(first.canonical.totalBytes, second.canonical.totalBytes);
  assert.equal(first.canonical.fixtureSha256, second.canonical.fixtureSha256);
  assert.equal(first.canonical.bodyManifestSha256, second.canonical.bodyManifestSha256);
  assert.equal(first.canonical.versionManifestSha256, second.canonical.versionManifestSha256);
  assert.deepEqual(first.plantedRetrievalTargets, second.plantedRetrievalTargets);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.canonical), true);
  assert.equal(Object.isFrozen(first.plantedRetrievalTargets), true);
  assert.equal(Object.isFrozen(first.reusableReceiptHelpers[0].requiredFields), true);
  assert.equal(
    first.distributionProfile.realBilibiliSubtitleRepresentativeness.status,
    INSUFFICIENT_EVIDENCE,
  );
  assert.equal(
    first.distributionProfile.maximumMeasuredSegmentCountTail.status,
    INSUFFICIENT_EVIDENCE,
  );
});

test("GATE-014-A1 artifact writer emits bytes matching the receipt without using repo-local large output", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-managed-full-text-artifact",
    targetCanonicalBytes: 192 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-fixture-repo-");

  try {
    const result = await writeFixtureArtifact(definition, {
      seed: "artifact-seed",
      repositoryRoot,
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
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("committed GATE-014-A1 golden receipts cover every required large fixture without committing data", async () => {
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

    assert.equal(receipt.receiptContract, RECEIPT_CONTRACT);
    assert.equal(receipt.generatorVersion, GENERATOR_VERSION);
    assert.equal(receipt.seed, DEFAULT_SEED);
    assert.equal(receipt.fixture.id, fixtureId);
    assert.equal(receipt.fixture.targetCanonicalBytes, targetBytes);
    assert.equal(receipt.canonical.totalBytes, targetBytes);
    assert.deepEqual(
      {
        totalBytes: receipt.canonical.totalBytes,
        fixtureSha256: receipt.canonical.fixtureSha256,
        bodyManifestSha256: receipt.canonical.bodyManifestSha256,
        timelineManifestSha256: receipt.canonical.timelineManifestSha256,
        versionManifestSha256: receipt.canonical.versionManifestSha256,
        querySuiteSha256: receipt.canonical.querySuiteSha256,
        versionCount: receipt.canonical.versionCount,
        segmentCount: receipt.canonical.segmentCount,
        recordCount: receipt.canonical.recordCount,
      },
      EXPECTED_GOLDEN_REGRESSION[fixtureId],
    );
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
    assert.equal(
      receipt.distributionProfile.maximumMeasuredSegmentCountTail.status,
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
    assert.equal(receipt.malformedRowExclusions.actualRejectedCount, MALFORMED_CANDIDATE_SUITE.length);
    assert.equal(receipt.malformedRowExclusions.candidateCount, MALFORMED_CANDIDATE_SUITE.length);
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
    assert.deepEqual(
      receipt.reusableReceiptHelpers.find(
        (helper: { helper: string }) => helper.helper === "createTimingReceipt",
      ).requiredFields,
      [
        "fixtureId",
        "operation",
        "metricAvailable",
        "startedAtEpochMs",
        "endedAtEpochMs",
        "durationMs",
        "sampleCount",
      ],
    );
    assert.doesNotMatch(
      raw,
      SENSITIVE_RECEIPT_TOKEN_PATTERN,
    );
  }
});

test("GATE-014-A1 generator can be imported when process.argv[1] is undefined", () => {
  const moduleUrl = new URL("../scripts/gate-014-fixture-generator.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `process.argv[1] = undefined; await import(${JSON.stringify(moduleUrl)});`,
  ], { encoding: "utf8" });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("GATE-014-A1 golden receipt verification recomputes deeply without writing", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-read-only-verify",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-read-only-verify-");
  const seed = "verify-seed";

  try {
    const written = await writeGoldenFixtureReceipt(definition, { repositoryRoot, seed });
    const receiptDirectory = path.join(repositoryRoot, GOLDEN_RECEIPT_RELATIVE_DIR);
    const generatedDirectory = path.join(repositoryRoot, GENERATED_FIXTURE_RELATIVE_DIR);
    const originalBytes = await readFile(written.receiptPath);
    const originalReceipt = JSON.parse(originalBytes.toString("utf8"));
    const originalEntries = await readdir(receiptDirectory);

    const verified = await verifyGoldenFixtureReceipt(definition, { repositoryRoot, seed });
    assert.equal(verified.status, "pass");
    assert.equal(verified.fixtureId, definition.id);
    assert.equal(verified.canonicalBytes, definition.targetCanonicalBytes);
    assert.deepEqual(await readFile(written.receiptPath), originalBytes);
    assert.deepEqual(await readdir(receiptDirectory), originalEntries);
    await assert.rejects(() => stat(generatedDirectory), { code: "ENOENT" });

    const mismatches = [
      (receipt: any) => { receipt.fixture.description = "controlled mismatch"; },
      (receipt: any) => { receipt.fixture.targetKind = "single_version_full_text"; },
      (receipt: any) => { receipt.canonical.totalBytes += 1; },
      (receipt: any) => { receipt.canonical.fixtureSha256 = "0".repeat(64); },
      (receipt: any) => { receipt.canonical.recordCount += 1; },
      (receipt: any) => { receipt.plantedRetrievalTargets[0].queryId = "mutated-query"; },
    ];

    for (const mutate of mismatches) {
      const mismatchedReceipt = structuredClone(originalReceipt);
      mutate(mismatchedReceipt);
      const mismatchedBytes = Buffer.from(`${JSON.stringify(mismatchedReceipt, null, 2)}\n`);
      await writeFile(written.receiptPath, mismatchedBytes);

      await assert.rejects(
        () => verifyGoldenFixtureReceipt(definition, { repositoryRoot, seed }),
        /Golden receipt verification mismatch/,
      );
      assert.deepEqual(await readFile(written.receiptPath), mismatchedBytes);
      assert.deepEqual(await readdir(receiptDirectory), originalEntries);
      await assert.rejects(() => stat(generatedDirectory), { code: "ENOENT" });

      await writeFile(written.receiptPath, originalBytes);
    }

    const serializationMismatches = [
      JSON.stringify(originalReceipt),
      `${JSON.stringify(originalReceipt, null, 4)}\n`,
      `${JSON.stringify(originalReceipt, null, 2)}\n`.replaceAll("\n", "\r\n"),
      `${JSON.stringify(Object.fromEntries(Object.entries(originalReceipt).reverse()), null, 2)}\n`,
    ];
    for (const mismatchedSerialization of serializationMismatches) {
      const mismatchedBytes = Buffer.from(mismatchedSerialization);
      await writeFile(written.receiptPath, mismatchedBytes);

      await assert.rejects(
        () => verifyGoldenFixtureReceipt(definition, { repositoryRoot, seed }),
        /Golden receipt serialization mismatch/,
      );
      assert.deepEqual(await readFile(written.receiptPath), mismatchedBytes);
      assert.deepEqual(await readdir(receiptDirectory), originalEntries);
      await assert.rejects(() => stat(generatedDirectory), { code: "ENOENT" });

      await writeFile(written.receiptPath, originalBytes);
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A1 golden receipt verification does not create a missing receipt directory", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-read-only-missing-receipt",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-read-only-missing-");
  const receiptDirectory = path.join(repositoryRoot, GOLDEN_RECEIPT_RELATIVE_DIR);

  try {
    await assert.rejects(
      () => verifyGoldenFixtureReceipt(definition, {
        repositoryRoot,
        seed: "verify-missing-seed",
      }),
      /Refusing to verify unsafe GATE-014 golden receipt directory/,
    );
    await assert.rejects(() => stat(receiptDirectory), { code: "ENOENT" });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
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

test("GATE-014-A1 custom definitions use closed inputs and controlled descriptions", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-public-definition",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });

  assert.equal(
    definition.description,
    "Exact 393216-byte synthetic managed-full-text gate fixture unit-public-definition.",
  );
  assert.equal(Object.isFrozen(definition), true);
  assert.throws(() => createCustomFixtureDefinition({
    id: "unit-public-definition",
    description: "arbitrary source wording",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  }), /unsupported field: description/);
  assert.throws(() => createCustomFixtureDefinition({
    id: "unit-public-definition",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "arbitrary_target_kind",
  }), /closed targetKind/);
  assert.throws(() => createCustomFixtureDefinition({
    id: "unit-public-definition",
    targetCanonicalBytes: 384 * 1024,
    profile: "highFragmentation",
    targetKind: "managed_full_text_total",
  }), /does not match profile/);
  assert.throws(() => createCustomFixtureDefinition({
    id: "../profile",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  }), /fixture id/);

  await assert.rejects(() => createFixtureReceipt({
    ...definition,
    description: "mutated source wording",
  }), /fixture definition description/);
  await assert.rejects(() => createFixtureReceipt(definition, {
    seed: "../unsafe-seed",
  }), /seed must be a public-safe id/);
});

test("GATE-014-A1 malformed candidates are executable rejects before canonical serialization", () => {
  const actualReasons = new Map();
  for (const testCase of MALFORMED_CANDIDATE_SUITE) {
    const result = validateManagedFullTextCandidate(testCase.candidate);
    assert.equal(result.accepted, false, testCase.candidateId);
    assert.equal(result.reasonCode, testCase.expectedReasonCode, testCase.candidateId);
    assert.equal(result.canonicalLine, null, testCase.candidateId);
    assert.equal(result.canonicalBytes, 0, testCase.candidateId);
    actualReasons.set(
      result.reasonCode,
      (actualReasons.get(result.reasonCode) ?? 0) + 1,
    );
  }

  assert.deepEqual(Object.fromEntries(actualReasons), {
    empty_text: 1,
    invalid_timing: 2,
    non_finite_timing: 1,
    negative_zero: 1,
    lone_surrogate: 1,
    invalid_identity: 2,
  });
  assert.equal(Object.isFrozen(MALFORMED_CANDIDATE_SUITE), true);
  assert.equal(Object.isFrozen(MALFORMED_CANDIDATE_SUITE[0].candidate), true);

  const validControl = validateManagedFullTextCandidate({
    bvid: "BV014CONTROL1",
    cid: 1400001,
    ordinal: 0,
    startSeconds: 0,
    endSeconds: 1,
    text: "公开安全 control 01",
  });
  assert.equal(validControl.accepted, true);
  assert.equal(validControl.reasonCode, null);
  assert.ok(validControl.canonicalBytes > 0);
  assert.equal(JSON.parse(validControl.canonicalLine).text, "公开安全 control 01");

  assert.throws(() => validateManagedFullTextCandidate({
    bvid: "BV014CONTROL1",
    cid: 1400001,
    ordinal: 0,
    startSeconds: 0,
    endSeconds: 1,
    text: "公开安全 control 01",
    note: "arbitrary source wording",
  }), /unsupported candidate field: note/);
});

test("GATE-014-A1 timing receipts fail closed when the metric is unavailable", () => {
  const available = createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: true,
    startedAtEpochMs: 1000,
    endedAtEpochMs: 1240,
    sampleCount: 1,
  });
  const unavailable = createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
  });

  assert.equal(available.status, "pass");
  assert.equal(available.metricAvailable, true);
  assert.equal(available.durationMs, 240);
  assert.equal(unavailable.status, INSUFFICIENT_EVIDENCE);
  assert.equal(unavailable.metricAvailable, false);
  assert.equal(unavailable.reasonCode, "browser_metric_unavailable");
  assert.equal("startedAtEpochMs" in unavailable, false);
  assert.equal("endedAtEpochMs" in unavailable, false);
  assert.equal("sampleCount" in unavailable, false);
  for (const receipt of [available, unavailable]) {
    assert.equal(receipt.storesSensitiveText, false);
    assert.doesNotMatch(JSON.stringify(receipt), RAW_RUNTIME_DETAIL_PATTERN);
    assert.doesNotMatch(JSON.stringify(receipt), SENSITIVE_RECEIPT_TOKEN_PATTERN);
  }

  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: false,
  }), /reasonCode/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: false,
    reasonCode: "raw-error-detail",
  }), /reasonCode/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: false,
    reasonCode: "arbitrary_reason",
  }), /reasonCode/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
    startedAtEpochMs: 1000,
  }), /must not include timing measurements/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: true,
    endedAtEpochMs: 1240,
  }), /startedAtEpochMs/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: true,
    startedAtEpochMs: 1000,
  }), /endedAtEpochMs/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: true,
    startedAtEpochMs: 1000,
    endedAtEpochMs: 1240,
    reasonCode: "browser_metric_unavailable",
  }), /available timing receipt must not include reasonCode/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: "true",
  }), /metricAvailable must be a boolean/);
  assert.throws(() => createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
    notes: "arbitrary text",
  }), /unsupported field: notes/);
});

test("GATE-014-A1 reusable receipt helpers fail closed when browser metrics are unavailable", () => {
  const timing = createTimingReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "dry-run-generation",
    metricAvailable: false,
    reasonCode: "browser_metric_unavailable",
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

  for (const receipt of [timing, memory, indexedDb, persistedIndex, restart, failure]) {
    assert.equal(receipt.status, INSUFFICIENT_EVIDENCE);
    assert.equal(receipt.storesSensitiveText, false);
    assert.ok(typeof receipt.reasonCode === "string");
    assert.doesNotMatch(JSON.stringify(receipt), RAW_RUNTIME_DETAIL_PATTERN);
    assert.doesNotMatch(JSON.stringify(receipt), SENSITIVE_RECEIPT_TOKEN_PATTERN);
  }
});

test("GATE-014-A1 reusable receipt helpers reject false-pass values and arbitrary text", () => {
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
    storageEstimateUsageBeforeBytes: 0,
    storageEstimateUsageAfterBytes: 1,
    storageEstimateQuotaBytes: 1,
    indexedDbDeltaBytes: 1,
    expectedDirection: "increase",
  }), /readbackVerified/);

  assert.throws(() => createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    storageEstimateUsageBeforeBytes: 0,
    storageEstimateUsageAfterBytes: 1,
    storageEstimateQuotaBytes: 1,
    indexedDbDeltaBytes: 1,
    expectedDirection: "sideways",
    readbackVerified: true,
  }), /expectedDirection/);

  assert.throws(() => createPersistedIndexSizeReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "indexing_sources",
    metricAvailable: true,
    managedSourceBytes: 100,
  }), /persistedIndexBytes/);

  const contradictoryUnavailableReceipts = [
    {
      create: () => createMemoryReceipt({
        fixtureId: "managed-full-text-100mib",
        phase: "admission",
        metricAvailable: false,
        reasonCode: "browser_metric_unavailable",
        heapUsedBytes: 1,
      }),
      error: /unavailable memory receipt must not include memory measurements/,
    },
    {
      create: () => createIndexedDbUsageReceipt({
        fixtureId: "managed-full-text-100mib",
        phase: "admission",
        metricAvailable: false,
        reasonCode: "browser_metric_unavailable",
        storageEstimateUsageBeforeBytes: 1,
      }),
      error: /unavailable IndexedDB receipt must not include storage measurements/,
    },
    {
      create: () => createPersistedIndexSizeReceipt({
        fixtureId: "managed-full-text-100mib",
        phase: "indexing_sources",
        metricAvailable: false,
        reasonCode: "browser_metric_unavailable",
        managedSourceBytes: 1,
      }),
      error: /unavailable persisted-index receipt must not include index measurements/,
    },
    {
      create: () => createRestartReceipt({
        fixtureId: "managed-full-text-100mib",
        scenario: "mv3-worker-restart",
        attempted: false,
        reasonCode: "browser_gate_not_run",
        completed: false,
      }),
      error: /unattempted restart receipt must not include restart results/,
    },
    {
      create: () => createFailureInjectionReceipt({
        fixtureId: "managed-full-text-100mib",
        scenario: "transaction-abort",
        injectionPoint: "after-metadata-before-segments",
        attempted: false,
        reasonCode: "storage_candidate_not_selected",
        completed: false,
      }),
      error: /unattempted failure-injection receipt must not include failure results/,
    },
  ];
  for (const { create, error } of contradictoryUnavailableReceipts) {
    assert.throws(create, error);
  }

  const checkpoint = {
    checkpointId: "batch-1",
    phase: "indexing_sources",
    batchOrdinal: 1,
    recordCount: 10,
    canonicalBytes: 100,
    operationOpen: true,
  };
  const contradictoryAvailableReceipts = [
    () => createMemoryReceipt({
      fixtureId: "managed-full-text-100mib",
      phase: "admission",
      metricAvailable: true,
      heapUsedBytes: 10,
      heapTotalBytes: 20,
      rssBytes: 30,
      peakHeapGrowthBytes: 5,
      reasonCode: "browser_metric_unavailable",
    }),
    () => createIndexedDbUsageReceipt({
      fixtureId: "managed-full-text-100mib",
      phase: "admission",
      metricAvailable: true,
      storageEstimateUsageBeforeBytes: 0,
      storageEstimateUsageAfterBytes: 1,
      storageEstimateQuotaBytes: 10,
      indexedDbDeltaBytes: 1,
      expectedDirection: "increase",
      readbackVerified: true,
      reasonCode: "browser_metric_unavailable",
    }),
    () => createPersistedIndexSizeReceipt({
      fixtureId: "managed-full-text-100mib",
      phase: "indexing_sources",
      metricAvailable: true,
      managedSourceBytes: 100,
      persistedIndexBytes: 50,
      reasonCode: "browser_metric_unavailable",
    }),
    () => createRestartReceipt({
      fixtureId: "managed-full-text-100mib",
      scenario: "mv3-worker-restart",
      attempted: true,
      completed: true,
      preRestartCheckpoint: checkpoint,
      postRestartCheckpoint: checkpoint,
      replayedBatchCount: 0,
      readbackVerified: true,
      mixedGenerationVisible: false,
      duplicatePostingsDetected: false,
      fullRebuildStarted: false,
      reasonCode: "browser_gate_not_run",
    }),
    () => createFailureInjectionReceipt({
      fixtureId: "managed-full-text-100mib",
      scenario: "transaction-abort",
      injectionPoint: "after-metadata-before-segments",
      attempted: true,
      completed: true,
      visibleRowsAfterFailure: 0,
      cleanupRequired: false,
      cleanupCompleted: false,
      readbackVerified: true,
      reasonCode: "storage_candidate_not_selected",
    }),
  ];
  for (const create of contradictoryAvailableReceipts) {
    assert.throws(create, /must not include reasonCode/);
  }

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

test("GATE-014-A1 helper receipts pass only with concrete required measurements", () => {
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
    storageEstimateUsageBeforeBytes: 10,
    storageEstimateUsageAfterBytes: 40,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: 30,
    expectedDirection: "increase",
    readbackVerified: true,
  });
  const indexedDbCleanup = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "cleanup",
    metricAvailable: true,
    storageEstimateUsageBeforeBytes: 40,
    storageEstimateUsageAfterBytes: 10,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: -30,
    expectedDirection: "decrease",
    readbackVerified: true,
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
    replayedBatchCount: 0,
    readbackVerified: true,
    mixedGenerationVisible: false,
    duplicatePostingsDetected: false,
    fullRebuildStarted: false,
  });
  const restartWithOneReplay = createRestartReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "mv3-worker-restart",
    attempted: true,
    completed: true,
    preRestartCheckpoint: {
      checkpointId: "batch-10",
      phase: "indexing_sources",
      batchOrdinal: 10,
      recordCount: 100,
      canonicalBytes: 1000,
      operationOpen: true,
    },
    postRestartCheckpoint: {
      checkpointId: "batch-11",
      phase: "verifying_generation",
      batchOrdinal: 11,
      recordCount: 110,
      canonicalBytes: 1100,
      operationOpen: true,
    },
    replayedBatchCount: 1,
    readbackVerified: true,
    mixedGenerationVisible: false,
    duplicatePostingsDetected: false,
    fullRebuildStarted: false,
  });
  const failure = createFailureInjectionReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "transaction-abort",
    injectionPoint: "after-metadata-before-segments",
    attempted: true,
    completed: true,
    visibleRowsAfterFailure: 0,
    cleanupRequired: true,
    cleanupCompleted: true,
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

  for (const receipt of [
    memory,
    indexedDb,
    indexedDbCleanup,
    persistedIndex,
    restart,
    restartWithOneReplay,
    failure,
    cleanup,
  ]) {
    assert.equal(receipt.status, "pass");
    assert.equal(receipt.storesSensitiveText, false);
    assert.doesNotMatch(JSON.stringify(receipt), SENSITIVE_RECEIPT_TOKEN_PATTERN);
  }
  assert.equal(indexedDb.indexedDbDeltaBytes, 30);
  assert.equal(indexedDbCleanup.indexedDbDeltaBytes, -30);
  assert.equal(restartWithOneReplay.checkpointProgressionValid, true);
  assert.equal(persistedIndex.indexToSourceRatioPermille, 800);
  assert.equal(Object.isFrozen(restart), true);
  assert.equal(Object.isFrozen(restart.preRestartCheckpoint), true);
  assert.throws(() => {
    restart.preRestartCheckpoint.batchOrdinal = 99;
  }, TypeError);
});

test("GATE-014-A1 receipt outcomes fail for contradictory or gate-negative evidence", () => {
  const memoryZero = createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    heapUsedBytes: 0,
    heapTotalBytes: 0,
    rssBytes: 0,
    peakHeapGrowthBytes: 0,
  });
  const memoryInconsistent = createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    heapUsedBytes: 20,
    heapTotalBytes: 10,
    rssBytes: 30,
    peakHeapGrowthBytes: 5,
  });
  const memoryOverLimit = createMemoryReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    heapUsedBytes: 20,
    heapTotalBytes: 30,
    rssBytes: 40,
    peakHeapGrowthBytes: 256 * MIB + 1,
  });
  const indexedDbZero = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    storageEstimateUsageBeforeBytes: 0,
    storageEstimateUsageAfterBytes: 0,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: 0,
    expectedDirection: "increase",
    readbackVerified: true,
  });
  const indexedDbInconsistent = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    storageEstimateUsageBeforeBytes: 80,
    storageEstimateUsageAfterBytes: 101,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: 21,
    expectedDirection: "increase",
    readbackVerified: true,
  });
  const indexedDbImpossibleDelta = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "admission",
    metricAvailable: true,
    storageEstimateUsageBeforeBytes: 10,
    storageEstimateUsageAfterBytes: 40,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: 41,
    expectedDirection: "increase",
    readbackVerified: true,
  });
  const indexedDbWrongDirection = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "cleanup",
    metricAvailable: true,
    storageEstimateUsageBeforeBytes: 40,
    storageEstimateUsageAfterBytes: 10,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: -30,
    expectedDirection: "increase",
    readbackVerified: true,
  });
  const indexedDbReadbackMissing = createIndexedDbUsageReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "cleanup",
    metricAvailable: true,
    storageEstimateUsageBeforeBytes: 40,
    storageEstimateUsageAfterBytes: 10,
    storageEstimateQuotaBytes: 100,
    indexedDbDeltaBytes: -30,
    expectedDirection: "decrease",
    readbackVerified: false,
  });
  const zeroIndex = createPersistedIndexSizeReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "verifying-generation",
    metricAvailable: true,
    managedSourceBytes: 100,
    persistedIndexBytes: 0,
  });
  const oversizedIndex = createPersistedIndexSizeReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "verifying-generation",
    metricAvailable: true,
    managedSourceBytes: 100,
    persistedIndexBytes: 151,
  });
  const roundedDownOversizedIndex = createPersistedIndexSizeReceipt({
    fixtureId: "managed-full-text-100mib",
    phase: "verifying-generation",
    metricAvailable: true,
    managedSourceBytes: 2001,
    persistedIndexBytes: 3002,
  });

  for (const receipt of [
    memoryZero,
    memoryInconsistent,
    memoryOverLimit,
    indexedDbZero,
    indexedDbInconsistent,
    indexedDbImpossibleDelta,
    indexedDbWrongDirection,
    indexedDbReadbackMissing,
    zeroIndex,
    oversizedIndex,
    roundedDownOversizedIndex,
  ]) {
    assert.equal(receipt.status, "fail");
  }

  const checkpoint10 = {
    checkpointId: "batch-10",
    phase: "indexing-sources",
    batchOrdinal: 10,
    recordCount: 100,
    canonicalBytes: 1000,
    operationOpen: true,
  };
  const checkpoint0 = {
    checkpointId: "batch-0",
    phase: "indexing-sources",
    batchOrdinal: 0,
    recordCount: 0,
    canonicalBytes: 0,
    operationOpen: true,
  };
  const checkpoint9 = {
    checkpointId: "batch-9",
    phase: "indexing-sources",
    batchOrdinal: 9,
    recordCount: 90,
    canonicalBytes: 900,
    operationOpen: true,
  };
  const restartBase = {
    fixtureId: "managed-full-text-100mib",
    scenario: "mv3-worker-restart",
    attempted: true,
    completed: true,
    preRestartCheckpoint: checkpoint10,
    postRestartCheckpoint: checkpoint0,
    replayedBatchCount: 1,
    readbackVerified: true,
    mixedGenerationVisible: false,
    duplicatePostingsDetected: false,
    fullRebuildStarted: false,
  };

  assert.equal(createRestartReceipt(restartBase).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: checkpoint9,
    replayedBatchCount: 1,
  }).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: checkpoint10,
    replayedBatchCount: 2,
  }).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: checkpoint10,
    mixedGenerationVisible: true,
  }).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: checkpoint10,
    duplicatePostingsDetected: true,
  }).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: checkpoint10,
    fullRebuildStarted: true,
  }).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: checkpoint10,
    readbackVerified: false,
  }).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: {
      ...checkpoint10,
      recordCount: 0,
      canonicalBytes: 0,
    },
  }).status, "fail");
  assert.equal(createRestartReceipt({
    ...restartBase,
    postRestartCheckpoint: {
      ...checkpoint10,
      checkpointId: "unrelated-checkpoint",
    },
  }).status, "fail");

  const failureBase = {
    fixtureId: "managed-full-text-100mib",
    scenario: "transaction-abort",
    injectionPoint: "after-metadata-before-segments",
    attempted: true,
    completed: true,
    visibleRowsAfterFailure: 0,
    cleanupRequired: true,
    cleanupCompleted: true,
    readbackVerified: true,
  };
  assert.equal(createFailureInjectionReceipt({
    ...failureBase,
    visibleRowsAfterFailure: 1,
  }).status, "fail");
  assert.equal(createFailureInjectionReceipt({
    ...failureBase,
    cleanupCompleted: false,
  }).status, "fail");
  assert.equal(createFailureInjectionReceipt({
    ...failureBase,
    readbackVerified: false,
  }).status, "fail");
  assert.equal(createFailureInjectionReceipt({
    ...failureBase,
    completed: false,
  }).status, "fail");
  assert.throws(() => createFailureInjectionReceipt({
    fixtureId: "managed-full-text-100mib",
    scenario: "transaction-abort",
    injectionPoint: "after-metadata-before-segments",
    attempted: true,
    completed: true,
    visibleRowsAfterFailure: 0,
    cleanupRequired: true,
    readbackVerified: true,
  }), /cleanupCompleted/);

  assert.equal(createCleanupReadbackReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "cleanup-generated-artifacts",
    beforeFileCount: 2,
    removedFileCount: 1,
    afterFileCount: 0,
    tempFileCountAfterCleanup: 0,
    finalFileCountAfterCleanup: 0,
    readbackVerified: true,
  }).status, "fail");
  assert.equal(createCleanupReadbackReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "cleanup-generated-artifacts",
    beforeFileCount: 2,
    removedFileCount: 1,
    afterFileCount: 1,
    tempFileCountAfterCleanup: 1,
    finalFileCountAfterCleanup: 0,
    readbackVerified: true,
  }).status, "fail");
  assert.equal(createCleanupReadbackReceipt({
    fixtureId: "managed-full-text-100mib",
    operation: "cleanup-generated-artifacts",
    beforeFileCount: 2,
    removedFileCount: 2,
    afterFileCount: 0,
    tempFileCountAfterCleanup: 0,
    finalFileCountAfterCleanup: 0,
    readbackVerified: false,
  }).status, "fail");
});

test("GATE-014-A1 artifact writer is failure-atomic and leaves no temp artifact", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-managed-full-text-atomic",
    targetCanonicalBytes: 192 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-fixture-atomic-repo-");
  const generatedDirectory = path.join(repositoryRoot, GENERATED_FIXTURE_RELATIVE_DIR);

  try {
    const success = await writeFixtureArtifact(definition, {
      seed: "artifact-seed",
      repositoryRoot,
    });
    const originalBytes = await readFile(success.artifactPath);

    await assert.rejects(() => writeFixtureArtifact(definition, {
      seed: "artifact-seed-v2",
      repositoryRoot,
      injectFailureAt: "after-first-record",
    }), /Injected GATE-014 artifact failure/);

    assert.deepEqual(await readFile(success.artifactPath), originalBytes);
    assert.deepEqual((await readdir(generatedDirectory)).filter(name => name.endsWith(".tmp")), []);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A1 artifact writer atomically replaces an existing artifact", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-managed-full-text-replacement",
    targetCanonicalBytes: 192 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-fixture-replace-repo-");
  const generatedDirectory = path.join(repositoryRoot, GENERATED_FIXTURE_RELATIVE_DIR);

  try {
    const first = await writeFixtureArtifact(definition, {
      seed: "artifact-replacement-seed-1",
      repositoryRoot,
    });
    const second = await writeFixtureArtifact(definition, {
      seed: "artifact-replacement-seed-2",
      repositoryRoot,
    });

    assert.equal(first.artifactPath, second.artifactPath);
    assert.notEqual(first.artifactSha256, second.artifactSha256);
    assert.equal((await stat(second.artifactPath)).size, definition.targetCanonicalBytes);
    assert.deepEqual((await readdir(generatedDirectory)).filter(name => name.endsWith(".tmp")), []);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A1 golden receipt writer is failure-atomic", async () => {
  const definition = createCustomFixtureDefinition({
    id: "unit-golden-receipt-atomic",
    targetCanonicalBytes: 384 * 1024,
    profile: "baseline",
    targetKind: "managed_full_text_total",
  });
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-receipt-atomic-repo-");
  const receiptDirectory = path.join(repositoryRoot, GOLDEN_RECEIPT_RELATIVE_DIR);

  try {
    const first = await writeGoldenFixtureReceipt(definition, {
      seed: "golden-receipt-seed-1",
      repositoryRoot,
    });
    const originalBytes = await readFile(first.receiptPath);

    for (const injectFailureAt of ["after-temp-write", "after-readback-before-publish"]) {
      await assert.rejects(() => writeGoldenFixtureReceipt(definition, {
        seed: "golden-receipt-seed-2",
        repositoryRoot,
        injectFailureAt,
      }), /Injected GATE-014 receipt failure/);

      assert.deepEqual(await readFile(first.receiptPath), originalBytes);
      assert.deepEqual((await readdir(receiptDirectory)).filter(name => name.endsWith(".tmp")), []);
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A1 generated artifact cleanup removes only known final and temp names", async () => {
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-cleanup-repo-");
  const generatedDirectory = path.join(repositoryRoot, GENERATED_FIXTURE_RELATIVE_DIR);

  try {
    await mkdir(generatedDirectory, { recursive: true });
    await writeFile(path.join(generatedDirectory, "managed-full-text-100mib.jsonl"), "generated\n", "utf8");
    await writeFile(
      path.join(generatedDirectory, ".managed-full-text-100mib.123.00000000-0000-4000-8000-000000000000.tmp"),
      "partial\n",
      "utf8",
    );
    await writeFile(
      path.join(generatedDirectory, ".managed-full-text-100mib.lookalike.tmp"),
      "keep\n",
      "utf8",
    );
    await writeFile(path.join(generatedDirectory, "unrelated-user-file.jsonl"), "keep\n", "utf8");

    const receipt = await cleanupGeneratedFixtureArtifacts({
      repositoryRoot,
    });

    assert.equal(receipt.status, "pass");
    assert.equal(receipt.beforeFileCount, 2);
    assert.equal(receipt.removedFileCount, 2);
    assert.equal(receipt.afterFileCount, 0);
    assert.deepEqual(await readdir(generatedDirectory), [
      ".managed-full-text-100mib.lookalike.tmp",
      "unrelated-user-file.jsonl",
    ]);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A1 cleanup rejects unsafe targets", async () => {
  await assert.rejects(() => cleanupGeneratedFixtureArtifacts({
    repositoryRoot: path.parse(process.cwd()).root,
  }), /Refusing to clean unsafe GATE-014 fixture directory/);
});

test("GATE-014-A1 cleanup rejects an unmarked arbitrary repository root", async () => {
  const arbitraryRoot = await mkdtemp(path.join(os.tmpdir(), "gate-014-unmarked-root-"));
  try {
    await assert.rejects(
      () => cleanupGeneratedFixtureArtifacts({ repositoryRoot: arbitraryRoot }),
      /Refusing to clean unsafe GATE-014 fixture directory/,
    );
  } finally {
    await rm(arbitraryRoot, { recursive: true, force: true });
  }
});

test("GATE-014-A1 cleanup rejects removed arbitrary-directory bypass options", async () => {
  const arbitraryDirectory = await mkdtemp(path.join(os.tmpdir(), "gate-014-cleanup-bypass-"));
  try {
    await assert.rejects(() => cleanupGeneratedFixtureArtifacts({
      outputDirectory: arbitraryDirectory,
      allowCustomOutputDirectoryForTests: true,
    }), /unsupported field: outputDirectory/);
    const inheritedOptions = Object.create({ repositoryRoot: arbitraryDirectory });
    await assert.rejects(
      () => cleanupGeneratedFixtureArtifacts(inheritedOptions),
      /must be a plain object/,
    );
  } finally {
    await rm(arbitraryDirectory, { recursive: true, force: true });
  }
});

test("GATE-014-A1 cleanup rejects a redirected generated-directory ancestor", async t => {
  const repositoryRoot = await createFakeRepositoryRoot("gate-014-cleanup-link-repo-");
  const redirectTarget = await mkdtemp(path.join(os.tmpdir(), "gate-014-cleanup-link-target-"));
  const testsLink = path.join(repositoryRoot, "tests");

  try {
    try {
      await symlink(redirectTarget, testsLink, "junction");
    } catch (error) {
      if (error && error.code === "EPERM") {
        t.skip("junction creation is unavailable in this Windows environment");
        return;
      }
      throw error;
    }

    await assert.rejects(() => cleanupGeneratedFixtureArtifacts({
      repositoryRoot,
    }), /Refusing to clean unsafe GATE-014 fixture directory/);
  } finally {
    await rm(testsLink, { force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
    await rm(redirectTarget, { recursive: true, force: true });
  }
});
