import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const JSON_REQUEST_TIMEOUT_MS = 20_000;
const RANGE_REQUEST_TIMEOUT_MS = 30_000;
const FULL_STREAM_TIMEOUT_MS = 180_000;

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
    expectedTitle: '搞强拆能惹多大祸？【奇葩小国53】',
    expectedDurationSeconds: 2337,
    expectedAudioCodec: 'mp4a.40.2',
    expectedAudioMime: 'video/mp4',
    requireLongDuration: false,
    requireFullStream: false
  },
  {
    id: 'mixed-terms',
    purpose: '中文为主且包含 iPhone/iOS/feat 等英文术语，无字幕场景',
    bvid: 'BV1CaZxYFEFG',
    cid: '29173615369',
    expectedTitle: '【iPhone用户必看】一定要升级到iOS18.4正式版！feat. 25+ 新功能｜大耳朵TV',
    expectedDurationSeconds: 897,
    expectedAudioCodec: 'mp4a.40.2',
    expectedAudioMime: 'video/mp4',
    requireLongDuration: false,
    requireFullStream: false
  },
  {
    id: 'long-117m',
    purpose: '不低于 90 分钟的长视频，无字幕场景',
    bvid: 'BV1oSKg63E1t',
    cid: '39992362063',
    expectedTitle: '王濛李诞是懂彼此的丨《互相关注》EP01正片',
    expectedDurationSeconds: 7050,
    expectedAudioCodec: 'mp4a.40.2',
    expectedAudioMime: 'video/mp4',
    requireLongDuration: true,
    requireFullStream: true
  }
];

const MODEL_CANDIDATE = {
  runtimePackage: '@huggingface/transformers',
  runtimeVersion: '4.2.0',
  runtimeLicense: 'Apache-2.0',
  modelId: 'Xenova/whisper-tiny',
  modelRevision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
  modelLicense: 'apache-2.0',
  expectedSelectedTotalBytes: 100_102_365
};

const MODEL_SELECTED_FILES = [
  {
    file: 'onnx/encoder_model_q4.onnx',
    size: 9_006_044,
    hash: 'f895af36f57fec9cbeac8d29a982ae47b2e81e461d98320fbd30c47d01a6a13f',
    hashAlgorithm: 'sha256'
  },
  {
    file: 'onnx/decoder_model_merged_q4.onnx',
    size: 86_739_474,
    hash: '462a65ea8459402cded5e6f22a378ac410ec7e0aad9367ebb08431906c237660',
    hashAlgorithm: 'sha256'
  },
  { file: 'tokenizer.json', size: 2_480_466, hash: '1e95340ff836fad1b5932e800fb7b8c5e6d78a74', hashAlgorithm: 'git-blob-sha1' },
  { file: 'tokenizer_config.json', size: 282_683, hash: 'd13b786c04765fb1a06492b53587752cd67665ea', hashAlgorithm: 'git-blob-sha1' },
  { file: 'vocab.json', size: 1_036_584, hash: '90e797dd4fd05d9dea443d702ca06be2463c5f2f', hashAlgorithm: 'git-blob-sha1' },
  { file: 'merges.txt', size: 493_869, hash: '6038932a2a1f09a66991b1c2adae0d14066fa29e', hashAlgorithm: 'git-blob-sha1' },
  { file: 'normalizer.json', size: 52_666, hash: 'dd6ae819ad738ac1a546e9f9282ef325c33b9ea0', hashAlgorithm: 'git-blob-sha1' },
  { file: 'preprocessor_config.json', size: 339, hash: '91876762a536a746d268353c5cba57286e76b058', hashAlgorithm: 'git-blob-sha1' },
  { file: 'generation_config.json', size: 3_716, hash: '72e54ad7340e05287aa731f9d8556b5368be3fe0', hashAlgorithm: 'git-blob-sha1' },
  { file: 'config.json', size: 2_248, hash: 'dea913aa8ec7d53db029e97c97a766d534c8da04', hashAlgorithm: 'git-blob-sha1' },
  { file: 'special_tokens_map.json', size: 2_194, hash: 'bf69932dca4b3719b59fdd8f6cc1978109509f6c', hashAlgorithm: 'git-blob-sha1' },
  { file: 'added_tokens.json', size: 2_082, hash: 'a973b01f5b1e5755fb2fd8a89cbd0c0c0ccf1460', hashAlgorithm: 'git-blob-sha1' }
];

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

