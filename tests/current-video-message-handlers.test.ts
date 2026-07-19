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
import type {
  CurrentVideoSegmentRetrievalResult,
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from '../src/shared/types/current-video-segment-retrieval.ts';
import type { CurrentVideoSummaryResult } from '../src/shared/types/current-video-summary.ts';
import type { VideoKnowledgeResult } from '../src/shared/types/video-knowledge.ts';
import { db } from '../src/background/storage/db.ts';
import { upsertCurrentVideoTranscriptEvidence } from '../src/background/storage/current-video-transcript-repo.ts';
import {
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
  type SaveCurrentVideoPrimaryTextSelectionResult,
} from '../src/shared/current-video-primary-text-selection.ts';

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
let rejectPrimaryTextSelectionStorageReads = false;

installChromeFake();
const { setupMessageHandlers } = await importBundledMessageHandlers();
setupMessageHandlers();

test('background selection action serializes interleaved tab saves without replacing other parts', async () => {
  resetChromeHarness();
  const storageKey = CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY;
  storageValues[storageKey] = {
    'BV1SavedA:1001:1': 'source-a',
    'BV1SavedB:1002:2': 'source-b',
  };

  const [tabOne, tabTwo] = await Promise.all([
    sendRequest<SaveCurrentVideoPrimaryTextSelectionResult>({
      action: 'SAVE_CURRENT_VIDEO_PRIMARY_TEXT_SELECTION' as BiliVizRequest['action'],
      params: {
        bvid: 'BV1SavedC',
        cid: 1003,
        page: 3,
        selectedSourceIdentityKey: 'source-c',
      },
    }, 19_001, 'https://www.bilibili.com/video/BV1SavedC?p=3'),
    sendRequest<SaveCurrentVideoPrimaryTextSelectionResult>({
      action: 'SAVE_CURRENT_VIDEO_PRIMARY_TEXT_SELECTION' as BiliVizRequest['action'],
      params: {
        bvid: 'BV1SavedD',
        cid: 1004,
        page: 4,
        selectedSourceIdentityKey: 'source-d',
      },
    }, 19_002, 'https://www.bilibili.com/video/BV1SavedD?p=4'),
  ]);

  assert.equal(tabOne.success, true);
  assert.equal(tabTwo.success, true);
  assert.deepEqual(storageValues[storageKey], {
    'BV1SavedA:1001:1': 'source-a',
    'BV1SavedB:1002:2': 'source-b',
    'BV1SavedC:1003:3': 'source-c',
    'BV1SavedD:1004:4': 'source-d',
  });
  assert.deepEqual(tabTwo.data?.selections, storageValues[storageKey]);
});

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

test('request-tab lookup revalidates stale same-BV page context before exact-source search', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_608;
  const bvid = 'BV1RequestTabRace';
  const contextP1 = handlerVideoContext(bvid, 4801, 1);
  const contextP2 = handlerVideoContext(bvid, 4802, 2);
  const evidenceP1 = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 3, content: 'page one exact transcript must not leak into page two' }] },
    {
      bvid,
      cid: 4801,
      page: 1,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: 'request-tab-race-p1',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_600,
    },
  );
  await upsertCurrentVideoTranscriptEvidence(evidenceP1);
  await db.currentVideoTranscriptSources
    .where('identityKey')
    .equals(evidenceP1.sourceRecord.identityKey)
    .modify({ lastAccessedAt: 1_000 });
  const sourceBefore = await transcriptSource(evidenceP1.sourceRecord.identityKey);

  setTabs([{ id: tabId, url: contextP1.url, active: true, lastAccessed: 7_000 }]);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: contextP1,
  }, tabId, contextP1.url);

  let freshContextRequests = 0;
  setTabMessageHandler(tabId, (message) => {
    assert.deepEqual(message, {
      action: 'COLLECT_CURRENT_VIDEO_CONTEXT',
      payload: {},
    });
    freshContextRequests += 1;
    return contextP2;
  });

  setTabs([{ id: tabId, url: contextP2.url, active: true, lastAccessed: 8_000 }]);
  const search = await sendRequest<CurrentVideoSegmentRetrievalResult>({
    action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
    params: {
      query: 'page one exact transcript',
      primaryTextSelectionsReady: true,
      selectedSourceIdentityKey: evidenceP1.sourceRecord.sourceIdentityKey,
    },
  }, tabId, contextP2.url);

  assert.equal(search.success, true);
  assert.equal(freshContextRequests, 1);
  assert.equal(search.data?.status, 'no_evidence');
  assert.equal(search.data?.candidates.length, 0);
  assert.equal(search.data?.evidenceState.transcriptSegmentCount, 0);

  const sourceAfter = await transcriptSource(evidenceP1.sourceRecord.identityKey);
  assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);

  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: contextP1,
  }, tabId, contextP2.url);
  const contextAfterLateP1 = await sendRequest<CurrentVideoContext>({
    action: 'GET_CURRENT_VIDEO_CONTEXT',
    params: {},
  }, tabId, contextP2.url);

  assert.equal(contextAfterLateP1.success, true);
  assert.equal(contextAfterLateP1.data?.kind, 'video');
  assert.equal(contextAfterLateP1.data?.kind === 'video' ? contextAfterLateP1.data.cid : null, 4802);
  assert.equal(contextAfterLateP1.data?.kind === 'video' ? contextAfterLateP1.data.currentPart.page : null, 2);
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
  const jump = await sendRequest<CurrentVideoTimestampJumpResponse>({
    action: 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP',
    params: {
      ...readinessParams,
      candidateId: 'readiness-blocked-candidate',
      query: 'active V2 transcript',
      confirmed: true,
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

  assert.equal(jump.success, true);
  assert.equal(jump.data?.ok, false);
  assert.equal(jump.data?.targetSeconds, null);
  assert.match(jump.data?.message ?? '', /主要文本来源/);

  const sourceAfter = await transcriptSource(evidence.sourceRecord.identityKey);
  assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
  assert.equal(storageReadCount('userConfig'), 0);
});

test('background full-text handlers fail closed when the readiness marker is missing or malformed', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_605;
  const context = handlerVideoContext('BV1MissingReady9', 4501, 1);
  const evidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 9, to: 13, content: 'marker absent V2 body must remain unread' }] },
    {
      bvid: context.bvid,
      cid: context.cid as number,
      page: context.currentPart.page,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: 'missing-marker-v2',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_300,
    },
  );
  await upsertCurrentVideoTranscriptEvidence(evidence);
  const sourceBefore = await transcriptSource(evidence.sourceRecord.identityKey);

  setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 4_000 }]);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: context,
  }, tabId, context.url);

  const summary = await sendRequest<CurrentVideoSummaryResult>({
    action: 'GET_CURRENT_VIDEO_SUMMARY',
    params: {},
  }, tabId, context.url);
  const knowledge = await sendRequest<VideoKnowledgeResult>({
    action: 'GET_VIDEO_KNOWLEDGE',
    params: {},
  }, tabId, context.url);
  const search = await sendRequest<CurrentVideoSegmentRetrievalResult>({
    action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
    params: { query: 'marker absent V2 body' },
  }, tabId, context.url);
  const jump = await sendRequest<CurrentVideoTimestampJumpResponse>({
    action: 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP',
    params: {
      candidateId: 'missing-marker-candidate',
      query: 'marker absent V2 body',
      confirmed: true,
    },
  }, tabId, context.url);
  const malformed = await sendRequest<CurrentVideoSummaryResult>({
    action: 'GET_CURRENT_VIDEO_SUMMARY',
    params: { primaryTextSelectionsReady: 'true' },
  }, tabId, context.url);

  assert.equal(summary.data?.status, 'cancelled');
  assert.equal(summary.data?.sourceTier, null);
  assert.equal(knowledge.data?.nodes.length, 0);
  assert.equal(knowledge.data?.sourceState.transcriptEvidence, false);
  assert.equal(search.data?.status, 'no_evidence');
  assert.equal(search.data?.candidates.length, 0);
  assert.equal(search.data?.evidenceState.transcriptSegmentCount, 0);
  assert.equal(search.data?.aiRerank.status, 'not_requested');
  assert.equal(search.data?.qa.aiState.status, 'not_requested');
  assert.equal(jump.data?.ok, false);
  assert.equal(jump.data?.targetSeconds, null);
  assert.match(jump.data?.message ?? '', /主要文本来源/);
  assert.equal(malformed.data?.status, 'cancelled');

  const sourceAfter = await transcriptSource(evidence.sourceRecord.identityKey);
  assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
  assert.equal(storageReadCount('userConfig'), 0);
});

