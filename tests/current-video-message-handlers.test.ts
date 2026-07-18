import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeBilibiliTranscriptEvidence } from '../src/shared/current-video-transcript-cache.ts';
import {
  clearTemporaryCurrentVideoTranscriptCache,
  getTemporaryCurrentVideoTranscriptSegments,
  putTemporaryCurrentVideoTranscriptEvidence,
} from '../src/background/current-video-temporary-transcript-cache.ts';
import { retainTemporaryTranscriptOwnerForContextSnapshot } from '../src/background/current-video-transcript-owner.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type { BiliVizRequest, BiliVizResponse } from '../src/shared/types/messages.ts';
import type { CurrentVideoSegmentRetrievalResult } from '../src/shared/types/current-video-segment-retrieval.ts';
import type { CurrentVideoSummaryResult } from '../src/shared/types/current-video-summary.ts';
import type { VideoKnowledgeResult } from '../src/shared/types/video-knowledge.ts';
import { db } from '../src/background/storage/db.ts';
import { upsertCurrentVideoTranscriptEvidence } from '../src/background/storage/current-video-transcript-repo.ts';

type RuntimeListener = (
  message: unknown,
  sender: { tab?: { id?: number; url?: string | null } },
  sendResponse: (response: unknown) => void,
) => boolean | undefined;
type RemovedListener = (tabId: number) => void;
type UpdatedListener = (tabId: number, changeInfo: { url?: string }) => void;
type FakeTab = { id: number; url: string | null; active: boolean; lastAccessed: number | null };

const runtimeListeners: RuntimeListener[] = [];
const removedListeners: RemovedListener[] = [];
const updatedListeners: UpdatedListener[] = [];
const tabs: FakeTab[] = [];
const tabMessageHandlers = new Map<number, (message: unknown) => Promise<unknown> | unknown>();
const storageValues: Record<string, unknown> = {};
const storageGetCounts = new Map<string, number>();

installChromeFake();
const { setupMessageHandlers } = await importBundledMessageHandlers();
setupMessageHandlers();

test('fixed popup tab owner keeps A context readable after active tab switches to B', () => {
  clearTemporaryCurrentVideoTranscriptCache();
  const contextA = handlerVideoContext('BV1HandlerA0', 8801);
  const tabA = 801;
  const tabB = 802;
  const ownerA = retainTemporaryTranscriptOwnerForContextSnapshot(contextA, tabA);
  assert.ok(ownerA);

  const evidenceA = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'A 标签页的临时字幕应该跟随初始 owner。' }] },
    {
      bvid: contextA.bvid,
      cid: contextA.cid as number,
      page: contextA.currentPart.page,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: '7',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_000,
    },
  );
  assert.equal(putTemporaryCurrentVideoTranscriptEvidence(ownerA, evidenceA).status, 'stored');

  const activeTabAfterDelay = tabB;
  const ownerFromWrongActiveTab = retainTemporaryTranscriptOwnerForContextSnapshot(contextA, activeTabAfterDelay);
  assert.ok(ownerFromWrongActiveTab);
  const identity = {
    bvid: evidenceA.sourceRecord.bvid,
    cid: evidenceA.sourceRecord.cid,
    page: evidenceA.sourceRecord.page,
    language: evidenceA.sourceRecord.language,
    sourceIdentityKey: evidenceA.sourceRecord.sourceIdentityKey,
    sourceHash: evidenceA.sourceRecord.sourceHash,
  };

  assert.equal(getTemporaryCurrentVideoTranscriptSegments(ownerA, identity).length, 1);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(ownerFromWrongActiveTab, identity).length, 0);
});

