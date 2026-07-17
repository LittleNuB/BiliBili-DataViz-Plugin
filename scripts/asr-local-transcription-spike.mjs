import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SPIKE_TEMP_PREFIX = 'bili-bill-asr-spike-';
const EDGE_START_TIMEOUT_MS = 15_000;
const EDGE_PROBE_TIMEOUT_MS = 20_000;
const EDGE_EXIT_TIMEOUT_MS = 5_000;
const CDP_COMMAND_TIMEOUT_MS = 5_000;

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://www.bilibili.com'
};

const PUBLIC_SAMPLES = [
  {
    id: 'zh-speech',
    purpose: '普通中文口播/知识视频，无字幕场景',
    bvid: 'BV1xdNt6TEP3',
    cid: '39943406244',
    expectedTitle: '搞强拆能惹多大祸？【奇葩小国53】'
  },
  {
    id: 'mixed-terms',
    purpose: '中文为主且包含 iPhone/iOS/feat 等英文术语，无字幕场景',
    bvid: 'BV1CaZxYFEFG',
    cid: '29173615369',
    expectedTitle: '【iPhone用户必看】一定要升级到iOS18.4正式版！feat. 25+ 新功能｜大耳朵TV'
  },
  {
    id: 'long-117m',
    purpose: '不低于 90 分钟的长视频，无字幕场景',
    bvid: 'BV1oSKg63E1t',
    cid: '39992362063',
    expectedTitle: '王濛李诞是懂彼此的丨《互相关注》EP01正片'
  }
];

const MODEL_CANDIDATE = {
  runtimePackage: '@huggingface/transformers',
  runtimeVersion: '4.2.0',
  modelId: 'Xenova/whisper-tiny',
  modelRevision: '5332fcc35e32a33b86612b9a57a89be7906102b1'
};

function formatBytes(bytes) {
  return `${bytes} B`;
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function describeError(error) {
  return `${error?.name ?? 'Error'}:${error?.message ?? String(error)}`;
}

async function fetchJson(url, headers = API_HEADERS) {
  const startedAt = performance.now();
  const response = await fetch(url, { headers });
  const text = await response.text();
  const elapsedMs = Math.round(performance.now() - startedAt);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { code: 'parse_failed', bodyPreview: text.slice(0, 160) };
  }
  return { status: response.status, elapsedMs, body };
}

function getAudioUrl(playurlBody) {
  return playurlBody?.data?.dash?.audio?.[0]?.baseUrl ?? null;
}

function parseTotalBytes(contentRange) {
  const match = typeof contentRange === 'string' ? contentRange.match(/\/(\d+)$/) : null;
  return match ? Number(match[1]) : null;
}

function buildAudioHeaders(sample, range) {
  return {
    'User-Agent': API_HEADERS['User-Agent'],
    Referer: `https://www.bilibili.com/video/${sample.bvid}/`,
    Origin: 'https://www.bilibili.com',
    ...(range ? { Range: range } : {})
  };
}

async function fetchRange(sample, audioUrl, endByte) {
  const headers = buildAudioHeaders(sample, `bytes=0-${endByte}`);
  const startedAt = performance.now();
  const response = await fetch(audioUrl, { headers });
  const buffer = await response.arrayBuffer();
  return {
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    contentType: response.headers.get('content-type'),
    contentRange: response.headers.get('content-range'),
    contentLength: response.headers.get('content-length'),
    bytesRead: buffer.byteLength,
    totalBytes: parseTotalBytes(response.headers.get('content-range'))
  };
}

