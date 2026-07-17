import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

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

async function fetchRange(sample, audioUrl, endByte) {
  const headers = {
    'User-Agent': API_HEADERS['User-Agent'],
    Referer: `https://www.bilibili.com/video/${sample.bvid}/`,
    Origin: 'https://www.bilibili.com',
    Range: `bytes=0-${endByte}`
  };
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

async function testCancellation(sample, audioUrl) {
  const headers = {
    'User-Agent': API_HEADERS['User-Agent'],
    Referer: `https://www.bilibili.com/video/${sample.bvid}/`,
    Origin: 'https://www.bilibili.com',
    Range: 'bytes=0-52428799'
  };
  const controller = new AbortController();
  const startedAt = performance.now();
  const result = fetch(audioUrl, { headers, signal: controller.signal })
    .then(async response => {
      await response.body?.getReader().read();
      return `resolved:${response.status}`;
    })
    .catch(error => `${error.name}:${error.message}`);
  setTimeout(() => controller.abort(), 100);
  return {
    result: await result,
    elapsedMs: Math.round(performance.now() - startedAt)
  };
}

async function streamAndDiscard(sample, audioUrl) {
  const headers = {
    'User-Agent': API_HEADERS['User-Agent'],
    Referer: `https://www.bilibili.com/video/${sample.bvid}/`,
    Origin: 'https://www.bilibili.com'
  };
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

async function probeModelCandidate() {
  const npmPackage = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(MODEL_CANDIDATE.runtimePackage)}/${MODEL_CANDIDATE.runtimeVersion}`, {
    'User-Agent': API_HEADERS['User-Agent']
  });
  const model = await fetchJson(`https://huggingface.co/api/models/${MODEL_CANDIDATE.modelId}?blobs=true`, {
    'User-Agent': API_HEADERS['User-Agent']
  });
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
  const selected = selectedFiles
    .map(filename => siblings.find(item => item.rfilename === filename))
    .filter(Boolean)
    .map(item => ({
      file: item.rfilename,
      size: item.size,
      sha256: item.lfs?.sha256 ?? item.blobId ?? null
    }));
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
      id: model.body?.id ?? null,
      sha: model.body?.sha ?? null,
      lastModified: model.body?.lastModified ?? null,
      license: model.body?.cardData?.license ?? null,
      pipelineTag: model.body?.pipeline_tag ?? null,
      libraryName: model.body?.library_name ?? null,
      selectedFiles: selected,
      selectedTotalBytes: selected.reduce((sum, item) => sum + (item.size ?? 0), 0),
      repositoryUsedStorage: model.body?.usedStorage ?? null
    }
  };
}

async function launchEdgeHarness() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const extensionDir = await mkdtemp(join(tmpdir(), 'bili-bill-asr-mv3-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'bili-bill-asr-edge-profile-'));
  const manifest = {
    manifest_version: 3,
    name: 'Bili-Bill ASR MV3 Spike Harness',
    version: '0.0.0',
    permissions: ['offscreen', 'storage'],
    background: { service_worker: 'sw.js', type: 'module' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
    }
  };
  const sw = `
const result = { phase: 'service-worker-started', steps: [] };
async function run() {
  result.steps.push('offscreen-create-requested');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Validate local ASR WASM and worker container for a spike harness.'
  });
  result.steps.push('offscreen-created');
  const response = await chrome.runtime.sendMessage({ action: 'RUN_ASR_SPIKE_OFFSCREEN' });
  result.response = response;
  await chrome.storage.local.set({ ASR_SPIKE_RESULT: result });
}
run().catch(async error => {
  result.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
  await chrome.storage.local.set({ ASR_SPIKE_RESULT: result });
});
`;
  const offscreenHtml = '<!doctype html><meta charset="utf-8"><script type="module" src="offscreen.js"></script>';
  const offscreenJs = `
const wasmBytes = new Uint8Array([
  0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x07,0x01,0x60,0x02,0x7f,0x7f,
  0x01,0x7f,0x03,0x02,0x01,0x00,0x07,0x07,0x01,0x03,0x61,0x64,0x64,0x00,0x00,
  0x0a,0x09,0x01,0x07,0x00,0x20,0x00,0x20,0x01,0x6a,0x0b
]);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'RUN_ASR_SPIKE_OFFSCREEN') return false;
  (async () => {
    const compiled = await WebAssembly.compile(wasmBytes);
    const instance = await WebAssembly.instantiate(compiled);
    const worker = new Worker(chrome.runtime.getURL('worker.js'), { type: 'module' });
    const workerResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timeout')), 5000);
      worker.onmessage = event => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onerror = event => {
        clearTimeout(timer);
        reject(new Error(event.message));
      };
      worker.postMessage({ bytes: 1024 * 1024 });
    });
    worker.terminate();
    sendResponse({ ok: true, wasmAdd: instance.exports.add(2, 3), workerResult });
  })().catch(error => sendResponse({ ok: false, error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) } }));
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
  self.postMessage({ firstByte, released: true });
};
`;
  await writeFile(join(extensionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(extensionDir, 'sw.js'), sw);
  await writeFile(join(extensionDir, 'offscreen.html'), offscreenHtml);
  await writeFile(join(extensionDir, 'offscreen.js'), offscreenJs);
  await writeFile(join(extensionDir, 'worker.js'), workerJs);

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9223',
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    'about:blank'
  ];
  const startedAt = performance.now();
  const child = spawn(edgePath, args, { stdio: 'ignore' });
  let probeResult;
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      try {
        const targets = await fetchJson('http://127.0.0.1:9223/json/list', {});
        const serviceWorkerTarget = Array.isArray(targets.body)
          ? targets.body.find(target => target.type === 'service_worker' && target.url?.startsWith('chrome-extension://'))
          : null;
        if (serviceWorkerTarget?.url?.endsWith('/sw.js')) {
          probeResult = {
            ok: true,
            elapsedMs: Math.round(performance.now() - startedAt),
            serviceWorkerUrl: serviceWorkerTarget.url,
            note: 'Edge loaded a temporary MV3 extension with offscreen permission and wasm CSP. CDP storage read is not implemented by this harness.'
          };
          break;
        }
      } catch {
        // Retry until the remote debugging endpoint is available.
      }
    }
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    const cleanupWarnings = [];
    for (const path of [extensionDir, userDataDir]) {
      try {
        await rm(path, { recursive: true, force: true });
      } catch (error) {
        cleanupWarnings.push(`${path}: ${error?.code ?? error?.name ?? 'Error'} ${error?.message ?? String(error)}`);
      }
    }
    if (cleanupWarnings.length > 0) {
      probeResult = probeResult ?? {
        ok: false,
        elapsedMs: Math.round(performance.now() - startedAt),
        error: 'No extension service worker target appeared before timeout.'
      };
      probeResult.cleanupWarnings = cleanupWarnings;
    }
  }
  return probeResult ?? {
    ok: false,
    elapsedMs: Math.round(performance.now() - startedAt),
    error: 'No extension service worker target appeared before timeout.'
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

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
