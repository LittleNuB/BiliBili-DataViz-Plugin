import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  INSUFFICIENT_EVIDENCE,
  REUSABLE_RECEIPT_HELPER_DESCRIPTORS,
  assertPublicSafeId,
  createCleanupReadbackReceipt,
} from './gate-014-receipt-helpers.mjs';

export const MIB = 1024 * 1024;
export const DEFAULT_SEED = 'gate-014-public-safe-seed-v1';
export const GENERATOR_VERSION = 'gate-014-fixture-generator-v2';
export const RECEIPT_CONTRACT = 'gate-014-fixture-receipt-v2';
export const MANAGED_FULL_TEXT_CONTRACT = 'managed-full-text-v1';
export const GENERATED_FIXTURE_RELATIVE_DIR = 'tests/fixtures/gate-014/generated';
export const GOLDEN_RECEIPT_RELATIVE_DIR = 'tests/fixtures/gate-014/receipts';

const ZERO_SHA = '0'.repeat(64);
const BASE_CAPTURED_AT = 1_788_220_800_000;
const BASE_CREATED_AT = 1_788_220_860_000;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLEANUP_OPERATION_ID = 'cleanup-generated-artifacts';
const FIXTURE_DEFINITION_FIELDS = Object.freeze([
  'id',
  'description',
  'targetCanonicalBytes',
  'targetKind',
  'profileKey',
  'profileName',
  'exactVersionCount',
]);
const TARGET_KIND_BY_PROFILE = Object.freeze({
  baseline: 'managed_full_text_total',
  singleVersionStress: 'single_version_full_text',
  highFragmentation: 'pathological_high_fragmentation',
});
const TARGET_KIND_DESCRIPTIONS = Object.freeze({
  managed_full_text_total: 'synthetic managed-full-text gate fixture',
  single_version_full_text: 'synthetic single-version full-text stress fixture',
  pathological_high_fragmentation: 'synthetic pathological high-fragmentation fixture',
});

export const MALFORMED_CANDIDATE_SUITE = deepFreeze([
  malformedCandidate('malformed-empty-text', 'empty_text', { text: '' }),
  malformedCandidate('malformed-reversed-timing', 'invalid_timing', {
    startSeconds: 2,
    endSeconds: 1,
  }),
  malformedCandidate('malformed-zero-duration', 'invalid_timing', {
    startSeconds: 1,
    endSeconds: 1,
  }),
  malformedCandidate('malformed-non-finite-start', 'non_finite_timing', {
    startSeconds: Number.POSITIVE_INFINITY,
  }),
  malformedCandidate('malformed-negative-zero-start', 'negative_zero', {
    startSeconds: -0,
  }),
  malformedCandidate('malformed-lone-surrogate-text', 'lone_surrogate', { text: '\ud800' }),
  malformedCandidate('malformed-invalid-bvid', 'invalid_identity', { bvid: 'invalid_bvid' }),
  malformedCandidate('malformed-invalid-cid', 'invalid_identity', { cid: 0 }),
]);

const PROFILE_DEFINITIONS = Object.freeze({
  baseline: Object.freeze({
    name: 'public_safe_synthetic_mixed_subtitle_profile_v1',
    description: 'Synthetic mixed CJK/Latin/number/punctuation subtitle-like text; no real subtitle distribution claim.',
    minSegmentTextBytes: 420,
    maxSegmentTextBytes: 1_920,
    preferredSegmentTextBytes: 1_260,
    minSegmentsPerVersion: 96,
    maxSegmentsPerVersion: 720,
    preferredVersionBytes: 768 * 1024,
    overlapRatePermille: 90,
    minSegmentDurationSeconds: 2,
    maxSegmentDurationSeconds: 12,
    maxGapSeconds: 2,
    textUnits: baselineTextUnits(),
  }),
  singleVersionStress: Object.freeze({
    name: 'public_safe_single_version_64mib_stress_v1',
    description: 'Synthetic one-version stress shape for atomic metadata plus complete ordered segments.',
    minSegmentTextBytes: 960,
    maxSegmentTextBytes: 3_072,
    preferredSegmentTextBytes: 1_620,
    minSegmentsPerVersion: 18_000,
    maxSegmentsPerVersion: 54_000,
    preferredVersionBytes: 64 * MIB,
    overlapRatePermille: 60,
    minSegmentDurationSeconds: 2,
    maxSegmentDurationSeconds: 10,
    maxGapSeconds: 1,
    textUnits: baselineTextUnits(),
  }),
  highFragmentation: Object.freeze({
    name: 'public_safe_high_fragmentation_pathological_v1',
    description: 'Synthetic short-segment pathological shape for high segment-count and overlap stress.',
    minSegmentTextBytes: 48,
    maxSegmentTextBytes: 112,
    preferredSegmentTextBytes: 72,
    minSegmentsPerVersion: 900,
    maxSegmentsPerVersion: 2_400,
    preferredVersionBytes: 256 * 1024,
    overlapRatePermille: 350,
    minSegmentDurationSeconds: 1,
    maxSegmentDurationSeconds: 4,
    maxGapSeconds: 0,
    textUnits: highFragmentationTextUnits(),
  }),
});

export const FIXTURE_DEFINITIONS = Object.freeze([
  createCustomFixtureDefinition({
    id: 'managed-full-text-100mib',
    targetCanonicalBytes: 100 * MIB,
    profile: 'baseline',
    targetKind: 'managed_full_text_total',
  }),
  createCustomFixtureDefinition({
    id: 'managed-full-text-400mib',
    targetCanonicalBytes: 400 * MIB,
    profile: 'baseline',
    targetKind: 'managed_full_text_total',
  }),
  createCustomFixtureDefinition({
    id: 'managed-full-text-500mib',
    targetCanonicalBytes: 500 * MIB,
    profile: 'baseline',
    targetKind: 'managed_full_text_total',
  }),
  createCustomFixtureDefinition({
    id: 'single-version-64mib',
    targetCanonicalBytes: 64 * MIB,
    profile: 'singleVersionStress',
    targetKind: 'single_version_full_text',
  }),
  createCustomFixtureDefinition({
    id: 'high-fragmentation-pathological',
    targetCanonicalBytes: 16 * MIB,
    profile: 'highFragmentation',
    targetKind: 'pathological_high_fragmentation',
  }),
]);

export function createCustomFixtureDefinition(input) {
  assertAllowedObjectFields(input, [
    'id',
    'targetCanonicalBytes',
    'profile',
    'targetKind',
  ], 'fixture definition');
  const profile = PROFILE_DEFINITIONS[input.profile];
  if (!profile) {
    throw new Error(`Unknown GATE-014 fixture profile: ${input.profile}`);
  }
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(input.id)) {
    throw new Error('fixture id must be lowercase kebab-case');
  }
  assertPublicSafeId(input.id, 'fixture id');
  if (!Number.isSafeInteger(input.targetCanonicalBytes) || input.targetCanonicalBytes <= 0) {
    throw new Error('targetCanonicalBytes must be a positive safe integer');
  }
  if (!Object.hasOwn(TARGET_KIND_DESCRIPTIONS, input.targetKind)) {
    throw new Error('fixture definition must use a closed targetKind');
  }
  if (TARGET_KIND_BY_PROFILE[input.profile] !== input.targetKind) {
    throw new Error('fixture targetKind does not match profile');
  }
  const description = `Exact ${input.targetCanonicalBytes}-byte ${TARGET_KIND_DESCRIPTIONS[input.targetKind]} ${input.id}.`;
  return deepFreeze({
    id: input.id,
    description,
    targetCanonicalBytes: input.targetCanonicalBytes,
    targetKind: input.targetKind,
    profileKey: input.profile,
    profileName: profile.name,
    exactVersionCount: input.targetKind === 'single_version_full_text' ? 1 : null,
  });
}

function validateFixtureDefinition(definition) {
  assertAllowedObjectFields(definition, FIXTURE_DEFINITION_FIELDS, 'fixture definition');
  const expected = createCustomFixtureDefinition({
    id: definition.id,
    targetCanonicalBytes: definition.targetCanonicalBytes,
    profile: definition.profileKey,
    targetKind: definition.targetKind,
  });
  for (const field of FIXTURE_DEFINITION_FIELDS) {
    if (definition[field] !== expected[field]) {
      throw new Error(`fixture definition ${field} does not match its controlled value`);
    }
  }
  return expected;
}

export async function createFixtureReceipt(definition, options = {}) {
  assertAllowedObjectFields(options, ['seed'], 'createFixtureReceipt options');
  definition = validateFixtureDefinition(definition);
  const seed = assertPublicSafeId(options.seed ?? DEFAULT_SEED, 'seed');
  const builder = new FixtureReceiptBuilder(definition, seed);
  await buildFixture(definition, seed, { builder });
  return builder.toReceipt();
}

