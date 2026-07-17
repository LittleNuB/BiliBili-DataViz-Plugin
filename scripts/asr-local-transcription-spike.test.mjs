import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
  cancelReadAfterFirstChunk,
  createSpikeServiceWorkerSource,
  evaluateModelRuntimeEvidence,
  evaluatePublicSampleEvidence,
  fetchJson,
  fetchRangeEvidence,
  getMv3LifecycleUnavailableEvidence,
  streamAndDiscard,
  summarizeHarnessGates,
  summarizePublicSampleEvidence,
  validateModelRevision,
  validateMv3SpikeResult
} from './asr-local-transcription-spike.mjs';

const SPIKE_SCRIPT_PATH = fileURLToPath(new URL('./asr-local-transcription-spike.mjs', import.meta.url));

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
      timedOut: false,
      apiCode: 0,
      bvid: sample.bvid,
      title: sample.expectedTitle,
      durationSeconds,
      currentPageCid: sample.cid,
      currentPageDurationSeconds: durationSeconds
    },
    subtitle: { httpStatus: 200, timedOut: false, apiCode: 0, count: 0 },
    playurl: {
      httpStatus: 200,
      timedOut: false,
      apiCode: 0,
      audioCount: 1,
      firstAudioCodec: sample.expectedAudioCodec
    },
    range: {
      requestedRangeStart: 0,
      requestedRangeEnd: 3,
      requestedLengthBytes: 4,
      status: 206,
      timedOut: false,
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
          timedOut: false,
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
        timedOut: false,
        name: candidate.runtimePackage,
        version: candidate.runtimeVersion,
        license: candidate.runtimeLicense
      },
      model: {
        httpStatus: 200,
        timedOut: false,
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
  const clippedAtKnownTotal = validPublicSampleEvidence();
  clippedAtKnownTotal.range = {
    ...clippedAtKnownTotal.range,
    requestedRangeEnd: 99,
    requestedLengthBytes: 100,
    contentRange: 'bytes 0-9/10',
    contentLength: '10',
    contentLengthBytes: 10,
    rangeEnd: 9,
    totalBytes: 10,
    firstChunkBytes: 10,
    bytesRead: 10
  };

  assert.equal(shortGate.ok, true);
  assert.equal(longGate.ok, true);
  assert.equal(evaluatePublicSampleEvidence(clippedAtKnownTotal).ok, true);

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

test('range gate rejects a well-formed 206 that is shorter than the requested range', async t => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.range, 'bytes=0-1048575');
    response.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': 'bytes 0-3/10485760',
      'Content-Length': '4'
    });
    response.end(Buffer.from([1, 2, 3, 4]));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const range = await fetchRangeEvidence(
    { bvid: 'BV1ShortRangeTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`,
    1_048_575
  );
  const evidence = validPublicSampleEvidence();
  evidence.range = range;
  const gate = evaluatePublicSampleEvidence(evidence);

  assert.equal(range.requestedRangeStart, 0);
  assert.equal(range.requestedRangeEnd, 1_048_575);
  assert.equal(range.requestedLengthBytes, 1_048_576);
  assert.equal(gate.checks.rangeRequestContractMatches, false);
  assert.equal(gate.ok, false);
});

