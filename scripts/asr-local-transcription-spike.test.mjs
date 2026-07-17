import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cancelReadAfterFirstChunk,
  createOwnedSpikeTempRoot,
  evaluateModelRuntimeEvidence,
  evaluatePublicSampleEvidence,
  fetchRangeEvidence,
  isOwnedSpikeTempRoot,
  removeOwnedSpikeTempRoot,
  streamAndDiscard,
  summarizeHarnessGates,
  summarizePublicSampleEvidence,
  verifyOwnedSpikeTempRoot,
  validateModelRevision,
  validateMv3SpikeResult
} from './asr-local-transcription-spike.mjs';

async function closeTestServer(server) {
  server.closeAllConnections();
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => (error ? rejectClose(error) : resolveClose()));
  });
}

function validPublicSampleEvidence({ long = false } = {}) {
  const durationSeconds = long ? 5_400 : 600;
  const sample = {
    id: long ? 'long-sample' : 'short-sample',
    bvid: 'BV1PublicGateTest',
    cid: '12345',
    expectedTitle: '固定公开样本',
    expectedDurationSeconds: durationSeconds,
    expectedAudioCodec: 'mp4a.40.2',
    expectedAudioMime: 'video/mp4',
    requireLongDuration: long,
    requireFullStream: long
  };
  return {
    sample,
    view: {
      httpStatus: 200,
      apiCode: 0,
      bvid: sample.bvid,
      title: sample.expectedTitle,
      durationSeconds,
      currentPageCid: sample.cid,
      currentPageDurationSeconds: durationSeconds
    },
    subtitle: { httpStatus: 200, apiCode: 0, count: 0 },
    playurl: { httpStatus: 200, apiCode: 0, audioCount: 1, firstAudioCodec: sample.expectedAudioCodec },
    range: {
      status: 206,
      contentType: sample.expectedAudioMime,
      contentRange: 'bytes 0-3/10',
      contentLength: '4',
      contentLengthBytes: 4,
      rangeStart: 0,
      rangeEnd: 3,
      totalBytes: 10,
      firstChunkBytes: 4,
      bytesRead: 4,
      bodyComplete: true,
      readError: null
    },
    cancellation: {
      result: 'AbortError:This operation was aborted',
      aborted: true,
      abortReason: 'after-first-chunk',
      status: 206,
      bytesReadBeforeAbort: 4
    },
    fullStream: long
      ? {
          status: 200,
          contentType: sample.expectedAudioMime,
          contentRange: null,
          contentLength: '10',
          contentLengthBytes: 10,
          rangeStart: null,
          rangeEnd: null,
          totalBytes: null,
          firstChunkBytes: 10,
          bytesRead: 10,
          bodyComplete: true,
          readError: null
        }
      : null
  };
}

function validModelRuntimeEvidence() {
  const expectedFiles = Array.from({ length: 12 }, (_, index) => ({
    file: `file-${index}.bin`,
    size: index + 1,
    hash: index < 2 ? String(index + 1).repeat(64) : String(index + 1).slice(-1).repeat(40),
    hashAlgorithm: index < 2 ? 'sha256' : 'git-blob-sha1'
  }));
  const candidate = {
    runtimePackage: '@example/runtime',
    runtimeVersion: '1.2.3',
    runtimeLicense: 'Apache-2.0',
    modelId: 'example/model',
    modelRevision: '0123456789abcdef0123456789abcdef01234567',
    modelLicense: 'apache-2.0',
    expectedSelectedTotalBytes: 78
  };
  return {
    candidate,
    expectedFiles,
    evidence: {
      runtime: {
        httpStatus: 200,
        name: candidate.runtimePackage,
        version: candidate.runtimeVersion,
        license: candidate.runtimeLicense
      },
      model: {
        httpStatus: 200,
        id: candidate.modelId,
        sha: candidate.modelRevision,
        license: candidate.modelLicense,
        selectedFiles: expectedFiles.map(file => ({ ...file, present: true })),
        selectedTotalBytes: candidate.expectedSelectedTotalBytes
      }
    }
  };
}