test('handler clears same-BV page-1 context on page navigation and refreshes page 2 without touching A', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_601;
  const bvid = 'BV1SameBvLeak9';
  const contextA = handlerVideoContext(bvid, 4101, 1);
  const contextB = handlerVideoContext(bvid, 4102, 2);
  const evidenceA = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 3, content: 'persistent A before same BV page navigation' }] },
    {
      bvid,
      cid: 4101,
      page: 1,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: 'same-bv-a',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_100,
    },
  );
  await upsertCurrentVideoTranscriptEvidence(evidenceA);
  const sourceBefore = await transcriptSource(evidenceA.sourceRecord.identityKey);

  setTabs([{ id: tabId, url: contextA.url, active: true, lastAccessed: 1_000 }]);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: contextA,
  }, tabId, contextA.url);

  let freshContextRequests = 0;
  setTabMessageHandler(tabId, (message) => {
    assert.deepEqual(message, {
      action: 'COLLECT_CURRENT_VIDEO_CONTEXT',
      payload: {},
    });
    freshContextRequests += 1;
    return contextB;
  });

  emitTabUpdated(tabId, contextB.url);
  setTabs([{ id: tabId, url: contextB.url, active: true, lastAccessed: 2_000 }]);

  const response = await sendRequest<CurrentVideoSegmentRetrievalResult>({
    action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
    params: {
      query: 'persistent A before same BV page navigation',
      primaryTextSelectionsReady: true,
    },
  }, tabId, contextB.url);

  assert.equal(response.success, true);
  assert.equal(freshContextRequests, 1);
  assert.equal(response.data?.status, 'no_evidence');
  assert.equal(response.data?.candidates.length, 0);
  assert.equal(response.data?.evidenceState.transcriptSegmentCount, 0);

  const sourceAfter = await transcriptSource(evidenceA.sourceRecord.identityKey);
  assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
});

test('handler rejects late page-1 context updates after the sender tab is on page 2', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_602;
  const bvid = 'BV1LateCtx186';
  const contextA = handlerVideoContext(bvid, 4201, 1);
  const contextB = handlerVideoContext(bvid, 4202, 2);
  setTabs([{ id: tabId, url: contextB.url, active: true, lastAccessed: 2_000 }]);
  setTabMessageHandler(tabId, () => contextB);

  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: contextB,
  }, tabId, contextB.url);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: contextA,
  }, tabId, contextB.url);

  const response = await sendRequest<CurrentVideoContext>({
    action: 'GET_CURRENT_VIDEO_CONTEXT',
    params: {},
  }, tabId, contextB.url);

  assert.equal(response.success, true);
  assert.equal(response.data?.kind, 'video');
  assert.equal(response.data?.kind === 'video' ? response.data.cid : null, 4202);
  assert.equal(response.data?.kind === 'video' ? response.data.currentPart.page : null, 2);
});

test('handler ignores late no-context updates without overwriting the current video snapshot', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_603;
  const context = handlerVideoContext('BV1NoCtxLate9', 4301, 1);
  let freshContextRequests = 0;
  setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 2_000 }]);
  setTabMessageHandler(tabId, () => {
    freshContextRequests += 1;
    return context;
  });

  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: context,
  }, tabId, context.url);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: {
      kind: 'no_context',
      url: 'https://www.bilibili.com/',
      collectedAt: Date.now(),
      reason: 'non_video_page',
      pageType: 'non_video',
    },
  }, tabId, context.url);

  const response = await sendRequest<CurrentVideoContext>({
    action: 'GET_CURRENT_VIDEO_CONTEXT',
    params: {},
  }, tabId, context.url);

  assert.equal(response.success, true);
  assert.equal(response.data?.kind, 'video');
  assert.equal(response.data?.kind === 'video' ? response.data.cid : null, 4301);
  assert.equal(freshContextRequests, 0);
});