export async function writeFixtureArtifact(definition, options = {}) {
  assertAllowedObjectFields(options, [
    'seed',
    'repositoryRoot',
    'injectFailureAt',
  ], 'writeFixtureArtifact options');
  definition = validateFixtureDefinition(definition);
  const seed = assertPublicSafeId(options.seed ?? DEFAULT_SEED, 'seed');
  assertInjectionPoint(options.injectFailureAt, [
    'after-temp-open',
    'after-first-record',
    'after-close-before-publish',
  ], 'artifact');
  const outputDirectory = await resolveKnownRepositoryDirectory(
    options.repositoryRoot,
    GENERATED_FIXTURE_RELATIVE_DIR,
    'Refusing to use unsafe GATE-014 generated fixture directory',
  );

  const artifactPath = path.join(outputDirectory, `${definition.id}.jsonl`);
  let tempPath = path.join(outputDirectory, `.${definition.id}.${process.pid}.${randomUUID()}.tmp`);
  while (await pathExists(tempPath)) {
    tempPath = path.join(outputDirectory, `.${definition.id}.${process.pid}.${randomUUID()}.tmp`);
  }
  let stream = createWriteStream(tempPath, { flags: 'wx' });
  const builder = new FixtureReceiptBuilder(definition, seed);

  try {
    await once(stream, 'open');
    if (options.injectFailureAt === 'after-temp-open') {
      throw injectedArtifactFailure(options.injectFailureAt);
    }

    let lineCount = 0;
    await buildFixture(definition, seed, {
      builder,
      writeLine: async line => {
        if (!stream.write(`${line}\n`, 'utf8')) {
          await once(stream, 'drain');
        }
        lineCount += 1;
        if (options.injectFailureAt === 'after-first-record' && lineCount === 1) {
          throw injectedArtifactFailure(options.injectFailureAt);
        }
      },
    });

    stream.end();
    await once(stream, 'finish');
    await once(stream, 'close');
    stream = null;

    if (options.injectFailureAt === 'after-close-before-publish') {
      throw injectedArtifactFailure(options.injectFailureAt);
    }

    const receipt = builder.toReceipt();
    const readback = await hashFile(tempPath);
    if (readback.bytes !== receipt.canonical.totalBytes) {
      throw new Error(`Artifact readback byte mismatch: expected ${receipt.canonical.totalBytes}, got ${readback.bytes}`);
    }
    if (readback.sha256 !== receipt.canonical.fixtureSha256) {
      throw new Error('Artifact readback hash mismatch');
    }

    await rename(tempPath, artifactPath);
    tempPath = null;
    return deepFreeze({
      artifactPath,
      artifactSha256: readback.sha256,
      receipt,
    });
  } catch (error) {
    await closeArtifactStreamAfterFailure(stream);
    if (tempPath) {
      await rm(tempPath, { force: true });
    }
    throw error;
  }
}

export async function writeGoldenFixtureReceipt(definition, options = {}) {
  assertAllowedObjectFields(options, [
    'seed',
    'repositoryRoot',
    'injectFailureAt',
  ], 'writeGoldenFixtureReceipt options');
  definition = validateFixtureDefinition(definition);
  const seed = assertPublicSafeId(options.seed ?? DEFAULT_SEED, 'seed');
  const receipt = await createFixtureReceipt(definition, { seed });
  return publishGoldenReceipt(definition, receipt, options);
}

async function publishGoldenReceipt(definition, receipt, options = {}) {
  assertInjectionPoint(options.injectFailureAt, [
    'after-temp-write',
    'after-readback-before-publish',
  ], 'receipt');
  const receiptDirectory = await resolveKnownRepositoryDirectory(
    options.repositoryRoot,
    GOLDEN_RECEIPT_RELATIVE_DIR,
    'Refusing to use unsafe GATE-014 golden receipt directory',
  );
  const receiptPath = path.join(receiptDirectory, `${definition.id}.receipt.json`);
  let tempPath = path.join(
    receiptDirectory,
    `.${definition.id}.receipt.${process.pid}.${randomUUID()}.tmp`,
  );
  while (await pathExists(tempPath)) {
    tempPath = path.join(
      receiptDirectory,
      `.${definition.id}.receipt.${process.pid}.${randomUUID()}.tmp`,
    );
  }
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const expectedSha256 = sha256Hex(serialized);
  const expectedBytes = byteLength(serialized);

  try {
    await writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    if (options.injectFailureAt === 'after-temp-write') {
      throw injectedReceiptFailure(options.injectFailureAt);
    }

    const readback = await hashFile(tempPath);
    if (readback.bytes !== expectedBytes || readback.sha256 !== expectedSha256) {
      throw new Error('Golden receipt readback hash or byte mismatch');
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(tempPath, 'utf8'));
    } catch {
      throw new Error('Golden receipt readback JSON parse failed');
    }
    if (JSON.stringify(parsed) !== JSON.stringify(receipt)) {
      throw new Error('Golden receipt readback content mismatch');
    }
    if (options.injectFailureAt === 'after-readback-before-publish') {
      throw injectedReceiptFailure(options.injectFailureAt);
    }

    await rename(tempPath, receiptPath);
    tempPath = null;
    return deepFreeze({
      receiptPath,
      receiptSha256: expectedSha256,
      receipt,
    });
  } catch (error) {
    if (tempPath) {
      await rm(tempPath, { force: true });
    }
    throw error;
  }
}

export async function cleanupGeneratedFixtureArtifacts(options = {}) {
  assertAllowedObjectFields(options, ['repositoryRoot'], 'cleanupGeneratedFixtureArtifacts options');
  const outputDirectory = await resolveCleanupDirectory(options);
  const entries = await readdir(outputDirectory);
  const knownNames = new Set(FIXTURE_DEFINITIONS.map(definition => `${definition.id}.jsonl`));
  const candidates = entries.filter(name => (
    knownNames.has(name) || isKnownGeneratedTempArtifactName(name)
  ));

  let removedFileCount = 0;
  for (const name of candidates) {
    const target = path.join(outputDirectory, name);
    const targetStats = await lstat(target);
    if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
      throw new Error('Refusing to clean unsafe GATE-014 fixture directory entry');
    }
    await rm(target, { force: false });
    removedFileCount += 1;
  }

  const readbackEntries = await readdir(outputDirectory);
  const remainingKnownNames = readbackEntries.filter(name => knownNames.has(name));
  const remainingTempNames = readbackEntries.filter(name => isKnownGeneratedTempArtifactName(name));

  return createCleanupReadbackReceipt({
    fixtureId: 'gate-014-generated-fixtures',
    operation: CLEANUP_OPERATION_ID,
    beforeFileCount: candidates.length,
    removedFileCount,
    afterFileCount: remainingKnownNames.length + remainingTempNames.length,
    tempFileCountAfterCleanup: remainingTempNames.length,
    finalFileCountAfterCleanup: remainingKnownNames.length,
    readbackVerified: remainingKnownNames.length === 0 && remainingTempNames.length === 0,
  });
}

async function closeArtifactStreamAfterFailure(stream) {
  if (!stream || stream.destroyed) {
    return;
  }
  const closePromise = once(stream, 'close').catch(() => {});
  stream.destroy();
  await closePromise;
}

function injectedArtifactFailure(injectionPoint) {
  return new Error(`Injected GATE-014 artifact failure at ${injectionPoint}`);
}

function injectedReceiptFailure(injectionPoint) {
  return new Error(`Injected GATE-014 receipt failure at ${injectionPoint}`);
}

async function buildFixture(definition, seed, options) {
  const profile = PROFILE_DEFINITIONS[definition.profileKey];
  const querySuite = createQuerySuite();
  const plantedTargets = querySuite.filter(query => query.planted);
  const state = {
    remainingBytes: definition.targetCanonicalBytes,
    versionIndex: 0,
    globalSegmentIndex: 0,
  };

  if (definition.exactVersionCount === 1) {
    const plan = createExactVersionPlan(definition, profile, seed, 0, definition.targetCanonicalBytes);
    await processVersionPlan(definition, profile, seed, plan, plantedTargets, state, options);
    state.remainingBytes = 0;
    state.versionIndex = 1;
  } else {
    while (state.remainingBytes > 0) {
      const exactBounds = getExactVersionBounds(definition, profile, state.versionIndex, seed);
      const isFinal = state.remainingBytes >= exactBounds.minBytes
        && state.remainingBytes <= exactBounds.maxBytes;
      const targetBytes = isFinal
        ? state.remainingBytes
        : chooseIntermediateVersionBytes(definition, profile, seed, state, exactBounds);
      const plan = createExactVersionPlan(definition, profile, seed, state.versionIndex, targetBytes);
      await processVersionPlan(definition, profile, seed, plan, plantedTargets, state, options);
      state.remainingBytes -= plan.serializedBytes;
      state.versionIndex += 1;
    }
  }

  if (state.remainingBytes !== 0) {
    throw new Error(`Fixture byte solver ended with ${state.remainingBytes} bytes remaining`);
  }

  options.builder.finish(querySuite, plantedTargets);
}