test('runtime/model gate requires successful identities, licenses, all 12 hashes, and exact total bytes', () => {
  const valid = validModelRuntimeEvidence();
  assert.equal(evaluateModelRuntimeEvidence(valid.evidence, valid.candidate, valid.expectedFiles).ok, true);

  const badRuntime = structuredClone(valid.evidence);
  badRuntime.runtime.httpStatus = 503;
  badRuntime.runtime.license = null;
  const badRuntimeGate = evaluateModelRuntimeEvidence(badRuntime, valid.candidate, valid.expectedFiles);
  assert.equal(badRuntimeGate.ok, false);
  assert.equal(badRuntimeGate.checks.runtimeHttpOk, false);
  assert.equal(badRuntimeGate.checks.runtimeLicenseMatches, false);

  const badModel = structuredClone(valid.evidence);
  badModel.model.httpStatus = 404;
  badModel.model.sha = 'main';
  badModel.model.license = null;
  const badModelGate = evaluateModelRuntimeEvidence(badModel, valid.candidate, valid.expectedFiles);
  assert.equal(badModelGate.ok, false);
  assert.equal(badModelGate.checks.modelHttpOk, false);
  assert.equal(badModelGate.checks.modelRevisionMatches, false);
  assert.equal(badModelGate.checks.modelLicenseMatches, false);

  const badFiles = structuredClone(valid.evidence);
  badFiles.model.selectedFiles[4].hash = null;
  badFiles.model.selectedTotalBytes -= 1;
  const badFilesGate = evaluateModelRuntimeEvidence(badFiles, valid.candidate, valid.expectedFiles);
  assert.equal(badFilesGate.ok, false);
  assert.equal(badFilesGate.checks.selectedFilesMatch, false);
  assert.equal(badFilesGate.checks.selectedTotalBytesMatch, false);
  assert.equal(badFilesGate.fileChecks['file-4.bin'].hashMatches, false);
});

test('public sample gate requires every declared identity, media, cancellation, and length check', () => {
  const shortGate = evaluatePublicSampleEvidence(validPublicSampleEvidence());
  const longGate = evaluatePublicSampleEvidence(validPublicSampleEvidence({ long: true }));

  assert.equal(shortGate.ok, true);
  assert.equal(longGate.ok, true);

  const wrongPage = validPublicSampleEvidence();
  wrongPage.view = {
    ...wrongPage.view,
    httpStatus: 404,
    apiCode: -404,
    title: '错误页面',
    currentPageCid: 'other-cid'
  };
  const wrongPageGate = evaluatePublicSampleEvidence(wrongPage);
  assert.equal(wrongPageGate.ok, false);
  assert.equal(wrongPageGate.checks.viewHttpOk, false);
  assert.equal(wrongPageGate.checks.titleMatches, false);
  assert.equal(wrongPageGate.checks.currentCidMatches, false);

  const truncatedLong = validPublicSampleEvidence({ long: true });
  truncatedLong.fullStream = {
    ...truncatedLong.fullStream,
    firstChunkBytes: 3,
    bytesRead: 3,
    bodyComplete: false,
    readError: 'TypeError:terminated'
  };
  const truncatedGate = evaluatePublicSampleEvidence(truncatedLong);
  assert.equal(truncatedGate.ok, false);
  assert.equal(truncatedGate.checks.fullStreamComplete, false);
  assert.equal(truncatedGate.checks.fullStreamLengthMatches, false);
});

test('local media probes reject error pages, empty bodies, and truncated content', async t => {
  const server = createServer((request, response) => {
    if (request.url === '/error') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': '10' });
      response.end('error page');
      return;
    }
    if (request.url === '/empty') {
      response.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes */0',
        'Content-Length': '0'
      });
      response.end();
      return;
    }
    response.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': 'bytes 0-9/10',
      'Content-Length': '10'
    });
    response.end(Buffer.from([1, 2, 3]));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const sample = { bvid: 'BV1LocalMediaGateTest' };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const errorPage = await fetchRangeEvidence(sample, `${baseUrl}/error`, 9);
  const empty = await fetchRangeEvidence(sample, `${baseUrl}/empty`, 9);
  const truncated = await streamAndDiscard(sample, `${baseUrl}/truncated`);

  const errorEvidence = validPublicSampleEvidence();
  errorEvidence.range = errorPage;
  const emptyEvidence = validPublicSampleEvidence();
  emptyEvidence.range = empty;
  const truncatedEvidence = validPublicSampleEvidence({ long: true });
  truncatedEvidence.fullStream = truncated;

  assert.equal(evaluatePublicSampleEvidence(errorEvidence).ok, false);
  assert.equal(evaluatePublicSampleEvidence(emptyEvidence).checks.rangeFirstChunkNonEmpty, false);
  assert.equal(evaluatePublicSampleEvidence(truncatedEvidence).ok, false);
});

