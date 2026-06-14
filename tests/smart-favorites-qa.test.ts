import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiConfig, UserConfig } from '../src/shared/types/config.ts';
import type { FavoriteFolder, FavoriteFolderSyncDiagnostic, FavoriteItem, SmartFavoriteIndex } from '../src/shared/types/favorite.ts';
import {
  assertAssistantPayloadAudit,
  auditAssistantPayload,
  smartFavoriteQaPayloadContract,
} from '../src/shared/assistant-payload-audit.ts';
import { buildSmartFavoriteQaResponse } from '../src/background/favorites/qa-core.ts';
import {
  buildSmartFavoriteQaAiPayload,
  synthesizeSmartFavoriteQaAnswerFromLocal,
} from '../src/shared/smart-favorites-qa-synthesis.ts';

test('returns cited videos with source fields and evidence for local matches', () => {
  const item = makeFavoriteItem(1, {
    title: 'Kursk tank battle documentary',
    folderTitle: 'History',
    authorName: 'Archive UP',
    tagName: 'History',
  });
  const index = makeIndex(item, {
    path: ['Knowledge', 'History', 'WWII', 'Kursk'],
    keywords: ['Kursk', 'Eastern Front'],
    summary: 'A local metadata summary about the Battle of Kursk.',
  });

  const response = buildSmartFavoriteQaResponse({
    query: 'Kursk WWII',
    items: [item],
    indexes: new Map([[item.itemKey, index]]),
    folders: [makeFolder()],
  });

  assert.equal(response.answerType, 'retrieval_answer');
  assert.equal(response.citedVideos.length, 1);
  assert.equal(response.citedVideos[0].bvid, item.bvid);
  assert.equal(response.citedVideos[0].link, `https://www.bilibili.com/video/${item.bvid}`);
  assert.ok(response.citedVideos[0].sourceFields.includes('title'));
  assert.ok(response.citedVideos[0].sourceFields.includes('smart.keywords'));
  assert.match(response.citedVideos[0].evidence, /本地词项命中/);
});

test('returns no_result without inventing citations', () => {
  const item = makeFavoriteItem(1, { title: 'Linear algebra notes' });

  const response = buildSmartFavoriteQaResponse({
    query: 'sourdough starter',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder()],
  });

  assert.equal(response.answerType, 'no_result');
  assert.equal(response.status.kind, 'no_result');
  assert.equal(response.citedVideos.length, 0);
  assert.match(response.evidenceSummary, /没有本地元数据/);
});

test('returns low-confidence candidates when evidence is weak', () => {
  const item = makeFavoriteItem(1, { tagName: 'Physics' });

  const response = buildSmartFavoriteQaResponse({
    query: 'physics',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder()],
  });

  assert.equal(response.answerType, 'candidate_list');
  assert.equal(response.confidence, 'low');
  assert.equal(response.citedVideos[0].confidence, 'low');
  assert.equal(response.citedVideos[0].sourceFields[0], 'tagName');
});

test('marks answers when the Smart Favorites index is stale', () => {
  const item = makeFavoriteItem(1, {
    title: 'Time management system',
    syncedAt: 2_000,
  });
  const index = makeIndex(item, {
    indexedAt: 1_000,
    keywords: ['time management'],
    path: ['Productivity'],
  });

  const response = buildSmartFavoriteQaResponse({
    query: 'time management',
    items: [item],
    indexes: new Map([[item.itemKey, index]]),
    folders: [makeFolder()],
  });

  assert.equal(response.status.kind, 'stale_index');
  assert.equal(response.status.indexCoverage.bilibiliReportedItems, 1);
  assert.equal(response.status.indexCoverage.storedItems, 1);
  assert.equal(response.status.indexCoverage.staleItems, 1);
  assert.match(response.status.notes.join(' '), /可能过期或不完整/);
});

test('scopes answers to currently synced data when sync diagnostics are incomplete', () => {
  const item = makeFavoriteItem(1, { title: 'Creator workflow automation' });
  const folder = makeFolder({ mediaCount: 20, lastSyncDiagnostic: makeIncompleteDiagnostic() });

  const response = buildSmartFavoriteQaResponse({
    query: 'creator workflow',
    items: [item],
    indexes: new Map(),
    folders: [folder],
  });

  assert.equal(response.status.kind, 'incomplete_sync');
  assert.equal(response.status.syncCoverage.complete, false);
  assert.equal(response.status.syncCoverage.problemFolders, 1);
  assert.match(response.answer, /当前已同步收藏中/);
  assert.match(response.status.notes.join(' '), /索引覆盖：B站报告 20 条，本地保存 1 条，已索引 0 条，失败 0 条，待索引 1 条/);
});