function chooseIntermediateVersionBytes(definition, profile, seed, state, exactBounds) {
  const rng = createRng(`${seed}|${definition.id}|version-bytes|${state.versionIndex}`);
  const jitter = rng.integer(-96 * 1024, 96 * 1024);
  const desired = Math.max(exactBounds.minBytes, Math.min(exactBounds.maxBytes, profile.preferredVersionBytes + jitter));
  const nextMin = getExactVersionBounds(definition, profile, state.versionIndex + 1, seed).minBytes;
  const maxAllowed = state.remainingBytes - nextMin;
  if (maxAllowed < exactBounds.minBytes) {
    throw new Error(`Cannot leave a valid final version for ${definition.id}`);
  }
  return Math.max(exactBounds.minBytes, Math.min(desired, maxAllowed));
}

async function processVersionPlan(definition, profile, seed, plan, plantedTargets, state, options) {
  const analysis = analyzeVersion(definition, profile, seed, plan, plantedTargets, state.globalSegmentIndex);
  options.builder.addVersion(plan, analysis, plantedTargets, state.globalSegmentIndex);

  if (options.writeLine) {
    await options.writeLine(canonicalLine(analysis.metadataRecord));
    await replayVersionSegmentsAsync(
      definition,
      profile,
      seed,
      plan,
      plantedTargets,
      state.globalSegmentIndex,
      async segment => {
        await options.writeLine(canonicalLine(segment.segmentRecord));
      },
    );
  }

  state.globalSegmentIndex += plan.segmentCount;
}

function analyzeVersion(definition, profile, seed, plan, plantedTargets, globalSegmentOffset) {
  const bodyHash = createHash('sha256');
  const timelineHash = createHash('sha256');
  const characterMix = emptyCharacterMix();
  const segmentLengthBytes = new BoundedHistogramAccumulator(1);
  const segmentRecordLengthBytes = new BoundedHistogramAccumulator(1);
  const overlapSeconds = new BoundedHistogramAccumulator(1);
  const targetLocations = [];
  let bodyBytes = 0;
  let timelineBytes = 0;
  let segmentCanonicalBytes = 0;
  let previousEndSeconds = null;

  replayVersionSegments(definition, profile, seed, plan, plantedTargets, globalSegmentOffset, segment => {
    const bodyLine = canonicalLine({
      contract: MANAGED_FULL_TEXT_CONTRACT,
      ordinal: segment.ordinal,
      text: segment.text,
    });
    const timelineLine = canonicalLine({
      contract: MANAGED_FULL_TEXT_CONTRACT,
      ordinal: segment.ordinal,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    });
    const segmentLine = canonicalLine(segment.segmentRecord);
    updateLineHash(bodyHash, bodyLine);
    updateLineHash(timelineHash, timelineLine);
    bodyBytes += byteLengthWithLf(bodyLine);
    timelineBytes += byteLengthWithLf(timelineLine);
    segmentCanonicalBytes += byteLengthWithLf(segmentLine);
    segmentLengthBytes.add(segment.textBytes);
    segmentRecordLengthBytes.add(byteLengthWithLf(segmentLine));
    addCharacterMix(characterMix, segment.characterMix);
    if (previousEndSeconds !== null && segment.startSeconds < previousEndSeconds) {
      overlapSeconds.add(previousEndSeconds - segment.startSeconds);
    }
    previousEndSeconds = segment.endSeconds;
    if (segment.target) {
      targetLocations.push({
        targetId: segment.target.targetId,
        versionOrdinal: plan.versionOrdinal,
        segmentOrdinal: segment.ordinal,
        bvid: plan.bvid,
        cid: plan.cid,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
      });
    }
  });

  const finalBodyHash = bodyHash.digest('hex');
  const finalTimelineHash = timelineHash.digest('hex');
  const sourceVersionFingerprint = sha256Hex(canonicalLine({
    contract: MANAGED_FULL_TEXT_CONTRACT,
    scopeKey: plan.scopeKey,
    bodyHash: finalBodyHash,
    timelineHash: finalTimelineHash,
  }));
  const metadataRecord = createMetadataRecord(plan, {
    bodyHash: finalBodyHash,
    timelineHash: finalTimelineHash,
    sourceVersionFingerprint,
  });
  const metadataLine = canonicalLine(metadataRecord);
  const metadataBytes = byteLengthWithLf(metadataLine);
  const serializedBytes = metadataBytes + segmentCanonicalBytes;

  if (serializedBytes !== plan.serializedBytes) {
    throw new Error(`Version byte solver drifted for ${definition.id}#${plan.versionOrdinal}: expected ${plan.serializedBytes}, got ${serializedBytes}`);
  }

  return {
    metadataRecord,
    metadataLine,
    metadataBytes,
    serializedBytes,
    bodyHash: finalBodyHash,
    timelineHash: finalTimelineHash,
    sourceVersionFingerprint,
    bodyBytes,
    timelineBytes,
    segmentCanonicalBytes,
    characterMix,
    segmentLengthBytes,
    segmentRecordLengthBytes,
    overlapSeconds,
    targetLocations,
  };
}

function replayVersionSegments(definition, profile, seed, plan, plantedTargets, globalSegmentOffset, visit) {
  const textRng = createRng(`${seed}|${definition.id}|text|${plan.versionOrdinal}`);
  for (let ordinal = 0; ordinal < plan.segmentCount; ordinal += 1) {
    visit(createVersionSegment(profile, textRng, plan, plantedTargets, globalSegmentOffset, ordinal));
  }
}

async function replayVersionSegmentsAsync(definition, profile, seed, plan, plantedTargets, globalSegmentOffset, visit) {
  const textRng = createRng(`${seed}|${definition.id}|text|${plan.versionOrdinal}`);
  for (let ordinal = 0; ordinal < plan.segmentCount; ordinal += 1) {
    await visit(createVersionSegment(profile, textRng, plan, plantedTargets, globalSegmentOffset, ordinal));
  }
}

function createVersionSegment(profile, textRng, plan, plantedTargets, globalSegmentOffset, ordinal) {
  const target = plantedTargets[globalSegmentOffset + ordinal] ?? null;
  const text = buildSyntheticTextExactBytes(plan.textByteLengths[ordinal], textRng, profile, target?.targetText);
  const timing = plan.timings[ordinal];
  const segmentRecord = {
    record: 'segment',
    contract: MANAGED_FULL_TEXT_CONTRACT,
    ordinal,
    startSeconds: timing.startSeconds,
    endSeconds: timing.endSeconds,
    text: text.value,
  };
  return {
    ordinal,
    startSeconds: timing.startSeconds,
    endSeconds: timing.endSeconds,
    text: text.value,
    textBytes: text.bytes,
    characterMix: text.characterMix,
    target,
    segmentRecord,
  };
}

function createExactVersionPlan(definition, profile, seed, versionOrdinal, targetBytes) {
  const context = createVersionContext(definition, seed, versionOrdinal);
  const segmentCount = findSegmentCountForTarget(profile, context, seed, versionOrdinal, targetBytes);
  const timings = createTimings(profile, seed, definition.id, versionOrdinal, segmentCount);
  const fixedBytes = estimateVersionFixedBytes(context, timings, segmentCount);
  const textBudget = targetBytes - fixedBytes;
  const textByteLengths = distributeTextBytes(profile, seed, definition.id, versionOrdinal, segmentCount, textBudget);

  return {
    ...context,
    versionOrdinal,
    segmentCount,
    timings,
    textByteLengths,
    coverageStartSeconds: timings[0].startSeconds,
    coverageEndSeconds: timings[timings.length - 1].endSeconds,
    serializedBytes: targetBytes,
  };
}

function findSegmentCountForTarget(profile, context, seed, versionOrdinal, targetBytes) {
  const approximateRecordBytes = profile.preferredSegmentTextBytes + 112;
  const approximate = Math.round((targetBytes - 800) / approximateRecordBytes);
  const candidates = createSegmentCountCandidates(
    Math.max(profile.minSegmentsPerVersion, Math.min(profile.maxSegmentsPerVersion, approximate)),
    profile.minSegmentsPerVersion,
    profile.maxSegmentsPerVersion,
  );

  for (const segmentCount of candidates) {
    const timings = createTimings(profile, seed, context.fixtureId, versionOrdinal, segmentCount);
    const fixedBytes = estimateVersionFixedBytes(context, timings, segmentCount);
    const textBudget = targetBytes - fixedBytes;
    if (
      textBudget >= profile.minSegmentTextBytes * segmentCount
      && textBudget <= profile.maxSegmentTextBytes * segmentCount
    ) {
      return segmentCount;
    }
  }

  throw new Error(`Cannot solve an exact version for ${context.fixtureId}#${versionOrdinal} at ${targetBytes} bytes`);
}