test('background keeps an exact missing saved V1 selection inactive without touching active V2', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_606;
  const context = handlerVideoContext('BV1MissingV19', 4601, 1);
  const evidenceV2 = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 14, to: 19, content: 'persistent active V2 must not replace the missing saved V1 source' }] },
    {
      bvid: context.bvid,
      cid: context.cid as number,
      page: context.currentPart.page,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: 'missing-v1-active-v2',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_400,
    },
  );
  await upsertCurrentVideoTranscriptEvidence(evidenceV2);
  await db.currentVideoTranscriptSources
    .where('identityKey')
    .equals(evidenceV2.sourceRecord.identityKey)
    .modify({ lastAccessedAt: 1_000 });
  const sourceBefore = await transcriptSource(evidenceV2.sourceRecord.identityKey);
  const missingV1Key = `primary-text:bilibili_subtitle:${context.bvid}:${context.cid}:1:zh-cn:saved-v1-missing`;

  setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 5_000 }]);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: context,
  }, tabId, context.url);

  const selectedParams = {
    primaryTextSelectionsReady: true,
    selectedSourceIdentityKey: missingV1Key,
  };
  const summary = await sendRequest<CurrentVideoSummaryResult>({
    action: 'GET_CURRENT_VIDEO_SUMMARY',
    params: selectedParams,
  }, tabId, context.url);
  const knowledge = await sendRequest<VideoKnowledgeResult>({
    action: 'GET_VIDEO_KNOWLEDGE',
    params: selectedParams,
  }, tabId, context.url);
  const search = await sendRequest<CurrentVideoSegmentRetrievalResult>({
    action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
    params: {
      ...selectedParams,
      query: 'persistent active V2 must not replace',
    },
  }, tabId, context.url);
  const jump = await sendRequest<CurrentVideoTimestampJumpResponse>({
    action: 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP',
    params: {
      ...selectedParams,
      candidateId: 'missing-v1-candidate',
      query: 'persistent active V2 must not replace',
      confirmed: true,
    },
  }, tabId, context.url);

  assert.notEqual(summary.data?.sourceTier, 'transcript_summary');
  assert.equal(summary.data?.evidence.some(item => item.source === 'transcript'), false);
  assert.equal(summary.data?.timestampRanges.length, 0);
  assert.equal(knowledge.data?.sourceState.transcriptEvidence, false);
  assert.equal(knowledge.data?.nodes.some(node => node.source === 'transcript'), false);
  assert.equal(search.data?.status, 'no_evidence');
  assert.equal(search.data?.candidates.length, 0);
  assert.equal(search.data?.evidenceState.transcriptSegmentCount, 0);
  assert.notEqual(search.data?.aiRerank.status, 'generated');
  assert.notEqual(search.data?.qa.aiState.status, 'generated');
  assert.equal(jump.data?.ok, false);
  assert.equal(jump.data?.targetSeconds, null);

  const sourceAfter = await transcriptSource(evidenceV2.sourceRecord.identityKey);
  assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
});