test('reports index coverage counts for Bilibili reported, locally stored, indexed, failed, and pending items', () => {
  const indexed = makeFavoriteItem(1, { title: 'Indexed item' });
  const failed = makeFavoriteItem(2, { title: 'Failed item' });
  const pending = makeFavoriteItem(3, { title: 'Pending item' });
  const failedIndex = makeIndex(failed, { status: 'failed' });

  const response = buildSmartFavoriteQaResponse({
    query: 'item',
    items: [indexed, failed, pending],
    indexes: new Map([
      [indexed.itemKey, makeIndex(indexed, { keywords: ['item'] })],
      [failed.itemKey, failedIndex],
    ]),
    folders: [makeFolder({ mediaCount: 5 })],
  });

  assert.equal(response.status.indexCoverage.bilibiliReportedItems, 5);
  assert.equal(response.status.indexCoverage.storedItems, 3);
  assert.equal(response.status.indexCoverage.indexedItems, 1);
  assert.equal(response.status.indexCoverage.failedItems, 1);
  assert.equal(response.status.indexCoverage.pendingItems, 1);
  assert.match(response.status.notes.join(' '), /已索引 1 条，失败 1 条，待索引 1 条/);
});

test('generates optional AI synthesis from cited videos only', async () => {
  const item = makeFavoriteItem(1, {
    title: 'Kursk tank battle documentary',
    folderTitle: 'History',
  });
  const local = buildSmartFavoriteQaResponse({
    query: 'Kursk',
    items: [item],
    indexes: new Map([[item.itemKey, makeIndex(item, { keywords: ['Kursk'] })]]),
    folders: [makeFolder()],
  });
  let sawPayload = false;

  const response = await synthesizeSmartFavoriteQaAnswerFromLocal(local, {
    config: makeConfig({ smartFavoritesQaAiEnabled: true, apiKey: 'test-key' }),
    now: 2_000,
    chat: async (_config: AiConfig, messages) => {
      const payload = JSON.parse(messages[1].content);
      sawPayload = true;
      assert.equal(payload.intent, 'smart_favorites_qa_synthesis');
      assert.equal(payload.citedVideos.length, 1);
      assert.equal(payload.citedVideos[0].bvid, item.bvid);
      assert.equal('favoriteItems' in payload, false);
      return {
        answer: `The strongest local match is ${item.bvid}, based on the provided title and Smart Favorites evidence.`,
        citedVideoRefs: [item.bvid],
      };
    },
  });

  assert.equal(sawPayload, true);
  assert.equal(response.answer, local.answer);
  assert.equal(response.citedVideos.length, 1);
  assert.equal(response.synthesis?.status, 'generated');
  assert.match(response.synthesis?.answer ?? '', /strongest local match/);
  assert.deepEqual(response.synthesis?.citedVideoRefs, [item.bvid]);
});

test('marks AI disabled and not configured without blocking local cited results', async () => {
  const item = makeFavoriteItem(1, { title: 'Kursk tank battle documentary' });
  const local = buildSmartFavoriteQaResponse({
    query: 'Kursk',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder()],
  });

  const disabled = await synthesizeSmartFavoriteQaAnswerFromLocal(local, {
    config: makeConfig({ smartFavoritesQaAiEnabled: false, apiKey: 'test-key' }),
  });
  const notConfigured = await synthesizeSmartFavoriteQaAnswerFromLocal(local, {
    config: makeConfig({ smartFavoritesQaAiEnabled: true, apiKey: '' }),
  });

  assert.equal(disabled.synthesis?.status, 'disabled');
  assert.equal(notConfigured.synthesis?.status, 'not_configured');
  assert.equal(disabled.citedVideos[0].bvid, item.bvid);
  assert.equal(notConfigured.citedVideos[0].bvid, item.bvid);
});

test('marks AI failure without removing local cited results', async () => {
  const item = makeFavoriteItem(1, { title: 'Kursk tank battle documentary' });
  const local = buildSmartFavoriteQaResponse({
    query: 'Kursk',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder()],
  });

  const response = await synthesizeSmartFavoriteQaAnswerFromLocal(local, {
    config: makeConfig({ smartFavoritesQaAiEnabled: true, apiKey: 'test-key' }),
    chat: async () => {
      throw new Error('AI_TEST_FAILURE');
    },
  });

  assert.equal(response.synthesis?.status, 'failed');
  assert.match(response.synthesis?.reason ?? '', /AI_TEST_FAILURE/);
  assert.equal(response.citedVideos[0].bvid, item.bvid);
});