function createAbortableDeadline(timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    clear() {
      clearTimeout(timer);
    }
  };
}

export async function fetchJson(url, headers = API_HEADERS, { timeoutMs = JSON_REQUEST_TIMEOUT_MS } = {}) {
  const startedAt = performance.now();
  const deadline = createAbortableDeadline(timeoutMs);
  let status = null;
  try {
    const response = await fetch(url, { headers, signal: deadline.signal });
    status = response.status;
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { code: 'parse_failed', bodyPreview: text.slice(0, 160) };
    }
    return {
      status,
      elapsedMs: Math.round(performance.now() - startedAt),
      timeoutMs,
      timedOut: false,
      error: null,
      body
    };
  } catch (error) {
    return {
      status,
      elapsedMs: Math.round(performance.now() - startedAt),
      timeoutMs,
      timedOut: deadline.timedOut,
      error: describeError(error),
      body: null
    };
  } finally {
    deadline.clear();
  }
}

function getAudioUrl(playurlBody) {
  return playurlBody?.data?.dash?.audio?.[0]?.baseUrl ?? null;
}

function parseTotalBytes(contentRange) {
  const match = typeof contentRange === 'string' ? contentRange.match(/\/(\d+)$/) : null;
  return match ? Number(match[1]) : null;
}

function parseContentLength(contentLength) {
  const value = typeof contentLength === 'string' ? Number(contentLength) : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseContentRange(contentRange) {
  const match =
    typeof contentRange === 'string' ? contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i) : null;
  if (!match) return { rangeStart: null, rangeEnd: null, totalBytes: parseTotalBytes(contentRange) };
  return {
    rangeStart: Number(match[1]),
    rangeEnd: Number(match[2]),
    totalBytes: match[3] === '*' ? null : Number(match[3])
  };
}

function buildAudioHeaders(sample, range) {
  return {
    'User-Agent': API_HEADERS['User-Agent'],
    Referer: `https://www.bilibili.com/video/${sample.bvid}/`,
    Origin: 'https://www.bilibili.com',
    ...(range ? { Range: range } : {})
  };
}

async function readBodyEvidence(response) {
  const reader = response.body?.getReader() ?? null;
  let firstChunkBytes = 0;
  let bytesRead = 0;
  let bodyComplete = false;
  let readError = null;
  if (!reader) return { firstChunkBytes, bytesRead, bodyComplete, readError: 'no-readable-body' };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        bodyComplete = true;
        break;
      }
      if (firstChunkBytes === 0) firstChunkBytes = chunk.value.byteLength;
      bytesRead += chunk.value.byteLength;
    }
  } catch (error) {
    readError = describeError(error);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A failed stream may have released its lock already.
    }
  }
  return { firstChunkBytes, bytesRead, bodyComplete, readError };
}

export async function fetchRangeEvidence(
  sample,
  audioUrl,
  endByte,
  { timeoutMs = RANGE_REQUEST_TIMEOUT_MS } = {}
) {
  const requestedRangeStart = 0;
  const requestedRangeEnd = endByte;
  const requestedLengthBytes = requestedRangeEnd - requestedRangeStart + 1;
  const headers = buildAudioHeaders(sample, `bytes=${requestedRangeStart}-${requestedRangeEnd}`);
  const startedAt = performance.now();
  const deadline = createAbortableDeadline(timeoutMs);
  const evidence = {
    requestedRangeStart,
    requestedRangeEnd,
    requestedLengthBytes,
    status: null,
    elapsedMs: null,
    timeoutMs,
    timedOut: false,
    error: null,
    contentType: null,
    contentRange: null,
    contentLength: null,
    contentLengthBytes: null,
    rangeStart: null,
    rangeEnd: null,
    totalBytes: null,
    firstChunkBytes: 0,
    bytesRead: 0,
    bodyComplete: false,
    readError: null
  };
  try {
    const response = await fetch(audioUrl, { headers, signal: deadline.signal });
    const body = await readBodyEvidence(response);
    const contentRange = response.headers.get('content-range');
    const contentLength = response.headers.get('content-length');
    Object.assign(evidence, {
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentRange,
      contentLength,
      contentLengthBytes: parseContentLength(contentLength),
      ...parseContentRange(contentRange),
      ...body,
      timedOut: deadline.timedOut,
      error: deadline.timedOut ? body.readError ?? 'AbortError:network deadline exceeded' : null
    });
  } catch (error) {
    evidence.timedOut = deadline.timedOut;
    evidence.error = describeError(error);
    evidence.readError = describeError(error);
  } finally {
    deadline.clear();
    evidence.elapsedMs = Math.round(performance.now() - startedAt);
  }
  return evidence;
}