export async function testCancellation(sample, audioUrl) {
  const headers = buildAudioHeaders(sample, 'bytes=0-52428799');
  const controller = new AbortController();
  const startedAt = performance.now();
  let abortReason = null;
  let bytesReadBeforeAbort = 0;
  let reader = null;
  let status = null;
  const safetyTimer = setTimeout(() => {
    if (!controller.signal.aborted) {
      abortReason = 'safety-timeout';
      controller.abort();
    }
  }, 15_000);

  try {
    const response = await fetch(audioUrl, { headers, signal: controller.signal });
    status = response.status;
    reader = response.body?.getReader() ?? null;
    if (!reader) {
      return {
        result: `resolved:${response.status}:no-readable-body`,
        aborted: false,
        abortReason,
        status,
        bytesReadBeforeAbort,
        elapsedMs: Math.round(performance.now() - startedAt)
      };
    }

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return {
          result: `resolved:${response.status}`,
          aborted: false,
          abortReason,
          status,
          bytesReadBeforeAbort,
          elapsedMs: Math.round(performance.now() - startedAt)
        };
      }
      bytesReadBeforeAbort += chunk.value.byteLength;
      if (!controller.signal.aborted) {
        abortReason = 'after-first-chunk';
        controller.abort();
      }
    }
  } catch (error) {
    return {
      result: describeError(error),
      aborted: controller.signal.aborted && error?.name === 'AbortError',
      abortReason,
      status,
      bytesReadBeforeAbort,
      elapsedMs: Math.round(performance.now() - startedAt)
    };
  } finally {
    clearTimeout(safetyTimer);
    try {
      reader?.releaseLock();
    } catch {
      // The aborted stream may already have released its lock.
    }
  }
}

async function streamAndDiscard(sample, audioUrl) {
  const headers = buildAudioHeaders(sample);
  const beforeMemory = process.memoryUsage().rss;
  const startedAt = performance.now();
  const response = await fetch(audioUrl, { headers });
  let bytesRead = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
  }
  const afterMemory = process.memoryUsage().rss;
  return {
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    bytesRead,
    rssDeltaBytes: afterMemory - beforeMemory
  };
}

async function probePublicAudio() {
  const results = [];
  for (const sample of PUBLIC_SAMPLES) {
    const view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${sample.bvid}`);
    const subtitle = await fetchJson(`https://api.bilibili.com/x/player/v2?bvid=${sample.bvid}&cid=${sample.cid}`);
    const playurl = await fetchJson(
      `https://api.bilibili.com/x/player/playurl?bvid=${sample.bvid}&cid=${sample.cid}&qn=64&fnval=16&fourk=1`
    );
    const audioUrl = getAudioUrl(playurl.body);
    const range = audioUrl ? await fetchRange(sample, audioUrl, sample.id === 'long-117m' ? 262143 : 1048575) : null;
    const cancellation = audioUrl ? await testCancellation(sample, audioUrl) : null;
    const fullStream = audioUrl && sample.id === 'long-117m' ? await streamAndDiscard(sample, audioUrl) : null;
    results.push({
      sample,
      view: {
        httpStatus: view.status,
        apiCode: view.body?.code,
        title: view.body?.data?.title ?? null,
        durationSeconds: view.body?.data?.duration ?? null,
        pages: view.body?.data?.pages?.length ?? null
      },
      subtitle: {
        httpStatus: subtitle.status,
        apiCode: subtitle.body?.code,
        count: subtitle.body?.data?.subtitle?.subtitles?.length ?? null,
        languages: (subtitle.body?.data?.subtitle?.subtitles ?? []).map(item => `${item.lan}:${item.lan_doc}`)
      },
      playurl: {
        httpStatus: playurl.status,
        apiCode: playurl.body?.code,
        audioCount: playurl.body?.data?.dash?.audio?.length ?? 0,
        firstAudioCodec: playurl.body?.data?.dash?.audio?.[0]?.codecs ?? null,
        firstAudioBandwidth: playurl.body?.data?.dash?.audio?.[0]?.bandwidth ?? null,
        firstAudioHost: audioUrl ? new URL(audioUrl).host : null
      },
      range,
      cancellation,
      fullStream
    });
  }
  return results;
}