test('background does not authorize active V2 when readiness is true without an exact source key', async () => {
  resetChromeHarness();
  await resetTranscriptDb();

  const tabId = 18_607;
  const context = handlerVideoContext('BV1NoExactKey9', 4701, 1);
  const evidenceV2 = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 20, to: 25, content: 'persistent V2 requires an exact primary text identity' }] },
    {
      bvid: context.bvid,
      cid: context.cid as number,
      page: context.currentPart.page,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: 'no-exact-key-v2',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_500,
    },
  );
  await upsertCurrentVideoTranscriptEvidence(evidenceV2);
  await db.currentVideoTranscriptSources
    .where('identityKey')
    .equals(evidenceV2.sourceRecord.identityKey)
    .modify({ lastAccessedAt: 1_000 });
  const sourceBefore = await transcriptSource(evidenceV2.sourceRecord.identityKey);

  setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 6_000 }]);
  await sendContentMessage({
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: context,
  }, tabId, context.url);

  const readyWithoutSource = { primaryTextSelectionsReady: true };
  const summary = await sendRequest<CurrentVideoSummaryResult>({
    action: 'GET_CURRENT_VIDEO_SUMMARY',
    params: readyWithoutSource,
  }, tabId, context.url);
  const knowledge = await sendRequest<VideoKnowledgeResult>({
    action: 'GET_VIDEO_KNOWLEDGE',
    params: readyWithoutSource,
  }, tabId, context.url);
  const search = await sendRequest<CurrentVideoSegmentRetrievalResult>({
    action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
    params: {
      ...readyWithoutSource,
      query: 'persistent V2 requires an exact primary text identity',
    },
  }, tabId, context.url);
  const jump = await sendRequest<CurrentVideoTimestampJumpResponse>({
    action: 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP',
    params: {
      ...readyWithoutSource,
      candidateId: 'no-exact-key-candidate',
      query: 'persistent V2 requires an exact primary text identity',
      confirmed: true,
    },
  }, tabId, context.url);

  assert.notEqual(summary.data?.sourceTier, 'transcript_summary');
  assert.equal(summary.data?.evidence.some(item => item.source === 'transcript'), false);
  assert.equal(summary.data?.timestampRanges.length, 0);
  assert.equal(knowledge.data?.sourceState.transcriptEvidence, false);
  assert.equal(knowledge.data?.nodes.some(node => node.source === 'transcript'), false);
  assert.equal(search.data?.status, 'no_evidence');
  assert.equal(search.data?.candidates.length, 0);
  assert.equal(search.data?.evidenceState.transcriptSegmentCount, 0);
  assert.equal(jump.data?.ok, false);
  assert.equal(jump.data?.targetSeconds, null);

  const sourceAfter = await transcriptSource(evidenceV2.sourceRecord.identityKey);
  assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
});