export async function cancelReadAfterFirstChunk(sample, audioUrl, { safetyTimeoutMs = 15_000 } = {}) {
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
  }, safetyTimeoutMs);

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
      aborted:
        error?.name === 'AbortError' &&
        abortReason === 'after-first-chunk' &&
        bytesReadBeforeAbort > 0 &&
        status !== null,
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

export async function streamAndDiscard(sample, audioUrl, { timeoutMs = FULL_STREAM_TIMEOUT_MS } = {}) {
  const headers = buildAudioHeaders(sample);
  const beforeMemory = process.memoryUsage().rss;
  const startedAt = performance.now();
  const deadline = createAbortableDeadline(timeoutMs);
  const evidence = {
    status: null,
    elapsedMs: null,
    timeoutMs,
    timedOut: false,
    error: null,
    contentType: null,
    contentRange: null,
    contentLength: null,
    contentLengthBytes: null,
    rangeStart: null,
    rangeEnd: null,
    totalBytes: null,
    firstChunkBytes: 0,
    bytesRead: 0,
    bodyComplete: false,
    readError: null,
    rssDeltaBytes: null
  };
  try {
    const response = await fetch(audioUrl, { headers, signal: deadline.signal });
    const body = await readBodyEvidence(response);
    const contentRange = response.headers.get('content-range');
    const contentLength = response.headers.get('content-length');
    Object.assign(evidence, {
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentRange,
      contentLength,
      contentLengthBytes: parseContentLength(contentLength),
      ...parseContentRange(contentRange),
      ...body,
      timedOut: deadline.timedOut,
      error: deadline.timedOut ? body.readError ?? 'AbortError:network deadline exceeded' : null
    });
  } catch (error) {
    evidence.timedOut = deadline.timedOut;
    evidence.error = describeError(error);
    evidence.readError = describeError(error);
  } finally {
    deadline.clear();
    evidence.elapsedMs = Math.round(performance.now() - startedAt);
    evidence.rssDeltaBytes = process.memoryUsage().rss - beforeMemory;
  }
  return evidence;
}

function mimeMatches(actual, expected) {
  return (
    typeof actual === 'string' &&
    typeof expected === 'string' &&
    actual.split(';', 1)[0].trim().toLowerCase() === expected.toLowerCase()
  );
}

function knownLengthsMatch(stream) {
  if (!stream || !(stream.bytesRead > 0)) return false;
  const knownMatches = [];
  if (Number.isSafeInteger(stream.contentLengthBytes)) {
    knownMatches.push(stream.bytesRead === stream.contentLengthBytes);
  }
  if (Number.isSafeInteger(stream.totalBytes)) {
    knownMatches.push(stream.bytesRead === stream.totalBytes);
  }
  if (knownMatches.length === 0 || knownMatches.some(matches => !matches)) return false;
  if (stream.status === 206) {
    return (
      stream.rangeStart === 0 &&
      stream.rangeEnd === stream.bytesRead - 1 &&
      stream.totalBytes === stream.bytesRead
    );
  }
  return true;
}

function rangeResponseMatchesRequest(range) {
  if (
    !Number.isSafeInteger(range?.requestedRangeStart) ||
    !Number.isSafeInteger(range?.requestedRangeEnd) ||
    !Number.isSafeInteger(range?.requestedLengthBytes) ||
    !Number.isSafeInteger(range?.totalBytes) ||
    range.requestedRangeStart < 0 ||
    range.requestedRangeEnd < range.requestedRangeStart ||
    range.requestedLengthBytes !== range.requestedRangeEnd - range.requestedRangeStart + 1 ||
    range.totalBytes <= range.requestedRangeStart
  ) {
    return false;
  }
  const expectedResponseEnd = Math.min(range.requestedRangeEnd, range.totalBytes - 1);
  const expectedResponseLength = expectedResponseEnd - range.requestedRangeStart + 1;
  return (
    range.rangeStart === range.requestedRangeStart &&
    range.rangeEnd === expectedResponseEnd &&
    range.contentLengthBytes === expectedResponseLength &&
    range.bytesRead === expectedResponseLength
  );
}