test('metadata JSON probe returns explicit timeout evidence when the server stalls', async t => {
  const server = createServer(() => {
    // Intentionally withhold headers and body until the probe deadline aborts the request.
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const evidence = await fetchJson(
    `http://127.0.0.1:${address.port}/metadata.json`,
    { Accept: 'application/json' },
    { timeoutMs: 25 }
  );

  assert.equal(evidence.timedOut, true);
  assert.equal(evidence.status, null);
  assert.equal(evidence.body, null);
  assert.match(evidence.error, /^AbortError:/);
});

test('range probe aborts a stalled body and fails the sample deadline gate', async t => {
  const server = createServer((_request, response) => {
    response.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': 'bytes 0-9/10',
      'Content-Length': '10'
    });
    response.flushHeaders();
    response.write(Buffer.from([1]));
    const fallback = setTimeout(() => response.destroy(), 500);
    response.on('close', () => clearTimeout(fallback));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const range = await fetchRangeEvidence(
    { bvid: 'BV1StalledRangeTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`,
    9,
    { timeoutMs: 25 }
  );
  const evidence = validPublicSampleEvidence();
  evidence.range = range;
  const gate = evaluatePublicSampleEvidence(evidence);

  assert.equal(range.status, 206);
  assert.equal(range.timedOut, true);
  assert.equal(range.timeoutMs, 25);
  assert.equal(range.bodyComplete, false);
  assert.match(range.readError, /^AbortError:/);
  assert.equal(gate.checks.rangeWithinDeadline, false);
  assert.equal(gate.ok, false);
});

test('full-stream probe aborts a stalled body and fails the long-sample deadline gate', async t => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': '10'
    });
    response.flushHeaders();
    response.write(Buffer.from([1]));
    const fallback = setTimeout(() => response.destroy(), 200);
    response.on('close', () => clearTimeout(fallback));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const fullStream = await streamAndDiscard(
    { bvid: 'BV1StalledFullStreamTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`,
    { timeoutMs: 100 }
  );
  const evidence = validPublicSampleEvidence({ long: true });
  evidence.fullStream = fullStream;
  const gate = evaluatePublicSampleEvidence(evidence);

  assert.equal(fullStream.status, 200);
  assert.equal(fullStream.timedOut, true);
  assert.equal(fullStream.timeoutMs, 100);
  assert.equal(fullStream.bodyComplete, false);
  assert.match(fullStream.readError, /^AbortError:/);
  assert.equal(gate.checks.fullStreamWithinDeadline, false);
  assert.equal(gate.ok, false);
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

test('network timeout evidence fails sample/model gates and produces a nonzero harness exit', () => {
  const sampleEvidence = validPublicSampleEvidence();
  sampleEvidence.view.timedOut = true;
  const publicSamplesGate = evaluatePublicSampleEvidence(sampleEvidence);

  const modelFixture = validModelRuntimeEvidence();
  modelFixture.evidence.model.timedOut = true;
  const modelRuntimeGate = evaluateModelRuntimeEvidence(
    modelFixture.evidence,
    modelFixture.candidate,
    modelFixture.expectedFiles
  );

  const overall = summarizeHarnessGates({
    mv3Only: false,
    publicSamplesGate,
    modelRuntimeGate,
    mv3Gate: { ok: true }
  });

  assert.equal(publicSamplesGate.checks.viewWithinDeadline, false);
  assert.equal(modelRuntimeGate.checks.modelWithinDeadline, false);
  assert.deepEqual(overall.failedGates, ['publicSamples', 'modelRuntime']);
  assert.equal(overall.ok, false);
  assert.equal(overall.exitCode, 1);
  assert.equal(overall.decision, 'no-go');
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

test('historical static MV3 result validation requires exact marker and WASM/worker evidence', () => {
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

test('current Windows MV3 lifecycle performs no live operation and fails with the exact reason', () => {
  const evidence = getMv3LifecycleUnavailableEvidence('win32');
  const overall = summarizeHarnessGates({
    mv3Only: true,
    publicSamplesGate: null,
    modelRuntimeGate: null,
    mv3Gate: { ok: evidence.ok, failures: [evidence.reason] }
  });

  assert.deepEqual(evidence, {
    ok: false,
    executed: false,
    platform: 'win32',
    reason: 'mv3-lifecycle-ownership-binding-unavailable',
    ownershipSafeLifecycleAvailable: false,
    launchAttempted: false,
    tempRootCreationAttempted: false,
    cdpConnectionAttempted: false,
    browserCloseAttempted: false,
    recursiveDeletionAttempted: false,
    staticSourceEvidence: {
      available: true,
      historicalOnly: true,
      countedAsCurrentMachineEvidence: false
    }
  });
  assert.equal(overall.ok, false);
  assert.deepEqual(overall.failedGates, ['mv3']);
  assert.equal(overall.exitCode, 1);
  assert.equal(overall.asrProductGatesOk, false);
  assert.equal(overall.decision, 'no-go');
});

test('mv3-only CLI performs no browser or temp-root operation and exits nonzero', async () => {
  const source = await readFile(SPIKE_SCRIPT_PATH, 'utf8');
  for (const forbidden of [
    "from 'node:child_process'",
    'spawn(',
    'DevToolsActivePort',
    'Browser.close',
    'launchEdgeHarness',
    'recursive: true'
  ]) {
    assert.equal(source.includes(forbidden), false, `production harness must not contain ${forbidden}`);
  }

  const execution = await new Promise(resolveExecution => {
    execFile(
      process.execPath,
      [SPIKE_SCRIPT_PATH, '--mv3-only'],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
      (error, stdout, stderr) => resolveExecution({ error, stdout, stderr })
    );
  });

  assert.equal(execution.error?.code, 1);
  assert.equal(execution.error?.killed, false);
  assert.equal(execution.stderr, '');
  const output = JSON.parse(execution.stdout);
  assert.equal(output.mv3Lifecycle.reason, 'mv3-lifecycle-ownership-binding-unavailable');
  assert.equal(output.mv3Lifecycle.launchAttempted, false);
  assert.equal(output.mv3Lifecycle.tempRootCreationAttempted, false);
  assert.equal(output.mv3Lifecycle.cdpConnectionAttempted, false);
  assert.equal(output.mv3Lifecycle.browserCloseAttempted, false);
  assert.equal(output.mv3Lifecycle.recursiveDeletionAttempted, false);
  assert.deepEqual(output.machineGates.mv3.failures, ['mv3-lifecycle-ownership-binding-unavailable']);
  assert.deepEqual(output.overall.failedGates, ['mv3']);
  assert.equal(output.overall.asrProductGatesOk, false);
  assert.equal(output.overall.decision, 'no-go');
  assert.equal(output.harnessExitCode, 1);
});

test('service-worker persistence failure is terminal and contained without an unobserved rejection', async () => {
  const marker = 'persistence-failure-marker';
  let storageSetAttempts = 0;
  const context = {
    chrome: {
      storage: {
        local: {
          set: async () => {
            storageSetAttempts += 1;
            throw new Error('storage unavailable');
          }
        }
      },
      offscreen: {
        createDocument: async () => {
          throw new Error('offscreen should not run after initial persistence failure');
        }
      },
      runtime: {
        sendMessage: async () => null
      }
    }
  };

  runInNewContext(createSpikeServiceWorkerSource(marker), context);
  await assert.doesNotReject(async () => context.ASR_SPIKE_RUN_PROMISE);

  assert.equal(storageSetAttempts, 2);
  assert.equal(context.ASR_SPIKE_RESULT.marker, marker);
  assert.equal(context.ASR_SPIKE_RESULT.phase, 'failed');
  assert.equal(context.ASR_SPIKE_RESULT.error.message, 'storage unavailable');
  assert.equal(context.ASR_SPIKE_RESULT.persistenceFailure.message, 'storage unavailable');
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