function createSegmentCountCandidates(start, min, max) {
  const candidates = [];
  const seen = new Set();
  for (let delta = 0; candidates.length < max - min + 1; delta += 1) {
    for (const value of delta === 0 ? [start] : [start - delta, start + delta]) {
      if (value >= min && value <= max && !seen.has(value)) {
        seen.add(value);
        candidates.push(value);
      }
    }
  }
  return candidates;
}

function getExactVersionBounds(definition, profile, versionOrdinal, seed = DEFAULT_SEED) {
  const context = createVersionContext(definition, seed, versionOrdinal);
  const minTimings = createTimings(profile, seed, definition.id, versionOrdinal, profile.minSegmentsPerVersion);
  const maxTimings = createTimings(profile, seed, definition.id, versionOrdinal, profile.maxSegmentsPerVersion);
  return {
    minBytes: estimateVersionFixedBytes(context, minTimings, profile.minSegmentsPerVersion)
      + profile.minSegmentsPerVersion * profile.minSegmentTextBytes,
    maxBytes: estimateVersionFixedBytes(context, maxTimings, profile.maxSegmentsPerVersion)
      + profile.maxSegmentsPerVersion * profile.maxSegmentTextBytes,
  };
}

function distributeTextBytes(profile, seed, fixtureId, versionOrdinal, segmentCount, textBudget) {
  const minTotal = profile.minSegmentTextBytes * segmentCount;
  const maxExtraPerSegment = profile.maxSegmentTextBytes - profile.minSegmentTextBytes;
  let remainingExtra = textBudget - minTotal;
  if (remainingExtra < 0 || remainingExtra > maxExtraPerSegment * segmentCount) {
    throw new Error('text budget cannot be distributed within the declared profile bounds');
  }

  const rng = createRng(`${seed}|${fixtureId}|lengths|${versionOrdinal}`);
  const lengths = [];
  for (let ordinal = 0; ordinal < segmentCount; ordinal += 1) {
    const remainingSegments = segmentCount - ordinal - 1;
    const minAdd = Math.max(0, remainingExtra - remainingSegments * maxExtraPerSegment);
    const maxAdd = Math.min(maxExtraPerSegment, remainingExtra);
    const preferredAdd = Math.max(
      minAdd,
      Math.min(maxAdd, profile.preferredSegmentTextBytes - profile.minSegmentTextBytes),
    );
    const randomWindow = Math.max(0, Math.min(maxAdd - minAdd, Math.floor(maxExtraPerSegment / 3)));
    const low = Math.max(minAdd, preferredAdd - randomWindow);
    const high = Math.min(maxAdd, preferredAdd + randomWindow);
    const add = low <= high ? rng.integer(low, high) : preferredAdd;
    lengths.push(profile.minSegmentTextBytes + add);
    remainingExtra -= add;
  }

  if (remainingExtra !== 0) {
    throw new Error(`text byte distribution drifted by ${remainingExtra} bytes`);
  }
  return lengths;
}

function createTimings(profile, seed, fixtureId, versionOrdinal, segmentCount) {
  const rng = createRng(`${seed}|${fixtureId}|timing|${versionOrdinal}`);
  const timings = [];
  let cursor = rng.integer(0, 24);
  for (let ordinal = 0; ordinal < segmentCount; ordinal += 1) {
    if (ordinal > 0) {
      const shouldOverlap = rng.integer(1, 1000) <= profile.overlapRatePermille;
      if (shouldOverlap) {
        cursor = Math.max(timings[ordinal - 1].startSeconds, cursor - rng.integer(1, 2));
      } else {
        cursor += rng.integer(0, profile.maxGapSeconds);
      }
    }
    const duration = rng.integer(profile.minSegmentDurationSeconds, profile.maxSegmentDurationSeconds);
    timings.push({
      startSeconds: cursor,
      endSeconds: cursor + duration,
    });
    cursor += duration;
  }
  return timings;
}

function estimateVersionFixedBytes(context, timings, segmentCount) {
  const metadataBytes = byteLengthWithLf(canonicalLine(createMetadataRecord({
    ...context,
    segmentCount,
    coverageStartSeconds: timings[0].startSeconds,
    coverageEndSeconds: timings[timings.length - 1].endSeconds,
  }, {
    bodyHash: ZERO_SHA,
    timelineHash: ZERO_SHA,
    sourceVersionFingerprint: ZERO_SHA,
  })));
  let segmentBytes = 0;
  for (let ordinal = 0; ordinal < segmentCount; ordinal += 1) {
    segmentBytes += byteLengthWithLf(canonicalLine({
      record: 'segment',
      contract: MANAGED_FULL_TEXT_CONTRACT,
      ordinal,
      startSeconds: timings[ordinal].startSeconds,
      endSeconds: timings[ordinal].endSeconds,
      text: '',
    }));
  }
  return metadataBytes + segmentBytes;
}

function createVersionContext(definition, seed, versionOrdinal) {
  const duplicateScopeOfVersionOrdinal = versionOrdinal > 0 && versionOrdinal % 37 === 0
    ? versionOrdinal - 1
    : null;
  const identityOrdinal = duplicateScopeOfVersionOrdinal ?? versionOrdinal;
  const language = identityOrdinal > 0 && identityOrdinal % 17 === 0
    ? 'en'
    : identityOrdinal > 0 && identityOrdinal % 13 === 0
      ? 'und'
      : 'zh-cn';
  const sourceType = definition.targetKind === 'single_version_full_text'
    || (identityOrdinal > 0 && identityOrdinal % 41 === 0)
    ? 'local_transcript'
    : 'bilibili_subtitle';
  const sourceVariantKey = sourceType === 'bilibili_subtitle' && identityOrdinal % 11 === 0
    ? sha256Hex(canonicalLine({
      contract: 'bilibili-subtitle-variant-v1',
      stableTrackId: `synthetic-${definition.id}-${identityOrdinal}`,
      trackType: identityOrdinal % 3,
    }))
    : 'default';
  const bvid = `BV014GATEA${Math.floor(identityOrdinal / 3).toString(36).padStart(7, '0')}`;
  const cid = 1_400_000 + (identityOrdinal % 3);
  const scopeKey = sha256Hex(canonicalLine({
    contract: MANAGED_FULL_TEXT_CONTRACT,
    bvid,
    cid,
    sourceType,
    language,
    sourceVariantKey,
  }));

  return {
    fixtureId: definition.id,
    versionId: deterministicUuid(`${seed}|${definition.id}|version|${versionOrdinal}`),
    duplicateScopeOfVersionOrdinal,
    versionState: duplicateScopeOfVersionOrdinal !== null
      ? 'historical'
      : versionOrdinal > 0 && versionOrdinal % 19 === 0
        ? 'pending_revalidation'
        : 'current',
    scopeKey,
    bvid,
    cid,
    sourceType,
    language,
    languageLabel: language === 'zh-cn' ? '中文' : language === 'en' ? 'English' : null,
    sourceVariantKey,
    originKind: versionOrdinal > 0 && versionOrdinal % 19 === 0 ? 'restored' : 'captured',
    capturedAt: BASE_CAPTURED_AT + versionOrdinal * 60_000,
    createdAt: BASE_CREATED_AT + versionOrdinal * 60_000,
    restoredFromBackupCreatedAt: versionOrdinal > 0 && versionOrdinal % 19 === 0
      ? BASE_CREATED_AT - 86_400_000 + versionOrdinal * 60_000
      : null,
  };
}

function createMetadataRecord(plan, hashes) {
  return {
    record: 'version',
    contract: MANAGED_FULL_TEXT_CONTRACT,
    versionId: plan.versionId,
    scopeKey: plan.scopeKey,
    bvid: plan.bvid,
    cid: plan.cid,
    sourceType: plan.sourceType,
    language: plan.language,
    languageLabel: plan.languageLabel,
    sourceVariantKey: plan.sourceVariantKey,
    sourceVersionFingerprint: hashes.sourceVersionFingerprint,
    bodyHash: hashes.bodyHash,
    timelineHash: hashes.timelineHash,
    segmentCount: plan.segmentCount,
    coverageStartSeconds: plan.coverageStartSeconds,
    coverageEndSeconds: plan.coverageEndSeconds,
    originKind: plan.originKind,
    capturedAt: plan.capturedAt,
    createdAt: plan.createdAt,
    restoredFromBackupCreatedAt: plan.restoredFromBackupCreatedAt,
  };
}