export function validateModelRevision(modelBody, candidate) {
  const modelIdVerified = modelBody?.id === candidate.modelId;
  const revisionVerified = modelBody?.sha === candidate.modelRevision;
  return {
    modelIdVerified,
    revisionVerified,
    verified: modelIdVerified && revisionVerified
  };
}

async function probeModelCandidate() {
  const npmPackage = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(MODEL_CANDIDATE.runtimePackage)}/${MODEL_CANDIDATE.runtimeVersion}`, {
    'User-Agent': API_HEADERS['User-Agent']
  });
  const metadataUrl =
    `https://huggingface.co/api/models/${MODEL_CANDIDATE.modelId}/revision/` +
    `${encodeURIComponent(MODEL_CANDIDATE.modelRevision)}?blobs=true`;
  const model = await fetchJson(metadataUrl, { 'User-Agent': API_HEADERS['User-Agent'] });
  const revisionValidation = validateModelRevision(model.body, MODEL_CANDIDATE);
  const siblings = model.body?.siblings ?? [];
  const selectedFiles = [
    'onnx/encoder_model_q4.onnx',
    'onnx/decoder_model_merged_q4.onnx',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
    'merges.txt',
    'normalizer.json',
    'preprocessor_config.json',
    'generation_config.json',
    'config.json',
    'special_tokens_map.json',
    'added_tokens.json'
  ];
  const selected = selectedFiles.map(filename => {
    const item = siblings.find(sibling => sibling.rfilename === filename);
    if (!item) {
      return {
        file: filename,
        present: false,
        size: null,
        hash: null,
        hashAlgorithm: null
      };
    }
    return {
      file: item.rfilename,
      present: true,
      size: item.size ?? item.lfs?.size ?? null,
      hash: item.lfs?.sha256 ?? item.blobId ?? null,
      hashAlgorithm: item.lfs?.sha256 ? 'sha256' : item.blobId ? 'git-blob-sha1' : null
    };
  });
  const allSelectedFilesPresent = selected.every(item => item.present && Number.isFinite(item.size));
  return {
    candidate: MODEL_CANDIDATE,
    runtime: {
      httpStatus: npmPackage.status,
      name: npmPackage.body?.name ?? null,
      version: npmPackage.body?.version ?? null,
      license: npmPackage.body?.license ?? null,
      integrity: npmPackage.body?.dist?.integrity ?? null,
      unpackedSize: npmPackage.body?.dist?.unpackedSize ?? null,
      dependencies: npmPackage.body?.dependencies ?? null
    },
    model: {
      httpStatus: model.status,
      metadataUrl,
      id: model.body?.id ?? null,
      sha: model.body?.sha ?? null,
      ...revisionValidation,
      lastModified: model.body?.lastModified ?? null,
      license: model.body?.cardData?.license ?? null,
      pipelineTag: model.body?.pipeline_tag ?? null,
      libraryName: model.body?.library_name ?? null,
      selectedFiles: selected,
      allSelectedFilesPresent,
      selectedTotalBytes: allSelectedFilesPresent ? selected.reduce((sum, item) => sum + item.size, 0) : null,
      repositoryUsedStorage: model.body?.usedStorage ?? null
    }
  };
}

export function validateMv3SpikeResult(result, marker) {
  const checks = {
    resultObject: Boolean(result && typeof result === 'object'),
    markerMatches: result?.marker === marker,
    completed: result?.phase === 'completed',
    responseMarkerMatches: result?.response?.marker === marker,
    responseOk: result?.response?.ok === true,
    wasmExecuted: result?.response?.wasmAdd === 5,
    workerMarkerMatches: result?.response?.workerResult?.marker === marker,
    workerExecuted: result?.response?.workerResult?.firstByte === 7,
    workerClearedBufferReference: result?.response?.workerResult?.released === true
  };
  return {
    checks,
    ok: Object.values(checks).every(Boolean)
  };
}

export function isOwnedSpikeTempRoot(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const resolvedPath = resolve(path);
  const name = basename(resolvedPath);
  return (
    dirname(resolvedPath) === resolve(tmpdir()) &&
    name.startsWith(SPIKE_TEMP_PREFIX) &&
    name.length > SPIKE_TEMP_PREFIX.length
  );
}