test('protected handlers re-read persisted primary text authorization before touching exact transcript body', async (t) => {
  await t.test('a saved replacement blocks the key that the UI read earlier', async () => {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_609;
    const context = handlerVideoContext('BV1FreshSelectionA', 4901);
    const evidence = await seedHandlerTranscript(
      context,
      'fresh-selection-a',
      'fresh selection replacement must block this exact body',
    );
    await db.currentVideoTranscriptSources
      .where('identityKey')
      .equals(evidence.sourceRecord.identityKey)
      .modify({ lastAccessedAt: 1_000 });
    const sourceBefore = await transcriptSource(evidence.sourceRecord.identityKey);
    storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
      [`${context.bvid}:${context.cid}:1`]: 'replacement-source-key',
    };
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 9_000 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const response = await searchWithExactSource(
      tabId,
      context,
      evidence.sourceRecord.sourceIdentityKey,
      'fresh selection replacement',
    );
    const selectedParams = {
      primaryTextSelectionsReady: true,
      selectedSourceIdentityKey: evidence.sourceRecord.sourceIdentityKey,
    };
    const summary = await sendRequest<CurrentVideoSummaryResult>({
      action: 'GET_CURRENT_VIDEO_SUMMARY',
      params: selectedParams,
    }, tabId, context.url);
    const knowledge = await sendRequest<VideoKnowledgeResult>({
      action: 'GET_VIDEO_KNOWLEDGE',
      params: selectedParams,
    }, tabId, context.url);
    const jump = await sendRequest<CurrentVideoTimestampJumpResponse>({
      action: 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP',
      params: {
        ...selectedParams,
        candidateId: 'fresh-selection-replaced-candidate',
        query: 'fresh selection replacement',
        confirmed: true,
      },
    }, tabId, context.url);

    assert.equal(response.data?.status, 'no_evidence');
    assert.equal(response.data?.candidates.length, 0);
    assert.equal(summary.data?.status, 'cancelled');
    assert.equal(summary.data?.sourceTier, null);
    assert.equal(knowledge.data?.nodes.length, 0);
    assert.equal(knowledge.data?.sourceState.transcriptEvidence, false);
    assert.equal(jump.data?.ok, false);
    assert.equal(jump.data?.targetSeconds, null);
    assert.ok(storageReadCount(CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY) >= 4);
    const sourceAfter = await transcriptSource(evidence.sourceRecord.identityKey);
    assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
  });

  await t.test('selection storage read rejection fails closed', async () => {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_610;
    const context = handlerVideoContext('BV1FreshSelectionB', 4902);
    const evidence = await seedHandlerTranscript(
      context,
      'fresh-selection-b',
      'rejected selection storage must not expose this body',
    );
    await db.currentVideoTranscriptSources
      .where('identityKey')
      .equals(evidence.sourceRecord.identityKey)
      .modify({ lastAccessedAt: 1_000 });
    const sourceBefore = await transcriptSource(evidence.sourceRecord.identityKey);
    rejectPrimaryTextSelectionStorageReads = true;
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 9_100 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const response = await searchWithExactSource(
      tabId,
      context,
      evidence.sourceRecord.sourceIdentityKey,
      'rejected selection storage',
    );

    assert.equal(response.data?.status, 'no_evidence');
    assert.equal(response.data?.candidates.length, 0);
    assert.ok(storageReadCount(CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY) >= 1);
    const sourceAfter = await transcriptSource(evidence.sourceRecord.identityKey);
    assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
  });

  await t.test('no saved choice keeps the unique current exact source available', async () => {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_611;
    const context = handlerVideoContext('BV1FreshSelectionC', 4903);
    const evidence = await seedHandlerTranscript(
      context,
      'fresh-selection-c',
      'unique current exact source remains available without a saved choice',
    );
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 9_200 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const response = await searchWithExactSource(
      tabId,
      context,
      evidence.sourceRecord.sourceIdentityKey,
      'unique current exact source',
    );

    assert.equal(response.data?.status, 'ready');
    assert.ok((response.data?.candidates.length ?? 0) > 0);
    assert.ok(storageReadCount(CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY) >= 1);
  });

  await t.test('an old exact key is blocked when the current source is different', async () => {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_612;
    const context = handlerVideoContext('BV1FreshSelectionD', 4904);
    const evidence = await seedHandlerTranscript(
      context,
      'fresh-selection-d',
      'only the current exact source is eligible without a saved choice',
    );
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 9_300 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const response = await searchWithExactSource(
      tabId,
      context,
      `${evidence.sourceRecord.sourceIdentityKey}-old`,
      'only the current exact source',
    );

    assert.equal(response.data?.status, 'no_evidence');
    assert.equal(response.data?.candidates.length, 0);
    assert.ok(storageReadCount(CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY) >= 1);
  });

  await t.test('a saved exact key remains authorized among multiple active persistent sources', async () => {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_613;
    const context = handlerVideoContext('BV1FreshSelectionE', 4905);
    const chinese = await seedHandlerTranscript(
      context,
      'fresh-selection-e-zh',
      '中文旧来源不能在当前来源不明确时继续授权',
      'zh-CN',
    );
    const english = await seedHandlerTranscript(
      context,
      'fresh-selection-e-en',
      'an alternate language source is also active in persistent metadata',
      'en-US',
    );
    storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
      [`${context.bvid}:${context.cid}:1`]: chinese.sourceRecord.sourceIdentityKey,
    };
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 9_400 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const response = await searchWithExactSource(
      tabId,
      context,
      chinese.sourceRecord.sourceIdentityKey,
      '中文旧来源',
    );

    assert.equal(response.data?.status, 'ready');
    assert.ok((response.data?.candidates.length ?? 0) > 0);
    assert.ok(storageReadCount(CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY) >= 1);

    await db.currentVideoTranscriptSources
      .where('identityKey')
      .equals(english.sourceRecord.identityKey)
      .modify({ lastAccessedAt: 2_000 });
    const mismatch = await searchWithExactSource(
      tabId,
      context,
      english.sourceRecord.sourceIdentityKey,
      'alternate language source',
    );
    assert.equal(mismatch.data?.status, 'no_evidence');
    assert.equal(mismatch.data?.candidates.length, 0);
    assert.equal((await transcriptSource(english.sourceRecord.identityKey))?.lastAccessedAt, 2_000);
  });

  await t.test('multiple active persistent sources without a saved choice stay blocked without LRU touches', async () => {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_614;
    const context = handlerVideoContext('BV1FreshSelectionF', 4906);
    const chinese = await seedHandlerTranscript(
      context,
      'fresh-selection-f-zh',
      '无保存选择时多来源必须保持阻断',
      'zh-CN',
    );
    const english = await seedHandlerTranscript(
      context,
      'fresh-selection-f-en',
      'multiple active sources need an explicit saved choice',
      'en-US',
    );
    await db.currentVideoTranscriptSources
      .where('identityKey')
      .equals(chinese.sourceRecord.identityKey)
      .modify({ lastAccessedAt: 1_000 });
    await db.currentVideoTranscriptSources
      .where('identityKey')
      .equals(english.sourceRecord.identityKey)
      .modify({ lastAccessedAt: 2_000 });
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 9_500 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const response = await searchWithExactSource(
      tabId,
      context,
      chinese.sourceRecord.sourceIdentityKey,
      '无保存选择时多来源',
    );

    assert.equal(response.data?.status, 'no_evidence');
    assert.equal(response.data?.candidates.length, 0);
    assert.equal((await transcriptSource(chinese.sourceRecord.identityKey))?.lastAccessedAt, 1_000);
    assert.equal((await transcriptSource(english.sourceRecord.identityKey))?.lastAccessedAt, 2_000);
  });

  await t.test('a saved stale exact source stays blocked without an LRU touch', async () => {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_615;
    const context = handlerVideoContext('BV1FreshSelectionG', 4907);
    const stale = await seedHandlerTranscript(
      context,
      'fresh-selection-g-stale',
      'stale exact source must remain unavailable',
    );
    await db.currentVideoTranscriptSources
      .where('identityKey')
      .equals(stale.sourceRecord.identityKey)
      .modify({ stale: true, lastAccessedAt: 1_000 });
    storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
      [`${context.bvid}:${context.cid}:1`]: stale.sourceRecord.sourceIdentityKey,
    };
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 9_600 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const response = await searchWithExactSource(
      tabId,
      context,
      stale.sourceRecord.sourceIdentityKey,
      'stale exact source',
    );

    assert.equal(response.data?.status, 'no_evidence');
    assert.equal(response.data?.candidates.length, 0);
    assert.equal((await transcriptSource(stale.sourceRecord.identityKey))?.lastAccessedAt, 1_000);
  });
});