class FixtureReceiptBuilder {
  constructor(definition, seed) {
    this.definition = definition;
    this.seed = seed;
    this.profile = PROFILE_DEFINITIONS[definition.profileKey];
    this.fixtureHash = createHash('sha256');
    this.bodyManifestHash = createHash('sha256');
    this.timelineManifestHash = createHash('sha256');
    this.versionManifestHash = createHash('sha256');
    this.distribution = new DistributionAccumulator();
    this.edgeCases = new EdgeCaseAccumulator();
    this.versionCount = 0;
    this.segmentCount = 0;
    this.totalBytes = 0;
    this.bodyBytes = 0;
    this.timelineBytes = 0;
    this.targetLocations = new Map();
    this.versionSamples = [];
    this.tailVersionSamples = [];
    this.querySuite = null;
    this.plantedTargets = null;
  }

  addVersion(plan, analysis, plantedTargets, globalSegmentOffset) {
    updateLineHash(this.fixtureHash, analysis.metadataLine);
    replayVersionSegments(
      this.definition,
      this.profile,
      this.seed,
      plan,
      plantedTargets,
      globalSegmentOffset,
      segment => updateLineHash(this.fixtureHash, canonicalLine(segment.segmentRecord)),
    );

    updateLineHash(this.bodyManifestHash, canonicalLine({
      versionId: plan.versionId,
      bodyHash: analysis.bodyHash,
      bodyBytes: analysis.bodyBytes,
    }));
    updateLineHash(this.timelineManifestHash, canonicalLine({
      versionId: plan.versionId,
      timelineHash: analysis.timelineHash,
      timelineBytes: analysis.timelineBytes,
    }));
    updateLineHash(this.versionManifestHash, canonicalLine({
      versionId: plan.versionId,
      serializedBytes: analysis.serializedBytes,
      segmentCount: plan.segmentCount,
      versionState: plan.versionState,
      duplicateScopeOfVersionOrdinal: plan.duplicateScopeOfVersionOrdinal,
      sourceType: plan.sourceType,
      sourceVersionFingerprint: analysis.sourceVersionFingerprint,
      bodyHash: analysis.bodyHash,
      timelineHash: analysis.timelineHash,
    }));

    this.versionCount += 1;
    this.segmentCount += plan.segmentCount;
    this.totalBytes += analysis.serializedBytes;
    this.bodyBytes += analysis.bodyBytes;
    this.timelineBytes += analysis.timelineBytes;
    this.distribution.addVersion(plan, analysis);
    this.edgeCases.addVersion(plan, analysis);
    for (const location of analysis.targetLocations) {
      this.targetLocations.set(location.targetId, {
        ...location,
        versionId: plan.versionId,
        sourceVersionFingerprint: analysis.sourceVersionFingerprint,
      });
    }

    const sample = {
      versionOrdinal: plan.versionOrdinal,
      versionId: plan.versionId,
      serializedBytes: analysis.serializedBytes,
      segmentCount: plan.segmentCount,
      versionState: plan.versionState,
      duplicateScopeOfVersionOrdinal: plan.duplicateScopeOfVersionOrdinal,
      sourceType: plan.sourceType,
      bodyHash: analysis.bodyHash,
      timelineHash: analysis.timelineHash,
      sourceVersionFingerprint: analysis.sourceVersionFingerprint,
    };
    if (this.versionSamples.length < 3) {
      this.versionSamples.push(sample);
    }
    this.tailVersionSamples.push(sample);
    if (this.tailVersionSamples.length > 3) {
      this.tailVersionSamples.shift();
    }
  }

  finish(querySuite, plantedTargets) {
    this.querySuite = querySuite;
    this.plantedTargets = plantedTargets;
  }

  toReceipt() {
    if (this.totalBytes !== this.definition.targetCanonicalBytes) {
      throw new Error(`Receipt total bytes mismatch: ${this.totalBytes}`);
    }
    const plantedRetrievalTargets = this.plantedTargets.map(target => {
      const location = this.targetLocations.get(target.targetId);
      if (!location) {
        throw new Error(`Planted target was not placed: ${target.targetId}`);
      }
      return {
        ...target,
        expectedResult: {
          rank: 1,
          fixtureId: this.definition.id,
          versionId: location.versionId,
          versionOrdinal: location.versionOrdinal,
          bvid: location.bvid,
          cid: location.cid,
          sourceVersionFingerprint: location.sourceVersionFingerprint,
          segmentOrdinal: location.segmentOrdinal,
          startSeconds: location.startSeconds,
          endSeconds: location.endSeconds,
        },
      };
    });
    const commonTermDistractorQueries = this.querySuite
      .filter(query => query.kind === 'common_term_distractor')
      .map(query => ({
        queryId: query.queryId,
        kind: query.kind,
        query: query.query,
        expectedResultContract: 'non_unique_common_term_distractor',
      }));
    const querySuiteForHash = [...plantedRetrievalTargets, ...commonTermDistractorQueries]
      .map(query => canonicalLine(query))
      .join('\n');

    return deepFreeze({
      receiptContract: RECEIPT_CONTRACT,
      generatorVersion: GENERATOR_VERSION,
      seed: this.seed,
      fixture: {
        id: this.definition.id,
        description: this.definition.description,
        targetKind: this.definition.targetKind,
        targetCanonicalBytes: this.definition.targetCanonicalBytes,
        profileName: this.definition.profileName,
        managedFullTextContract: MANAGED_FULL_TEXT_CONTRACT,
      },
      generatedArtifactCommitted: false,
      generatedArtifactRelativePath: `${GENERATED_FIXTURE_RELATIVE_DIR}/${this.definition.id}.jsonl`,
      releasePackagingExcluded: true,
      publicSafety: {
        sourceText: 'synthetic_grammar_only',
        containsRealBilibiliSubtitleText: false,
        containsUserHistoryOrFavorites: false,
        containsAccountIdentifiers: false,
        containsCredentialMaterial: false,
        localDistributionMeasurement: INSUFFICIENT_EVIDENCE,
      },
      canonical: {
        totalBytes: this.totalBytes,
        fixtureSha256: this.fixtureHash.digest('hex'),
        bodyManifestSha256: this.bodyManifestHash.digest('hex'),
        timelineManifestSha256: this.timelineManifestHash.digest('hex'),
        versionManifestSha256: this.versionManifestHash.digest('hex'),
        querySuiteSha256: sha256Hex(`${querySuiteForHash}\n`),
        versionCount: this.versionCount,
        segmentCount: this.segmentCount,
        recordCount: this.versionCount + this.segmentCount,
        bodyBytes: this.bodyBytes,
        timelineBytes: this.timelineBytes,
        versionSha256Samples: [...this.versionSamples, ...this.tailVersionSamples]
          .filter((sample, index, samples) => samples.findIndex(item => item.versionId === sample.versionId) === index),
      },
      distributionProfile: this.distribution.toReceipt(this.profile),
      syntheticEdgeCaseProfile: this.edgeCases.toReceipt(),
      malformedRowExclusions: malformedRowExclusionReceipt(),
      querySuiteSummary: summarizeQueries(this.querySuite),
      plantedRetrievalTargetSummary: summarizeQueries(plantedRetrievalTargets),
      plantedRetrievalTargets,
      commonTermDistractorQueries,
      reusableReceiptHelpers: REUSABLE_RECEIPT_HELPER_DESCRIPTORS,
      limitations: [
        {
          status: INSUFFICIENT_EVIDENCE,
          subject: 'real_bilibili_subtitle_representativeness',
          reason: 'No public-safe measured subtitle distribution was supplied to this generator run.',
        },
        {
          status: INSUFFICIENT_EVIDENCE,
          subject: 'maximum_measured_segment_count_tail',
          reason: 'No public-safe measured segment-count tail was supplied to this generator run.',
        },
        {
          status: INSUFFICIENT_EVIDENCE,
          subject: 'browser_timing_memory_indexeddb_restart_failure_metrics',
          reason: 'This receipt freezes deterministic fixture bytes; browser gate runs must fill measurement receipts later.',
        },
      ],
    });
  }
}

class DistributionAccumulator {
  constructor() {
    this.segmentLengthBytes = new BoundedHistogramAccumulator(1);
    this.segmentRecordLengthBytes = new BoundedHistogramAccumulator(1);
    this.segmentsPerVersion = new BoundedHistogramAccumulator(1);
    this.overlapSeconds = new BoundedHistogramAccumulator(1);
    this.versionDurationBuckets = new DurationBucketAccumulator();
    this.characterMix = emptyCharacterMix();
  }

  addVersion(plan, analysis) {
    this.segmentLengthBytes.merge(analysis.segmentLengthBytes);
    this.segmentRecordLengthBytes.merge(analysis.segmentRecordLengthBytes);
    this.segmentsPerVersion.add(plan.segmentCount);
    this.overlapSeconds.merge(analysis.overlapSeconds);
    this.versionDurationBuckets.add(plan.coverageEndSeconds - plan.coverageStartSeconds);
    addCharacterMix(this.characterMix, analysis.characterMix);
  }