function childHasExited(child) {
  return child.pid == null || child.exitCode !== null || child.signalCode !== null;
}

function observeChildExit(child) {
  let settled = false;
  let resolveExit;
  const settle = (code, signal, alreadyExited) => {
    if (settled) return;
    settled = true;
    child.removeListener('exit', onExit);
    resolveExit({ code, signal, alreadyExited });
  };
  const onExit = (code, signal) => settle(code, signal, false);
  const promise = new Promise(resolvePromise => {
    resolveExit = resolvePromise;
    child.once('exit', onExit);
  });
  if (childHasExited(child)) {
    settle(child.exitCode, child.signalCode, true);
  }
  return {
    promise,
    cancel() {
      if (!settled) child.removeListener('exit', onExit);
    }
  };
}

async function stopEdgeChild(child) {
  const observer = observeChildExit(child);
  const alreadyExited = childHasExited(child);
  let killRequested = false;
  try {
    if (!alreadyExited) {
      killRequested = child.kill();
    }
    const exit = await withTimeout(
      observer.promise,
      EDGE_EXIT_TIMEOUT_MS,
      `Edge did not exit within ${EDGE_EXIT_TIMEOUT_MS} ms.`
    );
    return {
      alreadyExited: exit.alreadyExited,
      killRequested,
      exited: true,
      exitCode: exit.code,
      signal: exit.signal,
      timedOut: false,
      warnings: []
    };
  } catch (error) {
    return {
      alreadyExited,
      killRequested,
      exited: childHasExited(child),
      exitCode: child.exitCode,
      signal: child.signalCode,
      timedOut: error?.message === `Edge did not exit within ${EDGE_EXIT_TIMEOUT_MS} ms.`,
      warnings: [describeError(error)]
    };
  } finally {
    observer.cancel();
  }
}