test('protected handlers drop in-flight work when the exact source changes before evidence binding', async () => {
  const actions = ['summary', 'knowledge', 'search', 'jump'] as const;
  for (const [index, action] of actions.entries()) {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = 18_620 + index;
    const context = handlerVideoContext(`BV1GuardEvidence${index}`, 5001 + index);
    const evidence = await seedHandlerTranscript(
      context,
      `guard-evidence-${index}`,
      `guard evidence ${action} body must not be consumed after source replacement`,
    );
    await db.currentVideoTranscriptSources
      .where('identityKey')
      .equals(evidence.sourceRecord.identityKey)
      .modify({ lastAccessedAt: 1_000 });
    const sourceBefore = await transcriptSource(evidence.sourceRecord.identityKey);
    storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
      [handlerPartKey(context)]: evidence.sourceRecord.sourceIdentityKey,
    };
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 10_000 + index }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);

    const seekMessages: unknown[] = [];
    setTabMessageHandler(tabId, (message) => {
      seekMessages.push(message);
      return {
        ok: true,
        message: 'mock seek should not run',
        candidateId: 'guard-candidate',
        targetSeconds: 2,
        targetTimeLabel: '0:02',
        returnPointSeconds: 1,
        sourceLabel: 'mock',
        confidence: 0.8,
      };
    });
    installGuardTestHook('before_evidence_bind', async () => {
      await sendRequest<SaveCurrentVideoPrimaryTextSelectionResult>({
        action: 'SAVE_CURRENT_VIDEO_PRIMARY_TEXT_SELECTION',
        params: {
          bvid: context.bvid,
          cid: context.cid,
          page: context.currentPart.page,
          selectedSourceIdentityKey: `${evidence.sourceRecord.sourceIdentityKey}:replacement`,
        },
      }, tabId, context.url);
    });

    const response = await invokeProtectedHandlerAction(action, tabId, context, evidence.sourceRecord.sourceIdentityKey);

    assertProtectedActionBlocked(action, response);
    assert.equal(seekMessages.length, 0);
    const sourceAfter = await transcriptSource(evidence.sourceRecord.identityKey);
    assert.equal(sourceAfter?.lastAccessedAt, sourceBefore?.lastAccessedAt);
  }
});