test('background full-text handlers fail closed while primary text selection readiness is false', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_604;
  const context = handlerVideoContext('BV1Readiness9', 4401, 1);
  const evidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 4, to: 8, content: 'active V2 transcript must not be used while selection storage is loading' }] },
    {
      bvid: context.bvid,
      cid: context.cid as number,
      page: context.currentPart.page,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: 'readiness-v2',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_200,
    },
  );
  await upsertCurrentVideoTranscriptEvidence(evidence);
  const sourceBefore = await transcriptSource(evidence.sourceRecord.identityKey);

  setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 3_000 }]);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: context,
  }, tabId, context.url);

  const readinessParams = { primaryTextSelectionsReady: false };
  const summary = await sendRequest<CurrentVideoSummaryResult>({
    action: 'GET_CURRENT_VIDEO_SUMMARY',
    params: readinessParams,
  }, tabId, context.url);
  const knowledge = await sendRequest<VideoKnowledgeResult>({
    action: 'GET_VIDEO_KNOWLEDGE',
    params: readinessParams,
  }, tabId, context.url);
  const search = await sendRequest<CurrentVideoSegmentRetrievalResult>({
    action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
    params: {
      ...readinessParams,
      query: 'active V2 transcript',
    },
  }, tabId, context.url);

  assert.equal(summary.success, true);
  assert.equal(summary.data?.status, 'cancelled');
  assert.match(summary.data?.summary ?? '', /主要文本来源/);
  assert.equal(summary.data?.sourceTier, null);

  assert.equal(knowledge.success, true);
  assert.equal(knowledge.data?.nodes.length, 0);
  assert.equal(knowledge.data?.sourceState.transcriptEvidence, false);
  assert.match(knowledge.data?.limitations.join(' ') ?? '', /主要文本来源/);

  assert.equal(search.success, true);
  assert.equal(search.data?.status, 'no_evidence');
  assert.equal(search.data?.candidates.length, 0);
  assert.equal(search.data?.evidenceState.transcriptSegmentCount, 0);
  assert.match(search.data?.summary ?? '', /主要文本来源/);
  assert.equal(search.data?.aiRerank.status, 'not_requested');
  assert.equal(search.data?.qa.aiState.status, 'not_requested');

  const sourceAfter = await transcriptSource(evidence.sourceRecord.identityKey);
  assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
  assert.equal(storageReadCount('userConfig'), 0);
});

function handlerVideoContext(bvid: string, cid: number, page = 1): CurrentVideoContext {
  return {
    kind: 'video',
    url: `https://www.bilibili.com/video/${bvid}?p=${page}`,
    collectedAt: Date.now(),
    bvid,
    aid: cid,
    cid,
    title: `Handler video ${cid} page ${page}`,
    authorName: 'Handler UP',
    authorMid: 42,
    durationSeconds: 120,
    currentPart: { page, title: `P${page}`, total: 2 },
    parts: [{ page, cid, title: `P${page}`, durationSeconds: 120 }],
    chapters: [],
    description: {
      availability: 'available',
      text: 'Handler context visible description.',
      length: 36,
    },
    sources: {
      metadata: 'available',
      description: 'available',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'available',
      contentText: 'unavailable',
    },
    subtitleProbe: {
      status: 'unsupported',
      available: false,
      checkedAt: Date.now(),
      bvid,
      cid,
      page,
      sourceType: 'none',
      sourceDomain: null,
      sourcePath: null,
      needLoginSubtitle: null,
      trackCount: 0,
      segmentCount: null,
      coverageStartSeconds: null,
      coverageEndSeconds: null,
      languages: [],
      tracks: [],
      reason: 'handler_test',
      message: 'Handler test does not probe remote subtitle sources.',
      warnings: [],
    },
    transcriptEvidence: null,
    warnings: ['transcript_probe_pending'],
  };
}