test('harness overall is false when any requested machine gate fails while decision remains no-go', () => {
  const passed = summarizeHarnessGates({
    mv3Only: false,
    publicSamplesGate: { ok: true },
    modelRuntimeGate: { ok: true },
    mv3Gate: { ok: true }
  });
  const failed = summarizeHarnessGates({
    mv3Only: false,
    publicSamplesGate: { ok: false },
    modelRuntimeGate: { ok: true },
    mv3Gate: { ok: true }
  });

  assert.equal(passed.ok, true);
  assert.equal(passed.decision, 'no-go');
  assert.equal(passed.asrProductGatesOk, false);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.failedGates, ['publicSamples']);
});

test('public sample summary cannot pass when one sample gate fails', () => {
  const passed = validPublicSampleEvidence();
  passed.gate = evaluatePublicSampleEvidence(passed);
  const failed = validPublicSampleEvidence();
  failed.sample = { ...failed.sample, id: 'failed-sample' };
  failed.range = { ...failed.range, firstChunkBytes: 0, bytesRead: 0 };
  failed.gate = evaluatePublicSampleEvidence(failed);

  const summary = summarizePublicSampleEvidence([passed, failed], 2);

  assert.equal(summary.ok, false);
  assert.equal(summary.passedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.deepEqual(summary.failedSampleIds, ['failed-sample']);
});

test('MV3 result requires the exact run marker and real WASM/worker evidence', () => {
  const marker = 'run-marker-123';
  const validResult = {
    marker,
    phase: 'completed',
    response: {
      marker,
      ok: true,
      wasmAdd: 5,
      workerResult: { marker, firstByte: 7, released: true }
    }
  };

  assert.equal(validateMv3SpikeResult(validResult, marker).ok, true);
  assert.equal(validateMv3SpikeResult(null, marker).ok, false);
  assert.equal(validateMv3SpikeResult({ ...validResult, marker: 'other-run' }, marker).ok, false);
  assert.equal(
    validateMv3SpikeResult({ ...validResult, response: { marker, ok: true } }, marker).ok,
    false
  );
});

test('model metadata must identify the declared repository and exact revision', () => {
  const candidate = {
    modelId: 'Xenova/whisper-tiny',
    modelRevision: '5332fcc35e32a33b86612b9a57a89be7906102b1'
  };

  assert.deepEqual(validateModelRevision({ id: candidate.modelId, sha: candidate.modelRevision }, candidate), {
    modelIdVerified: true,
    revisionVerified: true,
    verified: true
  });
  assert.equal(validateModelRevision({ id: candidate.modelId, sha: 'main' }, candidate).verified, false);
  assert.equal(validateModelRevision({ id: 'other/model', sha: candidate.modelRevision }, candidate).verified, false);
});

test('cleanup ownership accepts only direct spike roots created under the system temp directory', () => {
  const owned = join(tmpdir(), 'bili-bill-asr-spike-abc123');

  assert.equal(isOwnedSpikeTempRoot(owned), true);
  assert.equal(isOwnedSpikeTempRoot(join(owned, 'edge-profile')), false);
  assert.equal(isOwnedSpikeTempRoot(join(tmpdir(), 'unrelated-profile')), false);
});

test('owned temp root deletion requires the exact random marker and removes only that root', async () => {
  const owned = await createOwnedSpikeTempRoot();
  const verification = await verifyOwnedSpikeTempRoot(owned.path, owned.marker);
  assert.equal(verification.ok, true);

  const removal = await removeOwnedSpikeTempRoot(owned.path, owned.marker);
  assert.equal(removal.removed, true);
  await assert.rejects(access(owned.path));
});

test('owned temp root deletion refuses a wrong marker and a same-prefix unrelated directory', async t => {
  const owned = await createOwnedSpikeTempRoot();
  const unrelated = await mkdtemp(join(tmpdir(), 'bili-bill-asr-spike-'));
  t.after(async () => {
    await rm(owned.path, { recursive: true, force: true });
    await rm(unrelated, { recursive: true, force: true });
  });

  const wrongMarker = await removeOwnedSpikeTempRoot(owned.path, 'wrong-marker');
  const missingMarker = await removeOwnedSpikeTempRoot(unrelated, owned.marker);

  assert.equal(wrongMarker.removed, false);
  assert.equal(wrongMarker.verification.checks.markerMatches, false);
  assert.equal(missingMarker.removed, false);
  assert.equal(missingMarker.verification.checks.markerExists, false);
  await access(owned.path);
  await access(unrelated);
});

test('owned temp root deletion refuses linked roots and linked marker replacements', async t => {
  const linkTarget = await mkdtemp(join(tmpdir(), 'bili-bill-asr-link-target-'));
  const rootLink = join(tmpdir(), `bili-bill-asr-spike-link-${process.pid}-${Date.now()}`);
  await symlink(linkTarget, rootLink, 'junction');
  const owned = await createOwnedSpikeTempRoot();
  const markerLinkTarget = await mkdtemp(join(tmpdir(), 'bili-bill-asr-marker-target-'));
  await rm(owned.markerPath, { force: true });
  await symlink(markerLinkTarget, owned.markerPath, 'junction');
  t.after(async () => {
    await rm(rootLink, { recursive: true, force: true });
    await rm(linkTarget, { recursive: true, force: true });
    await rm(owned.path, { recursive: true, force: true });
    await rm(markerLinkTarget, { recursive: true, force: true });
  });

  const linkedRoot = await removeOwnedSpikeTempRoot(rootLink, owned.marker);
  const linkedMarker = await removeOwnedSpikeTempRoot(owned.path, owned.marker);

  assert.equal(linkedRoot.removed, false);
  assert.equal(linkedRoot.verification.checks.rootNotSymbolicLink, false);
  assert.equal(linkedMarker.removed, false);
  assert.equal(linkedMarker.verification.checks.markerNotSymbolicLink, false);
  await access(linkTarget);
  await access(owned.path);
});

test('cancellation keeps reading until AbortController produces AbortError', async t => {
  const server = createServer((_request, response) => {
    response.writeHead(206, {
      'Content-Type': 'audio/mp4',
      'Content-Range': 'bytes 0-52428799/52428800'
    });
    const chunk = Buffer.alloc(64 * 1024, 1);
    const timer = setInterval(() => response.write(chunk), 5);
    response.on('close', () => clearInterval(timer));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));

  const address = server.address();
  assert.equal(typeof address, 'object');
  const result = await cancelReadAfterFirstChunk(
    { bvid: 'BV1LocalCancellationTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`
  );

  assert.equal(result.aborted, true);
  assert.match(result.result, /^AbortError:/);
  assert.ok(result.bytesReadBeforeAbort > 0);
});

test('a normally resolved 206 response is not cancellation evidence', async t => {
  const server = createServer((_request, response) => {
    response.writeHead(206, {
      'Content-Type': 'audio/mp4',
      'Content-Range': 'bytes */0'
    });
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));

  const address = server.address();
  assert.equal(typeof address, 'object');
  const result = await cancelReadAfterFirstChunk(
    { bvid: 'BV1LocalResolvedTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`
  );

  assert.equal(result.result, 'resolved:206');
  assert.equal(result.aborted, false);
});

test('a safety timeout before the first chunk is not cancellation evidence', async t => {
  const server = createServer((_request, response) => {
    response.writeHead(206, {
      'Content-Type': 'audio/mp4',
      'Content-Range': 'bytes 0-52428799/52428800'
    });
    response.flushHeaders();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));

  const address = server.address();
  assert.equal(typeof address, 'object');
  const result = await cancelReadAfterFirstChunk(
    { bvid: 'BV1LocalNoFirstChunkTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`,
    { safetyTimeoutMs: 25 }
  );

  assert.match(result.result, /^AbortError:/);
  assert.equal(result.abortReason, 'safety-timeout');
  assert.equal(result.status, 206);
  assert.equal(result.bytesReadBeforeAbort, 0);
  assert.equal(result.aborted, false);
});

test('a safety timeout before response headers keeps status null and aborted false', async t => {
  const server = createServer(() => {
    // Intentionally withhold headers and body until the client safety timeout aborts.
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));

  const address = server.address();
  assert.equal(typeof address, 'object');
  const result = await cancelReadAfterFirstChunk(
    { bvid: 'BV1LocalNoHeadersTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`,
    { safetyTimeoutMs: 25 }
  );

  assert.match(result.result, /^AbortError:/);
  assert.equal(result.abortReason, 'safety-timeout');
  assert.equal(result.status, null);
  assert.equal(result.bytesReadBeforeAbort, 0);
  assert.equal(result.aborted, false);
});