test('protected search fails closed when source changes during active-source and segment stages', async () => {
  for (const phase of ['before_active_source_check', 'before_segment_body_read'] as const) {
    resetChromeHarness();
    await resetTranscriptDb();
    const tabId = phase === 'before_active_source_check' ? 18_630 : 18_631;
    const context = handlerVideoContext(`BV1GuardPhase${tabId}`, 5100 + tabId);
    const evidence = await seedHandlerTranscript(
      context,
      `guard-phase-${phase}`,
      `guard phase ${phase} body must not produce a candidate`,
    );
    storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
      [handlerPartKey(context)]: evidence.sourceRecord.sourceIdentityKey,
    };
    setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 11_000 }]);
    await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);
    installGuardTestHook(phase, async () => {
      await sendRequest<SaveCurrentVideoPrimaryTextSelectionResult>({
        action: 'SAVE_CURRENT_VIDEO_PRIMARY_TEXT_SELECTION',
        params: {
          bvid: context.bvid,
          cid: context.cid,
          page: context.currentPart.page,
          selectedSourceIdentityKey: `${evidence.sourceRecord.sourceIdentityKey}:replacement`,
        },
      }, tabId, context.url);
    });

    const search = await searchWithExactSource(
      tabId,
      context,
      evidence.sourceRecord.sourceIdentityKey,
      `guard phase ${phase}`,
    );

    assert.equal(search.success, true);
    assert.equal(search.data?.status, 'no_evidence');
    assert.equal(search.data?.candidates.length, 0);
    assert.equal(search.data?.evidenceState.transcriptSegmentCount, 0);
    assert.equal(search.data?.aiRerank.status, 'not_requested');
    assert.equal(search.data?.qa.aiState.status, 'not_requested');
  }
});