async function waitForDevToolsEndpoint(userDataDir, child, getSpawnError) {
  const activePortPath = join(userDataDir, 'DevToolsActivePort');
  const deadline = performance.now() + EDGE_START_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (childHasExited(child)) {
      throw new Error(`Edge exited before creating DevToolsActivePort (code=${child.exitCode}, signal=${child.signalCode}).`);
    }
    try {
      const lines = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/);
      const port = Number(lines[0]);
      const browserPath = lines[1];
      if (Number.isInteger(port) && port > 0 && port <= 65_535 && browserPath?.startsWith('/devtools/browser/')) {
        return {
          port,
          browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}`,
          source: 'own-temporary-profile/DevToolsActivePort'
        };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(100);
  }
  throw new Error(`Own Edge profile did not create DevToolsActivePort within ${EDGE_START_TIMEOUT_MS} ms.`);
}

async function webSocketDataToText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  if (typeof data?.text === 'function') return data.text();
  return String(data);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  let opened = false;
  let resolveClosed;
  const closed = new Promise(resolvePromise => {
    resolveClosed = resolvePromise;
  });

  const rejectPending = error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  socket.addEventListener('message', event => {
    void webSocketDataToText(event.data)
      .then(text => {
        const message = JSON.parse(text);
        if (!message.id) return;
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(`CDP ${entry.method} failed: ${JSON.stringify(message.error)}`));
        } else {
          entry.resolve(message.result);
        }
      })
      .catch(error => rejectPending(error));
  });
  socket.addEventListener('close', () => {
    resolveClosed();
    rejectPending(new Error('CDP WebSocket closed.'));
  });
  socket.addEventListener('error', () => rejectPending(new Error('CDP WebSocket error.')));

  try {
    await withTimeout(
      new Promise((resolveOpen, rejectOpen) => {
        socket.addEventListener(
          'open',
          () => {
            opened = true;
            resolveOpen();
          },
          { once: true }
        );
        socket.addEventListener('error', () => rejectOpen(new Error('Could not open CDP WebSocket.')), { once: true });
        socket.addEventListener(
          'close',
          () => {
            if (!opened) rejectOpen(new Error('CDP WebSocket closed before opening.'));
          },
          { once: true }
        );
      }),
      CDP_COMMAND_TIMEOUT_MS,
      `CDP WebSocket did not open within ${CDP_COMMAND_TIMEOUT_MS} ms.`
    );
  } catch (error) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    throw error;
  }

  return {
    send(method, params = {}, sessionId = undefined) {
      const id = nextId;
      nextId += 1;
      const command = new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { method, resolve: resolveCommand, reject: rejectCommand });
        try {
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch (error) {
          pending.delete(id);
          rejectCommand(error);
        }
      });
      return withTimeout(command, CDP_COMMAND_TIMEOUT_MS, `CDP ${method} timed out.`).finally(() => pending.delete(id));
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      try {
        await withTimeout(closed, 1_000, 'CDP WebSocket did not close within 1000 ms.');
        return null;
      } catch (error) {
        return describeError(error);
      }
    }
  };
}

async function readMv3ResultThroughCdp(endpoint, serviceWorkerFilename, marker, child) {
  const cdp = await connectCdp(endpoint.browserWebSocketUrl);
  const deadline = performance.now() + EDGE_PROBE_TIMEOUT_MS;
  let outcome = null;
  let caughtError = null;
  let closeWarning = null;
  try {
    let targetInfo = null;
    let sessionId = null;
    while (performance.now() < deadline) {
      if (childHasExited(child)) throw new Error('Edge exited during the MV3 CDP probe.');
      if (!targetInfo) {
        const targets = await cdp.send('Target.getTargets');
        targetInfo = targets.targetInfos?.find(
          target =>
            target.type === 'service_worker' &&
            target.url?.startsWith('chrome-extension://') &&
            target.url.endsWith(`/${serviceWorkerFilename}`)
        );
        if (targetInfo) {
          const attached = await cdp.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true });
          sessionId = attached.sessionId;
          await cdp.send('Runtime.enable', {}, sessionId);
        }
      }

      if (sessionId) {
        const evaluation = await cdp.send(
          'Runtime.evaluate',
          {
            expression: `(async () => {
              const stored = await chrome.storage.local.get('ASR_SPIKE_RESULT');
              return {
                globalResult: globalThis.ASR_SPIKE_RESULT ?? null,
                storedResult: stored.ASR_SPIKE_RESULT ?? null
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          },
          sessionId
        );
        if (evaluation.exceptionDetails) {
          throw new Error(`CDP Runtime.evaluate failed: ${JSON.stringify(evaluation.exceptionDetails)}`);
        }
        const evidence = evaluation.result?.value ?? null;
        const storedResult = evidence?.storedResult ?? null;
        if (storedResult?.phase === 'completed' || storedResult?.phase === 'failed') {
          const validation = validateMv3SpikeResult(storedResult, marker);
          validation.checks.globalMarkerMatches = evidence?.globalResult?.marker === marker;
          validation.checks.globalPhaseMatches = evidence?.globalResult?.phase === storedResult.phase;
          validation.ok = Object.values(validation.checks).every(Boolean);
          outcome = {
            targetInfo,
            storedResult,
            validation
          };
          break;
        }
      }
      await delay(250);
    }
    if (!outcome) {
      throw new Error(
        `No terminal ASR_SPIKE_RESULT was read from ${serviceWorkerFilename} within ${EDGE_PROBE_TIMEOUT_MS} ms.`
      );
    }
  } catch (error) {
    caughtError = error;
  } finally {
    closeWarning = await cdp.close();
  }
  if (caughtError) throw caughtError;
  return { ...outcome, cdpCloseWarning: closeWarning };
}