test('rejects AI synthesis that cites outside videos or titles', async () => {
  const item = makeFavoriteItem(1, { title: 'Kursk tank battle documentary' });
  const local = buildSmartFavoriteQaResponse({
    query: 'Kursk',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder()],
  });

  const outsideBvid = await synthesizeSmartFavoriteQaAnswerFromLocal(local, {
    config: makeConfig({ smartFavoritesQaAiEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      answer: 'The answer is probably BV9999999999, which was not provided.',
      citedVideoRefs: ['BV9999999999'],
    }),
  });
  const outsideTitle = await synthesizeSmartFavoriteQaAnswerFromLocal(local, {
    config: makeConfig({ smartFavoritesQaAiEnabled: true, apiKey: 'test-key' }),
    chat: async () => ({
      answer: 'The answer is 《External Documentary》.',
      citedVideoRefs: [item.bvid],
    }),
  });

  assert.equal(outsideBvid.synthesis?.status, 'rejected');
  assert.match(outsideBvid.synthesis?.reason ?? '', /AI_OUTSIDE_CITED_VIDEO_REF|AI_OUTSIDE_VIDEO_REFERENCE/);
  assert.equal(outsideTitle.synthesis?.status, 'rejected');
  assert.match(outsideTitle.synthesis?.reason ?? '', /AI_OUTSIDE_TITLE_REFERENCE/);
  assert.equal(outsideBvid.answer, local.answer);
  assert.equal(outsideTitle.citedVideos[0].bvid, item.bvid);
});

test('audits smart favorite QA AI payload allowlist and rejects sensitive fields', () => {
  const item = makeFavoriteItem(1, {
    title: 'Kursk tank battle documentary',
    authorName: 'Archive UP',
  });
  const local = buildSmartFavoriteQaResponse({
    query: 'Kursk',
    items: [item],
    indexes: new Map([[item.itemKey, makeIndex(item, { keywords: ['Kursk'] })]]),
    folders: [makeFolder()],
  });
  const payload = buildSmartFavoriteQaAiPayload(local);
  const rawPayload = JSON.stringify(payload);

  assert.equal(payload.citedVideos.length, 1);
  assert.equal('authorMid' in payload.citedVideos[0], false);
  assert.doesNotMatch(rawPayload, /favoriteItems|favoriteFolders|Cookie|Key\.txt|authorMid|userMid/i);
  assert.equal(auditAssistantPayload(payload, smartFavoriteQaPayloadContract).passed, true);
  assertAssistantPayloadAudit(payload, smartFavoriteQaPayloadContract);

  const badPayload = {
    ...payload,
    favoriteItems: [{ bvid: 'BVFullLeak' }],
    citedVideos: [
      {
        ...payload.citedVideos[0],
        authorMid: 123,
      },
    ],
    safetyRules: [
      ...payload.safetyRules,
      'Do not send Cookie: SESSDATA=abc or C:\\Users\\LittleNub\\Desktop\\Key.txt.',
    ],
  };
  const audit = auditAssistantPayload(badPayload, smartFavoriteQaPayloadContract);
  const report = audit.violations.map(violation => `${violation.path} ${violation.token ?? ''}`).join('\n');

  assert.equal(audit.passed, false);
  assert.match(report, /\$\.favoriteItems/);
  assert.match(report, /\$\.citedVideos\[0\]\.authorMid/);
  assert.match(report, /Cookie\/login token/);
  assert.match(report, /C:\\Users\\LittleNub\\Desktop\\Key\.txt/);
});