test('protected handlers block after transcript cache is cleared between binding and segment read', async () => {
  resetChromeHarness();
  await resetTranscriptDb();
  const tabId = 18_632;
  const context = handlerVideoContext('BV1GuardClear', 5201);
  const evidence = await seedHandlerTranscript(
    context,
    'guard-clear',
    'guard clear body must not fall back to description summary',
  );
  storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
    [handlerPartKey(context)]: evidence.sourceRecord.sourceIdentityKey,
  };
  setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 12_000 }]);
  await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);
  installGuardTestHook('before_segment_body_read', async () => {
    await sendRequest({
      action: 'CLEAR_CURRENT_VIDEO_SUBTITLE_CACHE',
      params: {},
    }, tabId, context.url);
  });

  const summary = await sendRequest<CurrentVideoSummaryResult>({
    action: 'GET_CURRENT_VIDEO_SUMMARY',
    params: {
      primaryTextSelectionsReady: true,
      selectedSourceIdentityKey: evidence.sourceRecord.sourceIdentityKey,
    },
  }, tabId, context.url);

  assert.equal(summary.success, true);
  assert.equal(summary.data?.status, 'cancelled');
  assert.equal(summary.data?.sourceTier, null);
  assert.equal(summary.data?.evidence.some(item => item.source === 'transcript'), false);
  assert.equal(await db.currentVideoTranscriptSegments.count(), 0);
});

test('return request with stale exact source does not send a content seek message', async () => {
  resetChromeHarness();
  await resetTranscriptDb();
  const tabId = 18_633;
  const context = handlerVideoContext('BV1GuardReturn', 5301);
  const evidence = await seedHandlerTranscript(
    context,
    'guard-return',
    'guard return source binding',
  );
  storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
    [handlerPartKey(context)]: evidence.sourceRecord.sourceIdentityKey,
  };
  setTabs([{ id: tabId, url: context.url, active: true, lastAccessed: 13_000 }]);
  await sendContentMessage({ action: 'CURRENT_VIDEO_CONTEXT_UPDATE', payload: context }, tabId, context.url);
  storageValues[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY] = {
    [handlerPartKey(context)]: `${evidence.sourceRecord.sourceIdentityKey}:new`,
  };
  const contentMessages: unknown[] = [];
  setTabMessageHandler(tabId, (message) => {
    contentMessages.push(message);
    return {
      ok: true,
      message: 'mock return should not run',
      candidateId: null,
      returnPointSeconds: 1,
      targetSeconds: 2,
    };
  });

  const response = await sendRequest<CurrentVideoTimestampReturnResponse>({
    action: 'RETURN_CURRENT_VIDEO_SEGMENT_JUMP',
    params: {
      primaryTextSelectionsReady: true,
      selectedSourceIdentityKey: evidence.sourceRecord.sourceIdentityKey,
    },
  }, tabId, context.url);

  assert.equal(response.success, true);
  assert.equal(response.data?.ok, false);
  assert.equal(contentMessages.length, 0);
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

async function seedHandlerTranscript(
  context: CurrentVideoContext,
  trackId: string,
  content: string,
  language = 'zh-CN',
) {
  const evidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 2, to: 7, content }] },
    {
      bvid: context.bvid,
      cid: context.cid as number,
      page: context.currentPart.page,
      language,
      sourceType: 'bilibili_player_wbi_v2',
      trackId,
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 12_000,
    },
  );
  await upsertCurrentVideoTranscriptEvidence(evidence);
  return evidence;
}

async function searchWithExactSource(
  tabId: number,
  context: CurrentVideoContext,
  sourceIdentityKey: string | undefined,
  query: string,
): Promise<BiliVizResponse<CurrentVideoSegmentRetrievalResult>> {
  assert.ok(sourceIdentityKey);
  return await sendRequest<CurrentVideoSegmentRetrievalResult>({
    action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
    params: {
      query,
      primaryTextSelectionsReady: true,
      selectedSourceIdentityKey: sourceIdentityKey,
    },
  }, tabId, context.url);
}