  toReceipt(profile) {
    return {
      profileName: profile.name,
      profileDescription: profile.description,
      realBilibiliSubtitleRepresentativeness: {
        status: INSUFFICIENT_EVIDENCE,
        reason: 'Synthetic public-safe generation was used; no measured public-safe Bilibili subtitle sample is attached.',
      },
      maximumMeasuredSegmentCountTail: {
        status: INSUFFICIENT_EVIDENCE,
        reason: 'Synthetic high-fragmentation stress is not a measured real-subtitle maximum tail.',
      },
      segmentLengthBytes: {
        ...this.segmentLengthBytes.toReceipt(),
      },
      canonicalSegmentRecordBytes: {
        ...this.segmentRecordLengthBytes.toReceipt(),
      },
      segmentsPerVersion: {
        ...this.segmentsPerVersion.toReceipt(),
      },
      overlap: {
        overlappingSegmentCount: this.overlapSeconds.count,
        overlapRate: roundRatio(this.overlapSeconds.count, this.segmentLengthBytes.count),
        overlapSeconds: this.overlapSeconds.toReceipt(),
      },
      characterMix: characterMixReceipt(this.characterMix),
      durationBuckets: this.versionDurationBuckets.toReceipt(),
    };
  }
}

class BoundedHistogramAccumulator {
  constructor(bucketSize) {
    this.bucketSize = bucketSize;
    this.count = 0;
    this.min = null;
    this.max = null;
    this.buckets = new Map();
  }

  add(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Histogram values must be non-negative safe integers');
    }
    const bucket = Math.floor(value / this.bucketSize);
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + 1);
    this.count += 1;
    this.min = this.min === null ? value : Math.min(this.min, value);
    this.max = this.max === null ? value : Math.max(this.max, value);
  }

  merge(other) {
    if (other.bucketSize !== this.bucketSize) {
      throw new Error('Cannot merge histograms with different bucket sizes');
    }
    for (const [bucket, count] of other.buckets) {
      this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + count);
    }
    this.count += other.count;
    if (other.min !== null) {
      this.min = this.min === null ? other.min : Math.min(this.min, other.min);
    }
    if (other.max !== null) {
      this.max = this.max === null ? other.max : Math.max(this.max, other.max);
    }
  }

  toReceipt() {
    return {
      accumulator: 'bounded_histogram_v1',
      bucketSize: this.bucketSize,
      count: this.count,
      min: this.min,
      max: this.max,
      bucketCount: this.buckets.size,
      percentiles: this.percentiles(),
    };
  }

  percentiles() {
    if (this.count === 0) {
      return emptyPercentiles();
    }
    const sortedBuckets = [...this.buckets.entries()].sort((a, b) => a[0] - b[0]);
    return {
      p0: this.min,
      p1: this.percentileFromBuckets(sortedBuckets, 0.01),
      p5: this.percentileFromBuckets(sortedBuckets, 0.05),
      p25: this.percentileFromBuckets(sortedBuckets, 0.25),
      p50: this.percentileFromBuckets(sortedBuckets, 0.5),
      p75: this.percentileFromBuckets(sortedBuckets, 0.75),
      p95: this.percentileFromBuckets(sortedBuckets, 0.95),
      p99: this.percentileFromBuckets(sortedBuckets, 0.99),
      p100: this.max,
    };
  }

  percentileFromBuckets(sortedBuckets, rank) {
    const targetOrdinal = Math.round((this.count - 1) * rank);
    let seen = 0;
    for (const [bucket, count] of sortedBuckets) {
      seen += count;
      if (seen > targetOrdinal) {
        return bucket * this.bucketSize;
      }
    }
    return this.max;
  }
}

class DurationBucketAccumulator {
  constructor() {
    this.buckets = {
      under_5m: 0,
      from_5m_to_20m: 0,
      from_20m_to_60m: 0,
      from_60m_to_180m: 0,
      over_180m: 0,
    };
  }

  add(durationSeconds) {
    if (durationSeconds < 5 * 60) {
      this.buckets.under_5m += 1;
    } else if (durationSeconds < 20 * 60) {
      this.buckets.from_5m_to_20m += 1;
    } else if (durationSeconds < 60 * 60) {
      this.buckets.from_20m_to_60m += 1;
    } else if (durationSeconds < 180 * 60) {
      this.buckets.from_60m_to_180m += 1;
    } else {
      this.buckets.over_180m += 1;
    }
  }

  toReceipt() {
    return {
      accumulator: 'bounded_duration_buckets_v1',
      ...this.buckets,
    };
  }
}

class EdgeCaseAccumulator {
  constructor() {
    this.versionStateCounts = {
      current: 0,
      historical: 0,
      pending_revalidation: 0,
    };
    this.originKindCounts = {
      captured: 0,
      restored: 0,
    };
    this.sourceTypeCounts = {
      bilibili_subtitle: 0,
      local_transcript: 0,
    };
    this.languageCounts = {};
    this.sourceVariantCounts = {
      default: 0,
      stable_hash: 0,
    };
    this.videoParts = new Map();
    this.scopeOccurrences = new Map();
    this.duplicateSourceScopePairs = 0;
    this.changedTimelineDuplicateSourcePairs = 0;
    this.unicodeCoverage = {
      cjk: false,
      latin: false,
      number: false,
      punctuation: false,
      fullwidthPunctuation: true,
      loneSurrogateExcluded: true,
    };
  }

  addVersion(plan, analysis) {
    this.versionStateCounts[plan.versionState] += 1;
    this.originKindCounts[plan.originKind] += 1;
    this.sourceTypeCounts[plan.sourceType] += 1;
    this.languageCounts[plan.language] = (this.languageCounts[plan.language] ?? 0) + 1;
    if (plan.sourceVariantKey === 'default') {
      this.sourceVariantCounts.default += 1;
    } else {
      this.sourceVariantCounts.stable_hash += 1;
    }

    if (!this.videoParts.has(plan.bvid)) {
      this.videoParts.set(plan.bvid, new Set());
    }
    this.videoParts.get(plan.bvid).add(plan.cid);

    const previous = this.scopeOccurrences.get(plan.scopeKey);
    if (previous) {
      this.duplicateSourceScopePairs += 1;
      if (previous.timelineHash !== analysis.timelineHash) {
        this.changedTimelineDuplicateSourcePairs += 1;
      }
    }
    this.scopeOccurrences.set(plan.scopeKey, {
      versionId: plan.versionId,
      timelineHash: analysis.timelineHash,
    });

    for (const key of ['cjk', 'latin', 'number', 'punctuation']) {
      this.unicodeCoverage[key] ||= analysis.characterMix[key] > 0;
    }
  }

  toReceipt() {
    let multiPartVideoCount = 0;
    let maxPartsPerVideo = 0;
    for (const parts of this.videoParts.values()) {
      if (parts.size > 1) {
        multiPartVideoCount += 1;
      }
      maxPartsPerVideo = Math.max(maxPartsPerVideo, parts.size);
    }

    return {
      versionStates: this.versionStateCounts,
      originKinds: this.originKindCounts,
      sourceTypes: this.sourceTypeCounts,
      languages: this.languageCounts,
      sourceVariants: this.sourceVariantCounts,
      multiPartVideoCount,
      maxPartsPerVideo,
      duplicateSourceScopePairs: this.duplicateSourceScopePairs,
      changedTimelineDuplicateSourcePairs: this.changedTimelineDuplicateSourcePairs,
      unicodeCoverage: this.unicodeCoverage,
      futureLocalTranscriptRows: {
        status: 'synthetic_schema_load_only',
        rowCount: this.sourceTypeCounts.local_transcript,
        claimsAsrCapability: false,
      },
    };
  }
}

function createQuerySuite() {
  const queries = [];
  for (let index = 1; index <= 50; index += 1) {
    const suffix = chineseOrdinal(index);
    queries.push(plantedQuery(`ce-${index}`, 'chinese_exact', `合成锚点${suffix}`, `合成锚点${suffix}`));
  }
  const terms = [
    ['校准', '轮廓'],
    ['容量', '边界'],
    ['全文', '账本'],
    ['检索', '证据'],
    ['恢复', '检查'],
  ];
  for (let index = 1; index <= 25; index += 1) {
    const [first, second] = terms[(index - 1) % terms.length];
    const suffix = chineseOrdinal(index);
    queries.push(plantedQuery(
      `cm-${index}`,
      'chinese_multi_term',
      `${first} ${second} ${suffix}`,
      `多词目标${suffix}${first}与${second}`,
    ));
  }
  for (let index = 1; index <= 20; index += 1) {
    const label = index.toString().padStart(2, '0');
    queries.push(plantedQuery(
      `mx-${index}`,
      'mixed_cjk_latin',
      `GateAlpha${label} 混合`,
      `GateAlpha${label}混合锚点`,
    ));
  }
  for (let index = 1; index <= 20; index += 1) {
    const label = index.toString().padStart(2, '0');
    queries.push(plantedQuery(
      `en-${index}`,
      'english',
      `public gate anchor ${label}`,
      `public-gate-anchor-${label}`,
    ));
  }
  for (let index = 1; index <= 10; index += 1) {
    const label = index.toString().padStart(2, '0');
    queries.push(plantedQuery(
      `pn-${index}`,
      'punctuation_number',
      `GATE-014-A ${label} 500MiB`,
      `GATE-014-A#${label}/500MiB`,
    ));
  }
  for (let index = 1; index <= 20; index += 1) {
    queries.push({
      queryId: `cd-${index}`,
      kind: 'common_term_distractor',
      query: ['公开', '合成', '本地', '片段', '容量'][index % 5],
      planted: false,
    });
  }
  return queries;
}

