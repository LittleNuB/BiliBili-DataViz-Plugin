import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  isOwnedSpikeTempRoot,
  testCancellation,
  validateModelRevision,
  validateMv3SpikeResult
} from './asr-local-transcription-spike.mjs';

async function closeTestServer(server) {
  server.closeAllConnections();
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => (error ? rejectClose(error) : resolveClose()));
  });
}

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
  const result = await testCancellation(
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
  const result = await testCancellation(
    { bvid: 'BV1LocalResolvedTest' },
    `http://127.0.0.1:${address.port}/audio.m4s`
  );

  assert.equal(result.result, 'resolved:206');
  assert.equal(result.aborted, false);
});