type ProtectedHandlerAction = 'summary' | 'knowledge' | 'search' | 'jump';
type GuardTestPhase =
  | 'before_active_source_check'
  | 'before_evidence_bind'
  | 'before_segment_body_read'
  | 'after_segment_body_read'
  | 'before_timestamp_message';

async function invokeProtectedHandlerAction(
  action: ProtectedHandlerAction,
  tabId: number,
  context: CurrentVideoContext,
  sourceIdentityKey: string | undefined,
): Promise<BiliVizResponse<unknown>> {
  assert.ok(sourceIdentityKey);
  const params = {
    primaryTextSelectionsReady: true,
    selectedSourceIdentityKey: sourceIdentityKey,
  };
  if (action === 'summary') {
    return await sendRequest<CurrentVideoSummaryResult>({
      action: 'GET_CURRENT_VIDEO_SUMMARY',
      params,
    }, tabId, context.url);
  }
  if (action === 'knowledge') {
    return await sendRequest<VideoKnowledgeResult>({
      action: 'GET_VIDEO_KNOWLEDGE',
      params,
    }, tabId, context.url);
  }
  if (action === 'search') {
    return await sendRequest<CurrentVideoSegmentRetrievalResult>({
      action: 'SEARCH_CURRENT_VIDEO_SEGMENTS',
      params: {
        ...params,
        query: 'guard evidence body',
      },
    }, tabId, context.url);
  }
  return await sendRequest<CurrentVideoTimestampJumpResponse>({
    action: 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP',
    params: {
      ...params,
      candidateId: 'guard-candidate',
      query: 'guard evidence body',
      confirmed: true,
    },
  }, tabId, context.url);
}

function assertProtectedActionBlocked(
  action: ProtectedHandlerAction,
  response: BiliVizResponse<unknown>,
): void {
  assert.equal(response.success, true);
  if (action === 'summary') {
    const data = response.data as CurrentVideoSummaryResult;
    assert.equal(data.status, 'cancelled');
    assert.equal(data.sourceTier, null);
    assert.equal(data.evidence.some(item => item.source === 'transcript'), false);
    return;
  }
  if (action === 'knowledge') {
    const data = response.data as VideoKnowledgeResult;
    assert.equal(data.nodes.length, 0);
    assert.equal(data.sourceState.transcriptEvidence, false);
    return;
  }
  if (action === 'search') {
    const data = response.data as CurrentVideoSegmentRetrievalResult;
    assert.equal(data.status, 'no_evidence');
    assert.equal(data.candidates.length, 0);
    assert.equal(data.evidenceState.transcriptSegmentCount, 0);
    assert.equal(data.aiRerank.status, 'not_requested');
    assert.equal(data.qa.aiState.status, 'not_requested');
    return;
  }
  const data = response.data as CurrentVideoTimestampJumpResponse;
  assert.equal(data.ok, false);
  assert.equal(data.targetSeconds, null);
}

function handlerPartKey(context: CurrentVideoContext): string {
  assert.ok(context.cid);
  return `${context.bvid}:${context.cid}:${context.currentPart.page}`;
}

function installGuardTestHook(
  expectedPhase: GuardTestPhase,
  callback: () => Promise<void>,
): void {
  let used = false;
  (globalThis as typeof globalThis & {
    __biliBillCurrentVideoPrimaryTextGuardTestHook__?: (phase: GuardTestPhase) => Promise<void>;
  }).__biliBillCurrentVideoPrimaryTextGuardTestHook__ = async (phase) => {
    if (used || phase !== expectedPhase) return;
    used = true;
    await callback();
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
          if (rejectPrimaryTextSelectionStorageReads && readsStorageKey(
            keys,
            CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
          )) {
            return Promise.reject(new Error('PRIMARY_TEXT_SELECTION_STORAGE_READ_FAILED'));
          }
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
  delete (globalThis as typeof globalThis & {
    __biliBillCurrentVideoPrimaryTextGuardTestHook__?: unknown;
  }).__biliBillCurrentVideoPrimaryTextGuardTestHook__;
  for (const key of Object.keys(storageValues)) {
    delete storageValues[key];
  }
  storageGetCounts.clear();
  rejectPrimaryTextSelectionStorageReads = false;
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

function readsStorageKey(
  keys: string | string[] | Record<string, unknown> | null | undefined,
  expectedKey: string,
): boolean {
  if (typeof keys === 'string') return keys === expectedKey;
  if (Array.isArray(keys)) return keys.includes(expectedKey);
  if (keys && typeof keys === 'object') return expectedKey in keys;
  return true;
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