function plantedQuery(targetId, kind, query, targetText) {
  return {
    targetId,
    queryId: targetId,
    kind,
    query,
    targetText,
    planted: true,
    expectedResultContract: 'unique_exact_target_rank_1',
  };
}

function summarizeQueries(queries) {
  const byKind = {};
  for (const query of queries) {
    byKind[query.kind] = (byKind[query.kind] ?? 0) + 1;
  }
  return {
    total: queries.length,
    byKind,
  };
}

function malformedCandidate(candidateId, expectedReasonCode, overrides) {
  return {
    candidateId,
    expectedReasonCode,
    candidate: {
      bvid: 'BV014GATEA0000000',
      cid: 1_400_001,
      ordinal: 0,
      startSeconds: 0,
      endSeconds: 1,
      text: '公开安全 malformed control 01',
      ...overrides,
    },
  };
}

export function validateManagedFullTextCandidate(candidate) {
  assertAllowedObjectFields(candidate, [
    'bvid',
    'cid',
    'ordinal',
    'startSeconds',
    'endSeconds',
    'text',
  ], 'managed full-text candidate', 'unsupported candidate field');

  let reasonCode = null;
  if (
    typeof candidate.bvid !== 'string'
    || !/^BV[0-9A-Za-z]{1,62}$/.test(candidate.bvid)
    || !Number.isSafeInteger(candidate.cid)
    || candidate.cid < 1
    || !Number.isSafeInteger(candidate.ordinal)
    || candidate.ordinal < 0
  ) {
    reasonCode = 'invalid_identity';
  } else if (typeof candidate.text !== 'string' || candidate.text.length === 0) {
    reasonCode = 'empty_text';
  } else if (!isWellFormedString(candidate.text)) {
    reasonCode = 'lone_surrogate';
  } else if (
    typeof candidate.startSeconds !== 'number'
    || typeof candidate.endSeconds !== 'number'
    || !Number.isFinite(candidate.startSeconds)
    || !Number.isFinite(candidate.endSeconds)
  ) {
    reasonCode = 'non_finite_timing';
  } else if (Object.is(candidate.startSeconds, -0) || Object.is(candidate.endSeconds, -0)) {
    reasonCode = 'negative_zero';
  } else if (
    candidate.startSeconds < 0
    || candidate.endSeconds < 0
    || candidate.endSeconds <= candidate.startSeconds
  ) {
    reasonCode = 'invalid_timing';
  }

  if (reasonCode) {
    return deepFreeze({
      accepted: false,
      reasonCode,
      canonicalLine: null,
      canonicalBytes: 0,
    });
  }

  const serialized = canonicalLine({
    record: 'segment',
    contract: MANAGED_FULL_TEXT_CONTRACT,
    ordinal: candidate.ordinal,
    startSeconds: candidate.startSeconds,
    endSeconds: candidate.endSeconds,
    text: candidate.text,
  });
  return deepFreeze({
    accepted: true,
    reasonCode: null,
    canonicalLine: serialized,
    canonicalBytes: byteLengthWithLf(serialized),
  });
}

function malformedRowExclusionReceipt() {
  const byReason = {};
  const publicSafeProjection = [];
  let actualRejectedCount = 0;
  let emittedRecordCount = 0;
  let emittedCanonicalBytes = 0;
  for (const testCase of MALFORMED_CANDIDATE_SUITE) {
    const result = validateManagedFullTextCandidate(testCase.candidate);
    if (result.accepted) {
      emittedRecordCount += 1;
      emittedCanonicalBytes += result.canonicalBytes;
      continue;
    }
    if (result.reasonCode !== testCase.expectedReasonCode) {
      throw new Error(`Malformed candidate classification drifted: ${testCase.candidateId}`);
    }
    actualRejectedCount += 1;
    byReason[result.reasonCode] = (byReason[result.reasonCode] ?? 0) + 1;
    publicSafeProjection.push({
      candidateId: testCase.candidateId,
      reasonCode: result.reasonCode,
    });
  }
  if (emittedRecordCount !== 0 || emittedCanonicalBytes !== 0) {
    throw new Error('Malformed candidate suite emitted canonical records');
  }
  const suiteBody = publicSafeProjection
    .map(candidate => canonicalLine(candidate))
    .join('\n');

  return {
    suiteContract: 'gate-014-malformed-candidate-suite-v2',
    candidateCount: MALFORMED_CANDIDATE_SUITE.length,
    actualRejectedCount,
    total: actualRejectedCount,
    byReason,
    candidateIds: publicSafeProjection.map(candidate => candidate.candidateId),
    emittedRecordCount,
    emittedCanonicalBytes,
    candidateSuiteSha256: sha256Hex(`${suiteBody}\n`),
    exclusionStage: 'pre_canonical_validation',
    hashProjectionFields: ['candidateId', 'reasonCode'],
  };
}

function buildSyntheticTextExactBytes(targetBytes, rng, profile, cue = null) {
  const chunks = [];
  const mix = emptyCharacterMix();
  let remaining = targetBytes;

  if (cue) {
    addChunk(cue, chunks, mix);
    remaining -= byteLength(cue);
    if (remaining < 0) {
      throw new Error(`Planted cue exceeds segment byte target: ${cue}`);
    }
    if (remaining >= 3) {
      addChunk('，', chunks, mix);
      remaining -= 3;
    }
  }

  while (remaining > 0) {
    if (remaining <= 12) {
      const tail = asciiTail(remaining, rng);
      addChunk(tail, chunks, mix);
      remaining = 0;
      break;
    }
    const candidates = profile.textUnits.filter(unit => unit.bytes <= remaining - 12 || unit.bytes === remaining);
    const unit = candidates.length > 0
      ? weightedPick(candidates, rng)
      : { text: asciiTail(Math.min(remaining, 12), rng), weight: 1 };
    addChunk(unit.text, chunks, mix);
    remaining -= byteLength(unit.text);
  }

  const value = chunks.join('');
  const bytes = byteLength(value);
  if (bytes !== targetBytes) {
    throw new Error(`Synthetic text byte solver drifted: expected ${targetBytes}, got ${bytes}`);
  }
  assertWellFormedString(value);
  return {
    value,
    bytes,
    characterMix: mix,
  };
}

function baselineTextUnits() {
  return [
    weightedUnit('本段为公开安全合成语料，用于校准本地知识库容量账本。', 10),
    weightedUnit('字幕片段保持时间顺序，允许少量来源重叠，不补造缺失间隔。', 8),
    weightedUnit('local ledger gate uses deterministic public text and bounded streaming receipts. ', 6),
    weightedUnit('version 014 target 100 400 500 MiB records remain reproducible. ', 5),
    weightedUnit('检索目标只作为公开锚点，不代表真实视频措辞。', 7),
    weightedUnit('alpha beta gamma delta epsilon ', 4),
    weightedUnit('，。；：、（）-/', 3),
    weightedUnit(' 0123456789 ', 3),
  ];
}

function highFragmentationTextUnits() {
  return [
    weightedUnit('短句。', 8),
    weightedUnit('公开片段，', 7),
    weightedUnit('local ', 4),
    weightedUnit('014 ', 3),
    weightedUnit('，', 2),
    weightedUnit('。', 2),
    weightedUnit('A1 ', 2),
  ];
}

function weightedUnit(text, weight) {
  return Object.freeze({
    text,
    weight,
    bytes: byteLength(text),
  });
}

function weightedPick(units, rng) {
  const total = units.reduce((sum, unit) => sum + unit.weight, 0);
  let cursor = rng.integer(1, total);
  for (const unit of units) {
    cursor -= unit.weight;
    if (cursor <= 0) {
      return unit;
    }
  }
  return units[units.length - 1];
}

function addChunk(chunk, chunks, mix) {
  chunks.push(chunk);
  addCharacterMix(mix, measureCharacterMix(chunk));
}

function asciiTail(length, rng) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += alphabet[rng.integer(0, alphabet.length - 1)];
  }
  return output;
}

function emptyCharacterMix() {
  return {
    cjk: 0,
    latin: 0,
    number: 0,
    punctuation: 0,
    space: 0,
    other: 0,
  };
}