function installChromeFake(): void {
  (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener(listener: RuntimeListener) {
          runtimeListeners.push(listener);
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener: RemovedListener) {
          removedListeners.push(listener);
        },
      },
      onUpdated: {
        addListener(listener: UpdatedListener) {
          updatedListeners.push(listener);
        },
      },
      sendMessage(tabId: number, message: unknown) {
        const handler = tabMessageHandlers.get(tabId);
        if (!handler) {
          return Promise.reject(new Error(`No fake tab message handler for ${tabId}`));
        }
        return Promise.resolve(handler(message));
      },
    },
    windows: {
      getAll() {
        return Promise.resolve([{ tabs: tabs.map(tab => ({ ...tab })) }]);
      },
    },
    storage: {
      local: {
        get(keys: string | string[] | Record<string, unknown> | null | undefined) {
          recordStorageGet(keys);
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: storageValues[keys] });
          }
          if (Array.isArray(keys)) {
            return Promise.resolve(Object.fromEntries(keys.map(key => [key, storageValues[key]])));
          }
          if (keys && typeof keys === 'object') {
            return Promise.resolve(Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [key, storageValues[key] ?? fallback]),
            ));
          }
          return Promise.resolve({ ...storageValues });
        },
        set(values: Record<string, unknown>) {
          Object.assign(storageValues, values);
          return Promise.resolve();
        },
        remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storageValues[key];
          }
          return Promise.resolve();
        },
      },
    },
  };
}

function resetChromeHarness(): void {
  tabs.length = 0;
  tabMessageHandlers.clear();
  for (const key of Object.keys(storageValues)) {
    delete storageValues[key];
  }
  storageGetCounts.clear();
}

function setTabs(nextTabs: FakeTab[]): void {
  tabs.length = 0;
  tabs.push(...nextTabs);
}

function setTabMessageHandler(tabId: number, handler: (message: unknown) => Promise<unknown> | unknown): void {
  tabMessageHandlers.set(tabId, handler);
}

function emitTabUpdated(tabId: number, url: string): void {
  for (const listener of updatedListeners) {
    listener(tabId, { url });
  }
}

async function sendContentMessage(
  message: unknown,
  tabId: number,
  senderUrl: string,
): Promise<BiliVizResponse> {
  return await sendRuntimeMessage(message, tabId, senderUrl);
}

async function sendRequest<T>(
  request: BiliVizRequest,
  tabId: number,
  senderUrl: string,
): Promise<BiliVizResponse<T>> {
  return await sendRuntimeMessage<BiliVizResponse<T>>(request, tabId, senderUrl);
}

async function sendRuntimeMessage<T>(
  message: unknown,
  tabId: number,
  senderUrl: string,
): Promise<T> {
  const listener = runtimeListeners[0];
  assert.ok(listener, 'message handler was not registered');
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const keepOpen = listener(
      message,
      { tab: { id: tabId, url: senderUrl } },
      (response) => {
        settled = true;
        resolve(response as T);
      },
    );
    if (keepOpen !== true && !settled) {
      reject(new Error('Fake runtime listener did not respond synchronously or keep the channel open'));
    }
  });
}

async function resetTranscriptDb(): Promise<void> {
  clearTemporaryCurrentVideoTranscriptCache();
  await db.currentVideoTranscriptSegments.clear();
  await db.currentVideoTranscriptSources.clear();
}

async function transcriptSource(identityKey: string | undefined) {
  assert.ok(identityKey);
  return await db.currentVideoTranscriptSources
    .where('identityKey')
    .equals(identityKey)
    .first();
}

function recordStorageGet(keys: string | string[] | Record<string, unknown> | null | undefined): void {
  const recordKey = (key: string) => {
    storageGetCounts.set(key, (storageGetCounts.get(key) ?? 0) + 1);
  };
  if (typeof keys === 'string') {
    recordKey(keys);
  } else if (Array.isArray(keys)) {
    for (const key of keys) recordKey(key);
  } else if (keys && typeof keys === 'object') {
    for (const key of Object.keys(keys)) recordKey(key);
  }
}

function storageReadCount(key: string): number {
  return storageGetCounts.get(key) ?? 0;
}

async function importBundledMessageHandlers(): Promise<{
  setupMessageHandlers: () => void;
}> {
  const { build } = await import('esbuild');
  const outdir = await mkdtemp(join(tmpdir(), 'bili-bill-handlers-'));
  const outfile = join(outdir, 'handlers.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/background/messages/handlers.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    outfile,
    logLevel: 'silent',
  });
  return await import(pathToFileURL(outfile).href) as { setupMessageHandlers: () => void };
}