test('redacts incomplete sync diagnostic folder details from smart favorite QA AI payload', () => {
  const item = makeFavoriteItem(1, { title: 'Kursk tank battle documentary' });
  const diagnostic = makeIncompleteDiagnostic({
    mediaId: 987654,
    title: 'Private research folder',
    errors: ['network failed for folder sample'],
  });
  const local = buildSmartFavoriteQaResponse({
    query: 'Kursk',
    items: [item],
    indexes: new Map(),
    folders: [makeFolder({ mediaId: 987654, title: 'Private research folder', lastSyncDiagnostic: diagnostic })],
  });
  const payload = buildSmartFavoriteQaAiPayload(local);
  const rawPayload = JSON.stringify(payload);

  assert.match(local.status.syncCoverage.note ?? '', /收藏同步可能不完整/);
  assert.match(local.status.syncCoverage.note ?? '', /Private research folder/);
  assert.equal(payload.syncCoverage.complete, false);
  assert.equal(payload.syncCoverage.diagnosticsCount, 1);
  assert.equal(payload.syncCoverage.problemFolders, 1);
  assert.equal(payload.syncCoverage.coverageStatus, 'incomplete');
  assert.equal('note' in payload.syncCoverage, false);
  assert.equal('bilibiliReportedItems' in payload.indexCoverage, false);
  assert.equal('storedItems' in payload.indexCoverage, false);
  assert.doesNotMatch(rawPayload, /Private research folder/);
  assert.doesNotMatch(rawPayload, /987654/);
  assert.doesNotMatch(rawPayload, /收藏同步可能不完整/);
  assert.doesNotMatch(rawPayload, /network failed for folder sample/);
  assert.equal(auditAssistantPayload(payload, smartFavoriteQaPayloadContract).passed, true);
  assertAssistantPayloadAudit(payload, smartFavoriteQaPayloadContract);
});

function makeFolder(overrides: Partial<FavoriteFolder> = {}): FavoriteFolder {
  return {
    mediaId: 100,
    title: 'Default',
    cover: '',
    intro: '',
    mediaCount: 1,
    createdAt: 0,
    updatedAt: 0,
    syncedAt: 1_000,
    ...overrides,
  };
}

function makeFavoriteItem(id: number, overrides: Partial<FavoriteItem> = {}): FavoriteItem {
  return {
    itemKey: `100:BV${id}`,
    mediaId: 100,
    folderTitle: 'Default',
    avid: id,
    bvid: `BV${id}`,
    title: `Video ${id}`,
    intro: '',
    authorName: `UP ${id}`,
    authorMid: id,
    tagName: '',
    tags: [],
    cover: '',
    duration: 0,
    pubtime: 0,
    favTime: id,
    syncedAt: 1_000,
    ...overrides,
  };
}

function makeIndex(item: FavoriteItem, overrides: Partial<SmartFavoriteIndex> = {}): SmartFavoriteIndex {
  return {
    itemKey: item.itemKey,
    path: [],
    summary: '',
    keywords: [],
    aliases: [],
    searchableText: '',
    contentHash: 'hash',
    model: 'local-test',
    status: 'indexed',
    indexedAt: 1_000,
    ...overrides,
  };
}

function makeConfig(overrides: {
  smartFavoritesQaAiEnabled: boolean;
  apiKey: string;
}): UserConfig {
  return {
    dailyWatchGoal: 60,
    weeklyWatchGoal: 420,
    overDependencyThreshold: 0.3,
    syncIntervalMinutes: 5,
    retentionDays: 90,
    showSidebar: true,
    theme: 'dark',
    ai: {
      baseURL: 'https://api.test',
      apiKey: overrides.apiKey,
      chatModel: 'test-model',
    },
    assistant: {
      aiSummariesEnabled: false,
      smartFavoritesQaAiEnabled: overrides.smartFavoritesQaAiEnabled,
      currentVideoSegmentRerankAiEnabled: false,
    },
    dynamicBill: {
      aiExplanationsEnabled: false,
    },
  };
}

function makeIncompleteDiagnostic(overrides: Partial<FavoriteFolderSyncDiagnostic> = {}): FavoriteFolderSyncDiagnostic {
  return {
    mediaId: 100,
    title: 'Default',
    reportedMediaCount: 20,
    pageSize: 20,
    requestedPages: 1,
    pagesFetched: 1,
    rawResourcesSeen: 10,
    uniqueResourcesSeen: 10,
    duplicateResourceIds: 0,
    duplicateBvids: 0,
    storedVideoItems: 10,
    filteredUnavailableItems: 0,
    filteredMissingIdItems: 0,
    filteredNonVideoItems: 0,
    filteredItems: 0,
    pageErrors: 1,
    hasMoreAfterStop: true,
    stoppedByMaxPages: false,
    unexplainedDelta: 10,
    completenessState: 'incomplete',
    stopReason: 'request_error',
    pageDiagnostics: [],
    errors: [],
    ...overrides,
  };
}