function addCharacterMix(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] ?? 0;
  }
}

function measureCharacterMix(value) {
  const mix = emptyCharacterMix();
  for (const char of value) {
    if (/[\u3400-\u9fff]/u.test(char)) {
      mix.cjk += 1;
    } else if (/[A-Za-z]/u.test(char)) {
      mix.latin += 1;
    } else if (/[0-9]/u.test(char)) {
      mix.number += 1;
    } else if (/\s/u.test(char)) {
      mix.space += 1;
    } else if (/[\p{P}\p{S}]/u.test(char)) {
      mix.punctuation += 1;
    } else {
      mix.other += 1;
    }
  }
  return mix;
}

function characterMixReceipt(mix) {
  const total = Object.values(mix).reduce((sum, count) => sum + count, 0);
  const receipt = { totalCodePoints: total };
  for (const [key, count] of Object.entries(mix)) {
    receipt[key] = {
      count,
      proportion: roundRatio(count, total),
    };
  }
  return receipt;
}

function emptyPercentiles() {
  return {
    p0: null,
    p1: null,
    p5: null,
    p25: null,
    p50: null,
    p75: null,
    p95: null,
    p99: null,
    p100: null,
  };
}

function roundRatio(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1_000_000) / 1_000_000;
}

function createRng(seed) {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
    integer(min, max) {
      if (max < min) {
        throw new Error(`Invalid RNG range: ${min}..${max}`);
      }
      return min + Math.floor(this.next() * (max - min + 1));
    },
  };
}

function deterministicUuid(input) {
  const bytes = createHash('sha256').update(input).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function chineseOrdinal(value) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  return value.toString().padStart(2, '0').split('').map(digit => digits[Number(digit)]).join('');
}

function canonicalLine(value) {
  return JSON.stringify(value);
}

function updateLineHash(hash, line) {
  hash.update(line);
  hash.update('\n');
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function byteLengthWithLf(value) {
  return byteLength(value) + 1;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return {
    bytes,
    sha256: hash.digest('hex'),
  };
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function resolveCleanupDirectory(options) {
  return resolveKnownRepositoryDirectory(
    options.repositoryRoot,
    GENERATED_FIXTURE_RELATIVE_DIR,
    'Refusing to clean unsafe GATE-014 fixture directory',
  );
}

async function resolveKnownRepositoryDirectory(repositoryRootOption, relativeDirectory, errorMessage) {
  const repositoryRoot = path.resolve(repositoryRootOption ?? REPOSITORY_ROOT);
  if (normalizePathForCompare(repositoryRoot) === normalizePathForCompare(path.parse(repositoryRoot).root)) {
    throw new Error(errorMessage);
  }

  let repositoryStats;
  try {
    repositoryStats = await lstat(repositoryRoot);
  } catch {
    throw new Error(errorMessage);
  }
  if (!repositoryStats.isDirectory() || repositoryStats.isSymbolicLink()) {
    throw new Error(errorMessage);
  }

  const repositoryRealPath = await realpath(repositoryRoot);
  await assertRepositoryRootMarker(repositoryRoot, repositoryRealPath, errorMessage);
  const components = relativeDirectory.split('/');
  if (components.some(component => !component || component === '.' || component === '..')) {
    throw new Error(errorMessage);
  }
  let currentPath = repositoryRoot;
  let expectedRealPath = repositoryRealPath;
  for (const component of components) {
    currentPath = path.join(currentPath, component);
    expectedRealPath = path.join(expectedRealPath, component);
    try {
      await mkdir(currentPath);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw new Error(errorMessage);
      }
    }
    const stats = await lstat(currentPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(errorMessage);
    }
    const currentRealPath = await realpath(currentPath);
    if (normalizePathForCompare(currentRealPath) !== normalizePathForCompare(expectedRealPath)) {
      throw new Error(errorMessage);
    }
  }

  const finalRealPath = await realpath(currentPath);
  const realRelativePath = path.relative(repositoryRealPath, finalRealPath);
  if (
    path.isAbsolute(realRelativePath)
    || realRelativePath === '..'
    || realRelativePath.startsWith(`..${path.sep}`)
    || normalizePathForCompare(realRelativePath) !== normalizePathForCompare(relativeDirectory)
  ) {
    throw new Error(errorMessage);
  }
  return currentPath;
}

async function assertRepositoryRootMarker(repositoryRoot, repositoryRealPath, errorMessage) {
  const packagePath = path.join(repositoryRoot, 'package.json');
  let packageStats;
  try {
    packageStats = await lstat(packagePath);
  } catch {
    throw new Error(errorMessage);
  }
  if (!packageStats.isFile() || packageStats.isSymbolicLink()) {
    throw new Error(errorMessage);
  }
  const packageRealPath = await realpath(packagePath);
  if (
    normalizePathForCompare(packageRealPath)
    !== normalizePathForCompare(path.join(repositoryRealPath, 'package.json'))
  ) {
    throw new Error(errorMessage);
  }
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'));
  } catch {
    throw new Error(errorMessage);
  }
  if (
    !packageMetadata
    || typeof packageMetadata !== 'object'
    || Array.isArray(packageMetadata)
    || packageMetadata.name !== 'bili-bill'
    || packageMetadata.private !== true
  ) {
    throw new Error(errorMessage);
  }
}

function normalizePathForCompare(targetPath) {
  return path.resolve(targetPath).replaceAll('\\', '/').toLowerCase();
}

function isKnownGeneratedTempArtifactName(name) {
  const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  for (const definition of FIXTURE_DEFINITIONS) {
    const escapedId = definition.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^\\.${escapedId}\\.[0-9]+\\.${uuidPattern}\\.tmp$`, 'i').test(name)) {
      return true;
    }
  }
  return false;
}

function assertInjectionPoint(value, allowedValues, label) {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    throw new Error(`${label} injection point must use a closed value`);
  }
}

function assertWellFormedString(value) {
  if (!isWellFormedString(value)) {
    throw new Error('Synthetic text contains a lone surrogate');
  }
}

function isWellFormedString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertAllowedObjectFields(
  value,
  allowedFields,
  label,
  unsupportedFieldPrefix = `${label} received unsupported field`,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`${unsupportedFieldPrefix}: ${field}`);
    }
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (args.cleanupGenerated) {
    const receipt = await cleanupGeneratedFixtureArtifacts();
    console.log(JSON.stringify({
      generatorVersion: GENERATOR_VERSION,
      cleanupGenerated: true,
      receipt,
    }, null, 2));
    return;
  }

  const definitions = args.fixture === 'all'
    ? FIXTURE_DEFINITIONS
    : FIXTURE_DEFINITIONS.filter(definition => definition.id === args.fixture);
  if (definitions.length === 0) {
    throw new Error(`Unknown fixture id: ${args.fixture}`);
  }

  const summaries = [];
  for (const definition of definitions) {
    const artifactResult = args.writeArtifacts
      ? await writeFixtureArtifact(definition, { seed: args.seed })
      : null;
    const receiptResult = artifactResult
      ? await publishGoldenReceipt(definition, artifactResult.receipt)
      : await writeGoldenFixtureReceipt(definition, { seed: args.seed });
    summaries.push({
      fixtureId: definition.id,
      receiptPath: path.relative(REPOSITORY_ROOT, receiptResult.receiptPath).replaceAll('\\', '/'),
      receiptSha256: receiptResult.receiptSha256,
      bytes: receiptResult.receipt.canonical.totalBytes,
      sha256: receiptResult.receipt.canonical.fixtureSha256,
      artifactPath: artifactResult
        ? path.relative(REPOSITORY_ROOT, artifactResult.artifactPath).replaceAll('\\', '/')
        : null,
    });
  }
  console.log(JSON.stringify({
    generatorVersion: GENERATOR_VERSION,
    seed: args.seed,
    writeArtifacts: args.writeArtifacts,
    receipts: summaries,
  }, null, 2));
}

function parseArgs(argv) {
  const result = {
    fixture: 'all',
    seed: DEFAULT_SEED,
    writeArtifacts: false,
    cleanupGenerated: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--fixture') {
      result.fixture = argv[++index];
    } else if (arg === '--seed') {
      result.seed = argv[++index];
    } else if (arg === '--write-artifacts') {
      result.writeArtifacts = true;
    } else if (arg === '--cleanup-generated') {
      result.cleanupGenerated = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/gate-014-fixture-generator.mjs [options]

Options:
  --fixture <id|all>       Fixture to generate receipts for. Default: all
  --seed <seed>            Deterministic public-safe seed. Default: ${DEFAULT_SEED}
  --write-artifacts        Also write JSONL fixtures under ${GENERATED_FIXTURE_RELATIVE_DIR}. Opt-in only.
  --cleanup-generated      Remove only known generated GATE-014 JSONL/temp artifacts.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