async function launchEdgeHarness() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const marker = randomUUID();
  const serviceWorkerFilename = `asr-spike-sw-${marker}.js`;
  const startedAt = performance.now();
  const cleanupWarnings = [];
  let runRoot = null;
  let child = null;
  let edgeShutdown = null;
  let tempRootRemoved = false;
  let probeResult = null;

  try {
    runRoot = await mkdtemp(join(tmpdir(), SPIKE_TEMP_PREFIX));
    if (!isOwnedSpikeTempRoot(runRoot)) throw new Error('Refusing to use an unowned spike temp root.');
    const extensionDir = join(runRoot, 'extension');
    const userDataDir = join(runRoot, 'edge-profile');
    await Promise.all([mkdir(extensionDir), mkdir(userDataDir)]);

    const manifest = {
      manifest_version: 3,
      name: 'Bili-Bill ASR MV3 Spike Harness',
      version: '0.0.0',
      permissions: ['offscreen', 'storage'],
      background: { service_worker: serviceWorkerFilename, type: 'module' },
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
      }
    };
    const sw = `
const RUN_MARKER = ${JSON.stringify(marker)};
const result = { marker: RUN_MARKER, phase: 'service-worker-started', steps: [] };
globalThis.ASR_SPIKE_RESULT = result;
async function persist() {
  globalThis.ASR_SPIKE_RESULT = result;
  await chrome.storage.local.set({ ASR_SPIKE_RESULT: result });
}
async function run() {
  await persist();
  result.steps.push('offscreen-create-requested');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Validate local ASR WASM and worker container for a spike harness.'
  });
  result.steps.push('offscreen-created');
  const response = await chrome.runtime.sendMessage({ action: 'RUN_ASR_SPIKE_OFFSCREEN', marker: RUN_MARKER });
  result.response = response;
  result.phase = 'completed';
  await persist();
}
run().catch(async error => {
  result.phase = 'failed';
  result.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
  await persist();
});
`;
    const offscreenHtml = '<!doctype html><meta charset="utf-8"><script type="module" src="offscreen.js"></script>';
    const offscreenJs = `
const RUN_MARKER = ${JSON.stringify(marker)};
const wasmBytes = new Uint8Array([
  0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x07,0x01,0x60,0x02,0x7f,0x7f,
  0x01,0x7f,0x03,0x02,0x01,0x00,0x07,0x07,0x01,0x03,0x61,0x64,0x64,0x00,0x00,
  0x0a,0x09,0x01,0x07,0x00,0x20,0x00,0x20,0x01,0x6a,0x0b
]);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'RUN_ASR_SPIKE_OFFSCREEN' || message?.marker !== RUN_MARKER) return false;
  (async () => {
    const compiled = await WebAssembly.compile(wasmBytes);
    const instance = await WebAssembly.instantiate(compiled);
    const worker = new Worker(chrome.runtime.getURL('worker.js'), { type: 'module' });
    try {
      const workerResult = await new Promise((resolveWorker, rejectWorker) => {
        const timer = setTimeout(() => rejectWorker(new Error('worker timeout')), 5000);
        worker.onmessage = event => {
          clearTimeout(timer);
          resolveWorker(event.data);
        };
        worker.onerror = event => {
          clearTimeout(timer);
          rejectWorker(new Error(event.message));
        };
        worker.postMessage({ bytes: 1024 * 1024, marker: RUN_MARKER });
      });
      sendResponse({ marker: RUN_MARKER, ok: true, wasmAdd: instance.exports.add(2, 3), workerResult });
    } finally {
      worker.terminate();
    }
  })().catch(error =>
    sendResponse({
      marker: RUN_MARKER,
      ok: false,
      error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) }
    })
  );
  return true;
});
`;
    const workerJs = `
self.onmessage = event => {
  let buffer = new ArrayBuffer(event.data.bytes);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 7;
  const firstByte = bytes[0];
  buffer = null;
  self.postMessage({ marker: event.data.marker, firstByte, released: buffer === null });
};
`;
    await Promise.all([
      writeFile(join(extensionDir, 'manifest.json'), JSON.stringify(manifest, null, 2)),
      writeFile(join(extensionDir, serviceWorkerFilename), sw),
      writeFile(join(extensionDir, 'offscreen.html'), offscreenHtml),
      writeFile(join(extensionDir, 'offscreen.js'), offscreenJs),
      writeFile(join(extensionDir, 'worker.js'), workerJs)
    ]);

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      'about:blank'
    ];
    let spawnError = null;
    child = spawn(edgePath, args, { stdio: 'ignore' });
    child.once('error', error => {
      spawnError = error;
    });
    const endpoint = await waitForDevToolsEndpoint(userDataDir, child, () => spawnError);
    const evidence = await readMv3ResultThroughCdp(endpoint, serviceWorkerFilename, marker, child);
    if (evidence.cdpCloseWarning) cleanupWarnings.push(evidence.cdpCloseWarning);
    probeResult = {
      ok: evidence.validation.ok,
      elapsedMs: Math.round(performance.now() - startedAt),
      marker,
      serviceWorkerFile: serviceWorkerFilename,
      serviceWorkerUrl: evidence.targetInfo.url,
      result: evidence.storedResult,
      validation: evidence.validation,
      isolation: {
        debuggingPortSource: endpoint.source,
        runtimeAssignedPort: endpoint.port,
        existingBrowserProfilesRead: false,
        exactServiceWorkerFilenameMatched: true,
        resultReadThroughTargetCdp: true
      },
      ...(evidence.validation.ok
        ? {}
        : { error: 'ASR_SPIKE_RESULT did not contain the required marker, WASM, and worker evidence.' })
    };
  } catch (error) {
    probeResult = {
      ok: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      marker,
      serviceWorkerFile: serviceWorkerFilename,
      error: describeError(error),
      isolation: {
        debuggingPortRequested: 'runtime-assigned (port 0)',
        existingBrowserProfilesRead: false,
        exactServiceWorkerFilenameRequired: true,
        resultReadThroughTargetCdp: false
      }
    };
  } finally {
    if (child) {
      edgeShutdown = await stopEdgeChild(child);
      cleanupWarnings.push(...edgeShutdown.warnings);
    }
    if (runRoot) {
      if (!isOwnedSpikeTempRoot(runRoot)) {
        cleanupWarnings.push('Refused to delete an unowned temp path.');
      } else {
        try {
          await rm(runRoot, { recursive: true, force: true });
          tempRootRemoved = true;
        } catch (error) {
          cleanupWarnings.push(`${basename(runRoot)}: ${describeError(error)}`);
        }
      }
    }
  }

  const cleanupOk = Boolean(
    edgeShutdown?.exited && !edgeShutdown.timedOut && tempRootRemoved && cleanupWarnings.length === 0
  );
  if (probeResult?.ok && !cleanupOk) {
    probeResult.ok = false;
    probeResult.error = 'MV3 evidence passed, but the bounded Edge/temp cleanup did not complete cleanly.';
  }
  return {
    ...probeResult,
    cleanup: {
      ok: cleanupOk,
      edge: edgeShutdown,
      tempRootRemoved,
      warnings: cleanupWarnings
    }
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const mv3Only = process.argv.includes('--mv3-only');
  const audio = mv3Only ? null : await probePublicAudio();
  const model = mv3Only ? null : await probeModelCandidate();
  let mv3;
  try {
    mv3 = await launchEdgeHarness();
  } catch (error) {
    mv3 = {
      ok: false,
      error: `${error?.name ?? 'Error'}:${error?.message ?? String(error)}`
    };
  }
  const output = {
    generatedAt: new Date().toISOString(),
    startedAt,
    privacyBoundary: {
      cookiesRead: false,
      browserProfilesRead: false,
      loginStateRead: false,
      keyFilesRead: false,
      audioPersisted: false,
      modelPersisted: false
    },
    publicSamples: audio,
    modelCandidate: model,
    mv3OffscreenWasmProbe: mv3
  };
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