export function evaluatePublicSampleEvidence(evidence) {
  const { sample, view, subtitle, playurl, range, cancellation, fullStream } = evidence;
  const fullStreamMustValidate = sample?.requireFullStream === true || fullStream !== null;
  const checks = {
    viewHttpOk: view?.httpStatus === 200,
    viewWithinDeadline: view?.timedOut === false,
    viewApiOk: view?.apiCode === 0,
    bvidMatches: view?.bvid === sample?.bvid,
    titleMatches: view?.title === sample?.expectedTitle,
    currentCidMatches: String(view?.currentPageCid ?? '') === String(sample?.cid ?? ''),
    durationMatches:
      view?.durationSeconds === sample?.expectedDurationSeconds &&
      view?.currentPageDurationSeconds === sample?.expectedDurationSeconds,
    longDurationOk: sample?.requireLongDuration !== true || view?.currentPageDurationSeconds >= 5_400,
    subtitleHttpOk: subtitle?.httpStatus === 200,
    subtitleWithinDeadline: subtitle?.timedOut === false,
    subtitleApiOk: subtitle?.apiCode === 0,
    noSubtitles: subtitle?.count === 0,
    playurlHttpOk: playurl?.httpStatus === 200,
    playurlWithinDeadline: playurl?.timedOut === false,
    playurlApiOk: playurl?.apiCode === 0,
    audioPresent: playurl?.audioCount > 0,
    audioCodecMatches: playurl?.firstAudioCodec === sample?.expectedAudioCodec,
    rangeHttpPartial: range?.status === 206,
    rangeWithinDeadline: range?.timedOut === false,
    rangeMimeMatches: mimeMatches(range?.contentType, sample?.expectedAudioMime),
    rangeBodyComplete: range?.bodyComplete === true && range?.readError === null,
    rangeFirstChunkNonEmpty: range?.firstChunkBytes > 0 && range?.bytesRead > 0,
    rangeRequestContractMatches: rangeResponseMatchesRequest(range),
    rangeLengthMatches:
      Number.isSafeInteger(range?.contentLengthBytes) &&
      range.contentLengthBytes > 0 &&
      range.bytesRead === range.contentLengthBytes &&
      range.rangeStart === 0 &&
      range.rangeEnd === range.bytesRead - 1 &&
      Number.isSafeInteger(range.totalBytes) &&
      range.totalBytes >= range.bytesRead,
    cancellationAbortError: typeof cancellation?.result === 'string' && cancellation.result.startsWith('AbortError:'),
    cancellationAfterFirstChunk:
      cancellation?.aborted === true &&
      cancellation?.abortReason === 'after-first-chunk' &&
      cancellation?.bytesReadBeforeAbort > 0 &&
      cancellation?.status === 206,
    fullStreamPresent: sample?.requireFullStream !== true || fullStream !== null,
    fullStreamStatusOk: !fullStreamMustValidate || fullStream?.status === 200 || fullStream?.status === 206,
    fullStreamWithinDeadline: !fullStreamMustValidate || fullStream?.timedOut === false,
    fullStreamMimeMatches: !fullStreamMustValidate || mimeMatches(fullStream?.contentType, sample?.expectedAudioMime),
    fullStreamFirstChunkNonEmpty:
      !fullStreamMustValidate || (fullStream?.firstChunkBytes > 0 && fullStream?.bytesRead > 0),
    fullStreamComplete:
      !fullStreamMustValidate || (fullStream?.bodyComplete === true && fullStream?.readError === null),
    fullStreamLengthMatches: !fullStreamMustValidate || knownLengthsMatch(fullStream)
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return { ok: failures.length === 0, checks, failures };
}

export function summarizePublicSampleEvidence(results, expectedSampleCount = PUBLIC_SAMPLES.length) {
  const failedSampleIds = results.filter(result => !result.gate?.ok).map(result => result.sample.id);
  const actualSampleCount = results.length;
  return {
    ok: actualSampleCount === expectedSampleCount && failedSampleIds.length === 0,
    expectedSampleCount,
    actualSampleCount,
    passedCount: actualSampleCount - failedSampleIds.length,
    failedCount: failedSampleIds.length,
    failedSampleIds
  };
}

export function summarizeHarnessGates({ mv3Only, publicSamplesGate, modelRuntimeGate, mv3Gate }) {
  const requested = mv3Only
    ? { mv3: mv3Gate }
    : { publicSamples: publicSamplesGate, modelRuntime: modelRuntimeGate, mv3: mv3Gate };
  const failedGates = Object.entries(requested)
    .filter(([, gate]) => gate?.ok !== true)
    .map(([name]) => name);
  return {
    ok: failedGates.length === 0,
    evidenceGatesOk: failedGates.length === 0,
    asrProductGatesOk: false,
    decision: 'no-go',
    exitCode: failedGates.length === 0 ? 0 : 1,
    requestedGates: Object.keys(requested),
    failedGates
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
    const pages = view.body?.data?.pages ?? [];
    const currentPage = pages.find(page => String(page.cid) === String(sample.cid)) ?? null;
    const audioUrl = getAudioUrl(playurl.body);
    const range = audioUrl
      ? await fetchRangeEvidence(sample, audioUrl, sample.id === 'long-117m' ? 262143 : 1048575)
      : null;
    const cancellation = audioUrl ? await cancelReadAfterFirstChunk(sample, audioUrl) : null;
    const fullStream = audioUrl && sample.id === 'long-117m' ? await streamAndDiscard(sample, audioUrl) : null;
    const evidence = {
      sample,
      view: {
        httpStatus: view.status,
        timeoutMs: view.timeoutMs,
        timedOut: view.timedOut,
        error: view.error,
        apiCode: view.body?.code,
        bvid: view.body?.data?.bvid ?? null,
        title: view.body?.data?.title ?? null,
        durationSeconds: view.body?.data?.duration ?? null,
        pages: pages.length,
        currentPageCid: currentPage?.cid != null ? String(currentPage.cid) : null,
        currentPageDurationSeconds: currentPage?.duration ?? null
      },
      subtitle: {
        httpStatus: subtitle.status,
        timeoutMs: subtitle.timeoutMs,
        timedOut: subtitle.timedOut,
        error: subtitle.error,
        apiCode: subtitle.body?.code,
        count: subtitle.body?.data?.subtitle?.subtitles?.length ?? null,
        languages: (subtitle.body?.data?.subtitle?.subtitles ?? []).map(item => `${item.lan}:${item.lan_doc}`)
      },
      playurl: {
        httpStatus: playurl.status,
        timeoutMs: playurl.timeoutMs,
        timedOut: playurl.timedOut,
        error: playurl.error,
        apiCode: playurl.body?.code,
        audioCount: playurl.body?.data?.dash?.audio?.length ?? 0,
        firstAudioCodec: playurl.body?.data?.dash?.audio?.[0]?.codecs ?? null,
        firstAudioBandwidth: playurl.body?.data?.dash?.audio?.[0]?.bandwidth ?? null,
        firstAudioHost: audioUrl ? new URL(audioUrl).host : null
      },
      range,
      cancellation,
      fullStream
    };
    evidence.gate = evaluatePublicSampleEvidence(evidence);
    results.push(evidence);
  }
  const gate = summarizePublicSampleEvidence(results);
  return { ok: gate.ok, gate, samples: results };
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

export function evaluateModelRuntimeEvidence(evidence, candidate, expectedFiles) {
  const selectedFiles = evidence?.model?.selectedFiles ?? [];
  const fileChecks = Object.fromEntries(
    expectedFiles.map(expected => {
      const actual = selectedFiles.find(file => file.file === expected.file);
      return [
        expected.file,
        {
          present: actual?.present === true,
          sizeMatches: actual?.size === expected.size,
          hashMatches: actual?.hash === expected.hash,
          hashAlgorithmMatches: actual?.hashAlgorithm === expected.hashAlgorithm
        }
      ];
    })
  );
  const allFileChecksPass = Object.values(fileChecks).every(checks => Object.values(checks).every(Boolean));
  const expectedTotalBytes = expectedFiles.reduce((sum, file) => sum + file.size, 0);
  const checks = {
    runtimeHttpOk: evidence?.runtime?.httpStatus === 200,
    runtimeWithinDeadline: evidence?.runtime?.timedOut === false,
    runtimeNameMatches: evidence?.runtime?.name === candidate.runtimePackage,
    runtimeVersionMatches: evidence?.runtime?.version === candidate.runtimeVersion,
    runtimeLicenseMatches:
      typeof evidence?.runtime?.license === 'string' &&
      evidence.runtime.license.toLowerCase() === candidate.runtimeLicense.toLowerCase(),
    modelHttpOk: evidence?.model?.httpStatus === 200,
    modelWithinDeadline: evidence?.model?.timedOut === false,
    modelIdMatches: evidence?.model?.id === candidate.modelId,
    modelRevisionMatches: evidence?.model?.sha === candidate.modelRevision,
    modelLicenseMatches:
      typeof evidence?.model?.license === 'string' &&
      evidence.model.license.toLowerCase() === candidate.modelLicense.toLowerCase(),
    expectedFileCountIsTwelve: expectedFiles.length === 12,
    selectedFileCountMatches: selectedFiles.length === expectedFiles.length,
    selectedFilesMatch: allFileChecksPass,
    selectedTotalBytesMatch:
      candidate.expectedSelectedTotalBytes === expectedTotalBytes &&
      evidence?.model?.selectedTotalBytes === expectedTotalBytes
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return { ok: failures.length === 0, checks, fileChecks, failures };
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
  const selected = MODEL_SELECTED_FILES.map(expected => {
    const filename = expected.file;
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
  const evidence = {
    candidate: MODEL_CANDIDATE,
    runtime: {
      httpStatus: npmPackage.status,
      timeoutMs: npmPackage.timeoutMs,
      timedOut: npmPackage.timedOut,
      error: npmPackage.error,
      name: npmPackage.body?.name ?? null,
      version: npmPackage.body?.version ?? null,
      license: npmPackage.body?.license ?? null,
      integrity: npmPackage.body?.dist?.integrity ?? null,
      unpackedSize: npmPackage.body?.dist?.unpackedSize ?? null,
      dependencies: npmPackage.body?.dependencies ?? null
    },
    model: {
      httpStatus: model.status,
      timeoutMs: model.timeoutMs,
      timedOut: model.timedOut,
      error: model.error,
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
  evidence.gate = evaluateModelRuntimeEvidence(evidence, MODEL_CANDIDATE, MODEL_SELECTED_FILES);
  evidence.ok = evidence.gate.ok;
  return evidence;
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

export function getMv3LifecycleUnavailableEvidence(platform = process.platform) {
  return {
    ok: false,
    executed: false,
    platform,
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
  };
}

export function createSpikeServiceWorkerSource(marker) {
  return `
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
globalThis.ASR_SPIKE_RUN_PROMISE = run().catch(async error => {
  result.phase = 'failed';
  result.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
  try {
    await persist();
  } catch (persistenceError) {
    result.persistenceFailure = {
      name: persistenceError?.name ?? 'Error',
      message: persistenceError?.message ?? String(persistenceError)
    };
    globalThis.ASR_SPIKE_RESULT = result;
  }
});
`;
}

async function main() {
  const startedAt = new Date().toISOString();
  const mv3Only = process.argv.includes('--mv3-only');
  let audio = null;
  if (!mv3Only) {
    try {
      audio = await probePublicAudio();
    } catch (error) {
      audio = {
        ok: false,
        error: describeError(error),
        samples: [],
        gate: { ok: false, failures: ['probeError'], error: describeError(error) }
      };
    }
  }
  let model = null;
  if (!mv3Only) {
    try {
      model = await probeModelCandidate();
    } catch (error) {
      model = {
        ok: false,
        error: describeError(error),
        gate: { ok: false, failures: ['probeError'], error: describeError(error) }
      };
    }
  }
  const mv3 = getMv3LifecycleUnavailableEvidence();
  const machineGates = {
    publicSamples: mv3Only ? null : audio?.gate ?? { ok: false, failures: ['missingGate'] },
    modelRuntime: mv3Only ? null : model?.gate ?? { ok: false, failures: ['missingGate'] },
    mv3: {
      ok: mv3?.ok === true,
      failures: mv3?.ok === true ? [] : [mv3.reason]
    }
  };
  const overall = summarizeHarnessGates({
    mv3Only,
    publicSamplesGate: machineGates.publicSamples,
    modelRuntimeGate: machineGates.modelRuntime,
    mv3Gate: machineGates.mv3
  });
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
    publicSamples: mv3Only ? null : audio?.samples ?? [],
    modelCandidate: model,
    mv3Lifecycle: mv3,
    machineGates,
    overall,
    harnessExitCode: overall.exitCode
  };
  console.log(JSON.stringify(output, null, 2));
  if (overall.exitCode !== 0) process.exitCode = overall.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
