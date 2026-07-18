import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheCurrentVideoTranscriptEvidence } from '../src/background/current-video-transcript-cache.ts';
import {
  CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_BYTES,
  CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_SOURCE_IDENTITIES,
  buildTranscriptEvidenceStateFromCache,
  measureTranscriptPersistentBytes,
  normalizeBilibiliTranscriptEvidence,
  planTranscriptEvidenceUpsert,
  withTranscriptEvidenceState,
} from '../src/shared/current-video-transcript-cache.ts';
import {
  clearTemporaryCurrentVideoTranscriptCache,
  clearTemporaryCurrentVideoTranscriptCacheForTab,
  getTemporaryCurrentVideoTranscriptEvidenceState,
  getTemporaryCurrentVideoTranscriptSegments,
  putTemporaryCurrentVideoTranscriptEvidence,
  retainTemporaryCurrentVideoTranscriptOwner,
} from '../src/background/current-video-temporary-transcript-cache.ts';
import { clearLegacyCurrentVideoTranscriptCache } from '../src/background/storage/current-video-transcript-migration.ts';
import {
  assertAssistantPayloadAudit,
  auditAssistantPayload,
  currentVideoSummaryPayloadContract,
} from '../src/shared/assistant-payload-audit.ts';
import {
  buildCurrentVideoSummaryAiPayload,
  buildLocalCurrentVideoSummary,
} from '../src/shared/current-video-summary.ts';
import { searchCurrentVideoSegments } from '../src/shared/current-video-segment-retrieval.ts';
import { buildVideoKnowledgeResult } from '../src/shared/video-knowledge.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from '../src/shared/types/current-video-transcript.ts';

test('normalizes Bilibili subtitle rows into stable transcript segments', () => {
  const evidence = normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 1.25, content: '  hello transcript  ' },
        { from: 1.25, to: 3, content: 'second line' },
        { from: 4, to: 3, content: 'bad time' },
        { from: 5, to: 6, content: '   ' },
      ],
    },
    baseNormalizeOptions(),
  );

  assert.equal(evidence.sourceRecord.status, 'cached');
  assert.equal(evidence.sourceRecord.segmentCount, 2);
  assert.equal(evidence.sourceRecord.coverageStartSeconds, 0);
  assert.equal(evidence.sourceRecord.coverageEndSeconds, 3);
  assert.deepEqual(evidence.sourceRecord.warnings, ['transcript_segments_filtered']);
  assert.equal(evidence.segments.length, 2);
  assert.equal(evidence.segments[0].text, 'hello transcript');
  assert.equal(evidence.segments[0].bvid, 'BV1Transcript00');
  assert.equal(evidence.segments[0].cid, 101);
  assert.equal(evidence.segments[0].page, 1);
  assert.equal(evidence.segments[0].language, 'zh-CN');
  assert.equal(evidence.segments[0].source, 'bilibili_subtitle');
  assert.equal(evidence.segments[0].sourceHash, evidence.sourceRecord.sourceHash);
  assert.equal(evidence.segments[0].sourceIdentityKey, evidence.sourceRecord.sourceIdentityKey);
  assert.ok(evidence.sourceRecord.sourceIdentityKey?.startsWith('primary-text:bilibili_subtitle:BV1Transcript00:101:1:zh-cn:'));
  assert.ok(evidence.sourceRecord.bodyHash);
  assert.ok(evidence.sourceRecord.timelineHash);
  assert.notEqual(evidence.sourceRecord.bodyHash, evidence.sourceRecord.timelineHash);
  assert.match(evidence.sourceRecord.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.sourceRecord.bodyHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.sourceRecord.timelineHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.sourceRecord.sourceIdentityKey ?? '', /:[a-f0-9]{64}$/);
  assert.match(evidence.segments[0].segmentId, /^transcript:BV1Transcript00:101:1:zh-cn:/);
});

test('upserts and reads transcript evidence without destructive unrelated changes', () => {
  const store = memoryStore();
  const evidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'cached line' }] },
    baseNormalizeOptions(),
  );
  const state = store.upsert(evidence);

  assert.equal(state.status, 'cached');
  assert.equal(state.active, true);
  assert.equal(state.segmentCount, 1);
  assert.equal(store.sources.length, 1);
  assert.equal(store.segments.length, 1);

  const read = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 101, page: 1 },
    store.sources,
    store.segments,
    2000,
  );
  assert.equal(read.status, 'cached');
  assert.equal(read.active, true);
  assert.equal(read.segmentCount, 1);
});

test('keeps text and timeline changes as separate source identities', () => {
  const store = memoryStore();
  const first = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'first version' }] },
    baseNormalizeOptions({ fetchedAt: 1000 }),
  );
  const second = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'second version' }] },
    baseNormalizeOptions({ fetchedAt: 2000 }),
  );
  const retimed = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0.5, to: 2.5, content: 'second version' }] },
    baseNormalizeOptions({ fetchedAt: 3000 }),
  );

  store.upsert(first);
  store.upsert(second);
  const state = store.upsert(retimed);

  assert.equal(state.status, 'cached');
  assert.equal(state.segmentCount, 1);
  assert.equal(state.staleSegmentCount, 0);
  assert.equal(store.sources.length, 3);
  assert.equal(store.segments.filter(segment => segment.stale).length, 0);
  assert.equal(store.segments.filter(segment => !segment.stale).length, 3);
  assert.notEqual(first.sourceRecord.sourceHash, second.sourceRecord.sourceHash);
  assert.equal(second.sourceRecord.bodyHash, retimed.sourceRecord.bodyHash);
  assert.notEqual(second.sourceRecord.timelineHash, retimed.sourceRecord.timelineHash);
  assert.notEqual(second.sourceRecord.sourceIdentityKey, retimed.sourceRecord.sourceIdentityKey);
  assert.equal(state.sourceIdentityKey, retimed.sourceRecord.sourceIdentityKey);
});

test('does not silently switch when the requested source identity is missing', () => {
  const first = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'first version' }] },
    baseNormalizeOptions({ fetchedAt: 1000 }),
  );
  const second = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'second version' }] },
    baseNormalizeOptions({ fetchedAt: 2000 }),
  );

  const state = buildTranscriptEvidenceStateFromCache(
    {
      bvid: 'BV1Transcript00',
      cid: 101,
      page: 1,
      language: 'zh-CN',
      sourceIdentityKey: first.sourceRecord.sourceIdentityKey,
      sourceHash: first.sourceRecord.sourceHash,
    },
    [second.sourceRecord],
    second.segments,
    3000,
  );

  assert.equal(state.status, 'stale');
  assert.equal(state.active, false);
  assert.equal(state.sourceIdentityKey, first.sourceRecord.sourceIdentityKey);
  assert.ok(state.warnings.includes('transcript_identity_mismatch'));
});

test('keeps same BVID but different CID/page from becoming active evidence', () => {
  const store = memoryStore();
  store.upsert(normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'page one' }] },
    baseNormalizeOptions({ cid: 101, page: 1 }),
  ));

  const wrongPart = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 202, page: 2 },
    store.sources,
    store.segments,
    3000,
  );
  assert.equal(wrongPart.status, 'stale');
  assert.equal(wrongPart.active, false);

  store.upsert(normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'page two' }] },
    baseNormalizeOptions({ cid: 202, page: 2 }),
  ));
  const pageOne = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 101, page: 1 },
    store.sources,
    store.segments,
    4000,
  );
  const pageTwo = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 202, page: 2 },
    store.sources,
    store.segments,
    4000,
  );
  assert.equal(pageOne.status, 'cached');
  assert.equal(pageTwo.status, 'cached');
  assert.equal(pageOne.segmentCount, 1);
  assert.equal(pageTwo.segmentCount, 1);
});

test('evicts subtitle source identities by LRU when count limit is exceeded', () => {
  const store = memoryStore();
  for (let index = 0; index < CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_SOURCE_IDENTITIES; index += 1) {
    store.upsert(normalizeBilibiliTranscriptEvidence(
      { body: [{ from: index, to: index + 1, content: `line ${index}` }] },
      baseNormalizeOptions({ bvid: `BV1Lru${String(index).padStart(2, '0')}`, cid: 1000 + index, fetchedAt: 1000 + index }),
    ));
  }
  const oldestKey = store.sources[0].sourceIdentityKey;

  store.upsert(normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 80, to: 81, content: 'new lru line' }] },
    baseNormalizeOptions({ bvid: 'BV1LruNew', cid: 3000, fetchedAt: 3000 }),
  ));

  assert.equal(store.sources.length, CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_SOURCE_IDENTITIES);
  assert.equal(store.segments.length, CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_SOURCE_IDENTITIES);
  assert.equal(store.sources.some(source => source.sourceIdentityKey === oldestKey), false);
  assert.equal(store.sources.some(source => source.bvid === 'BV1LruNew'), true);
});

test('evicts by serialized byte limit without evicting protected identities', () => {
  const protectedEvidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'protected current view' }] },
    baseNormalizeOptions({ bvid: 'BV1Protected', cid: 4001, fetchedAt: 1000 }),
  );
  const oldEvidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'old large cache '.repeat(200) }] },
    baseNormalizeOptions({ bvid: 'BV1OldLarge', cid: 4002, fetchedAt: 1100 }),
  );
  const nextEvidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'new write' }] },
    baseNormalizeOptions({ bvid: 'BV1NewLarge', cid: 4003, fetchedAt: 1200 }),
  );
  const sources = [
    { ...oldEvidence.sourceRecord, id: 1, lastAccessedAt: 1 },
    { ...protectedEvidence.sourceRecord, id: 2, lastAccessedAt: 2 },
  ];
  const segments = [
    { ...oldEvidence.segments[0], id: 11 },
    { ...protectedEvidence.segments[0], id: 12 },
  ];
  const maxBytes = measureTranscriptPersistentBytes(sources[1], [segments[1]])
    + measureTranscriptPersistentBytes(nextEvidence.sourceRecord, nextEvidence.segments);

  const plan = planTranscriptEvidenceUpsert(sources, segments, nextEvidence, {
    maxSourceIdentities: 50,
    maxBytes,
    protectedSourceIdentityKeys: [protectedEvidence.sourceRecord.sourceIdentityKey as string],
  });

  assert.deepEqual(plan.sourceIdsToDelete, [1]);
  assert.deepEqual(plan.segmentIdsToDelete, [11]);
  assert.equal(plan.sourceIdentityKeysToDelete.includes(protectedEvidence.sourceRecord.sourceIdentityKey as string), false);
  assert.equal(plan.skippedPersistentWrite, false);
  assert.ok(plan.finalRetainedBytes <= maxBytes);
  assert.ok(plan.finalRetainedSourceIdentityCount <= 50);
});

test('keeps existing cache intact when protected identities still exceed the budget with incoming', () => {
  const active = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'active source' }] },
    baseNormalizeOptions({ bvid: 'BV1Active', cid: 4101, fetchedAt: 1000 }),
  );
  const selected = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'selected source' }] },
    baseNormalizeOptions({ bvid: 'BV1Selected', cid: 4102, fetchedAt: 1100 }),
  );
  const evictable = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'old unprotected source' }] },
    baseNormalizeOptions({ bvid: 'BV1Evictable', cid: 4103, fetchedAt: 900 }),
  );
  const incoming = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'incoming source' }] },
    baseNormalizeOptions({ bvid: 'BV1Incoming', cid: 4104, fetchedAt: 1200 }),
  );
  const existingSources = [
    { ...active.sourceRecord, id: 1 },
    { ...selected.sourceRecord, id: 2 },
    { ...evictable.sourceRecord, id: 3 },
  ];
  const existingSegments = [
    { ...active.segments[0], id: 11 },
    { ...selected.segments[0], id: 12 },
    { ...evictable.segments[0], id: 13 },
  ];

  const plan = planTranscriptEvidenceUpsert(existingSources, existingSegments, incoming, {
    maxSourceIdentities: 2,
    maxBytes: Number.MAX_SAFE_INTEGER,
    protectedSourceIdentityKeys: [
      active.sourceRecord.sourceIdentityKey as string,
      selected.sourceRecord.sourceIdentityKey as string,
    ],
  });

  assert.equal(plan.skippedPersistentWrite, true);
  assert.equal(plan.state.temporary, true);
  assert.deepEqual(plan.sourcesToPut, []);
  assert.deepEqual(plan.segmentsToPut, []);
  assert.deepEqual(plan.sourceIdsToDelete, []);
  assert.deepEqual(plan.segmentIdsToDelete, []);
  assert.deepEqual(plan.sourceIdentityKeysToDelete, []);
  assert.equal(plan.finalRetainedSourceIdentityCount, existingSources.length);
  assert.ok(plan.finalRetainedBytes > 0);
});

test('keeps oversize subtitle source temporary without evicting existing cache', () => {
  const existing = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'existing cache' }] },
    baseNormalizeOptions({ bvid: 'BV1Existing', cid: 5001, fetchedAt: 1000 }),
  );
  const oversize = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 1, content: 'oversize cache' }] },
    baseNormalizeOptions({ bvid: 'BV1Oversize', cid: 5002, fetchedAt: 2000 }),
  );
  const oversizeBytes = measureTranscriptPersistentBytes(oversize.sourceRecord, oversize.segments);
  const plan = planTranscriptEvidenceUpsert(
    [existing.sourceRecord],
    existing.segments,
    oversize,
    { maxBytes: oversizeBytes - 1 },
  );

  assert.equal(plan.skippedPersistentWrite, true);
  assert.equal(plan.sourcesToPut.length, 0);
  assert.equal(plan.segmentsToPut.length, 0);
  assert.equal(plan.sourceIdsToDelete.length, 0);
  assert.equal(plan.segmentIdsToDelete.length, 0);
  assert.equal(plan.state.active, true);
  assert.equal(plan.state.temporary, true);
  assert.equal(plan.state.persistent, false);
  assert.ok(plan.state.warnings.includes('transcript_source_temporary_oversize'));
});

test('uses persisted source and segment records for byte limit boundary planning', () => {
  const evidence = normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 1, content: '边界字幕正文🙂'.repeat(20) },
        { from: 1, to: 2, content: '第二段用于验证真实落库记录大小'.repeat(15) },
      ],
    },
    baseNormalizeOptions({ bvid: 'BV1ByteLimit', cid: 6101, fetchedAt: 9000 }),
  );
  const measured = measureTranscriptPersistentBytes(evidence.sourceRecord, evidence.segments);

  assert.equal(evidence.sourceRecord.serializedBytes, measured);
  assert.ok(measured > 0);

  const maxMinusOne = planTranscriptEvidenceUpsert([], [], evidence, {
    maxBytes: measured - 1,
  });
  assert.equal(maxMinusOne.skippedPersistentWrite, true);
  assert.equal(maxMinusOne.sourcesToPut.length, 0);
  assert.equal(maxMinusOne.segmentsToPut.length, 0);

  const exactMax = planTranscriptEvidenceUpsert([], [], evidence, {
    maxBytes: measured,
  });
  assert.equal(exactMax.skippedPersistentWrite, false);
  assert.equal(measureTranscriptPersistentBytes(exactMax.sourcesToPut[0], exactMax.segmentsToPut), measured);
  assert.ok(measureTranscriptPersistentBytes(exactMax.sourcesToPut[0], exactMax.segmentsToPut) <= measured);

  const maxPlusOne = planTranscriptEvidenceUpsert([], [], evidence, {
    maxBytes: measured + 1,
  });
  assert.equal(maxPlusOne.skippedPersistentWrite, false);
  assert.equal(maxPlusOne.state.active, true);
  assert.ok(CURRENT_VIDEO_TRANSCRIPT_CACHE_MAX_BYTES > measured);
});

test('keeps fake IndexedDB auto-id readback within MAX-1, MAX, and MAX+1 plans', async () => {
  const { db } = await import('../src/background/storage/db.ts');
  db.close();
  await db.delete();
  await db.open();

  try {
    const evidence = normalizeBilibiliTranscriptEvidence(
      {
        body: [
          { from: 0, to: 1, content: '自动主键边界🙂'.repeat(20) },
          { from: 1, to: 2, content: 'fake IndexedDB readback'.repeat(15) },
        ],
      },
      baseNormalizeOptions({ bvid: 'BV1FakeIdbLimit', cid: 6151, fetchedAt: 9050 }),
    );
    const max = measureTranscriptPersistentBytes(evidence.sourceRecord, evidence.segments);
    const maxMinusOne = planTranscriptEvidenceUpsert([], [], evidence, { maxBytes: max - 1 });
    const exactMax = planTranscriptEvidenceUpsert([], [], evidence, { maxBytes: max });
    const maxPlusOne = planTranscriptEvidenceUpsert([], [], evidence, { maxBytes: max + 1 });

    assert.equal(maxMinusOne.skippedPersistentWrite, true);
    assert.equal(exactMax.skippedPersistentWrite, false);
    assert.equal(maxPlusOne.skippedPersistentWrite, false);

    await db.transaction(
      'rw',
      db.currentVideoTranscriptSources,
      db.currentVideoTranscriptSegments,
      async () => {
        await db.currentVideoTranscriptSources.bulkPut(exactMax.sourcesToPut);
        await db.currentVideoTranscriptSegments.bulkPut(exactMax.segmentsToPut);
      },
    );
    const [storedSources, storedSegments] = await Promise.all([
      db.currentVideoTranscriptSources.toArray(),
      db.currentVideoTranscriptSegments.toArray(),
    ]);
    const actualBytes = storedSources.reduce((sum, row) => sum + utf8JsonBytes(row), 0)
      + storedSegments.reduce((sum, row) => sum + utf8JsonBytes(row), 0);

    assert.equal(storedSources.length, 1);
    assert.equal(storedSegments.length, 2);
    assert.equal(typeof storedSources[0].id, 'number');
    assert.ok(storedSegments.every(segment => typeof segment.id === 'number'));
    assert.ok(actualBytes <= max);
    assert.ok(actualBytes <= exactMax.finalRetainedBytes);
    assert.equal(exactMax.finalRetainedSourceIdentityCount, 1);
  } finally {
    db.close();
    await db.delete();
  }
});

test('keeps oversize subtitle body readable only in temporary source memory', () => {
  clearTemporaryCurrentVideoTranscriptCache();
  const oversize = normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 3, content: '这段只允许本次临时使用，不能落库。' },
        { from: 3, to: 6, content: '切换来源或清理后必须读不到。' },
      ],
    },
    baseNormalizeOptions({ bvid: 'BV1Temporary', cid: 6201, fetchedAt: 9100 }),
  );
  const measured = measureTranscriptPersistentBytes(oversize.sourceRecord, oversize.segments);
  const plan = planTranscriptEvidenceUpsert([], [], oversize, {
    maxBytes: measured - 1,
  });
  assert.equal(plan.skippedPersistentWrite, true);

  const owner = temporaryOwner(71, oversize);
  putTemporaryCurrentVideoTranscriptEvidence(owner, oversize, 9200);
  const identity = {
    bvid: 'BV1Temporary',
    cid: 6201,
    page: 1,
    language: 'zh-CN',
    sourceIdentityKey: oversize.sourceRecord.sourceIdentityKey,
    sourceHash: oversize.sourceRecord.sourceHash,
  };
  const state = getTemporaryCurrentVideoTranscriptEvidenceState(owner, identity, 9300);
  const segments = getTemporaryCurrentVideoTranscriptSegments(owner, identity, 9300);

  assert.equal(state.active, true);
  assert.equal(state.temporary, true);
  assert.equal(state.persistent, false);
  assert.equal(segments.length, 2);
  assert.match(segments.map(segment => segment.text).join('\n'), /本次临时使用/);

  const switched = getTemporaryCurrentVideoTranscriptEvidenceState(owner, {
    ...identity,
    sourceIdentityKey: 'primary-text:bilibili_subtitle:BV1Temporary:6201:1:zh-cn:other',
  }, 9400);
  assert.equal(switched.active, false);

  clearTemporaryCurrentVideoTranscriptCache();
  const cleared = getTemporaryCurrentVideoTranscriptSegments(owner, identity, 9500);
  assert.equal(cleared.length, 0);
});

test('isolates temporary transcript bodies by tab and releases only the navigating tab', () => {
  clearTemporaryCurrentVideoTranscriptCache();
  const evidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: '两个标签页不能互相读取这段正文。' }] },
    baseNormalizeOptions({ bvid: 'BV1TwoTabs', cid: 6251, fetchedAt: 9600 }),
  );
  const identity = {
    bvid: evidence.sourceRecord.bvid,
    cid: evidence.sourceRecord.cid,
    page: evidence.sourceRecord.page,
    language: evidence.sourceRecord.language,
    sourceIdentityKey: evidence.sourceRecord.sourceIdentityKey,
    sourceHash: evidence.sourceRecord.sourceHash,
  };
  const tabOne = temporaryOwner(81, evidence);
  const tabTwo = temporaryOwner(82, evidence);

  putTemporaryCurrentVideoTranscriptEvidence(tabOne, evidence, 9700);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabOne, identity, 9710).length, 1);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabTwo, identity, 9710).length, 0);

  putTemporaryCurrentVideoTranscriptEvidence(tabTwo, evidence, 9720);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabOne, identity, 9730).length, 1);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabTwo, identity, 9730).length, 1);

  const replacement = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: '同页新正文替换旧的临时来源。' }] },
    baseNormalizeOptions({ bvid: 'BV1TwoTabs', cid: 6251, fetchedAt: 9735 }),
  );
  const replacementIdentity = {
    ...identity,
    sourceIdentityKey: replacement.sourceRecord.sourceIdentityKey,
    sourceHash: replacement.sourceRecord.sourceHash,
  };
  putTemporaryCurrentVideoTranscriptEvidence(tabOne, replacement, 9735);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabOne, identity, 9736).length, 0);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabOne, replacementIdentity, 9736).length, 1);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabTwo, identity, 9736).length, 1);

  retainTemporaryCurrentVideoTranscriptOwner({
    ownerTabId: tabOne.ownerTabId,
    bvid: 'BV1NextPage',
    cid: 6252,
    page: 2,
  });
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabOne, identity, 9740).length, 0);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabTwo, identity, 9740).length, 1);

  clearTemporaryCurrentVideoTranscriptCacheForTab(tabTwo.ownerTabId);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(tabTwo, identity, 9750).length, 0);

  putTemporaryCurrentVideoTranscriptEvidence(tabOne, evidence, 9760);
  clearTemporaryCurrentVideoTranscriptCache();
  const workerMemoryMissing = getTemporaryCurrentVideoTranscriptEvidenceState(tabOne, identity, 9770);
  assert.equal(workerMemoryMissing.active, false);
  assert.equal(workerMemoryMissing.status, 'missing');
});

test('Dexie 0.12 subtitle cache upgrade clears only transcript tables transactionally', async () => {
  const tables = {
    currentVideoTranscriptSources: [{ identityKey: 'legacy-source' }],
    currentVideoTranscriptSegments: [{ segmentId: 'legacy-segment' }],
    watchHistory: [{ id: 1 }],
    favoriteItems: [{ id: 2 }],
  };
  const cleared: string[] = [];
  await clearLegacyCurrentVideoTranscriptCache({
    table(name) {
      return {
        clear: async () => {
          cleared.push(name);
          tables[name] = [];
        },
      };
    },
  });

  assert.deepEqual(cleared, ['currentVideoTranscriptSegments', 'currentVideoTranscriptSources']);
  assert.deepEqual(tables.currentVideoTranscriptSources, []);
  assert.deepEqual(tables.currentVideoTranscriptSegments, []);
  assert.deepEqual(tables.watchHistory, [{ id: 1 }]);
  assert.deepEqual(tables.favoriteItems, [{ id: 2 }]);
});

test('records empty and malformed transcript states without active segments', () => {
  const empty = normalizeBilibiliTranscriptEvidence(
    { body: [] },
    baseNormalizeOptions(),
  );
  const malformed = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 'bad', to: 3, content: 'no start' }] },
    baseNormalizeOptions({ fetchedAt: 2000 }),
  );

  assert.equal(empty.sourceRecord.status, 'empty');
  assert.equal(empty.segments.length, 0);
  assert.equal(malformed.sourceRecord.status, 'malformed');
  assert.equal(malformed.segments.length, 0);

  const store = memoryStore();
  const emptyState = store.upsert(empty);
  assert.equal(emptyState.status, 'empty');
  assert.equal(emptyState.active, false);
});

test('background cache fetch keeps raw subtitle URL internal and reports language/track diagnostics', async () => {
  const store = memoryStore();
  let fetchedUrl = '';
  let protectedKeys: string[] = [];
  let temporaryOwnerSeen: unknown = null;
  const protectedIdentityKey = 'primary-text:bilibili_subtitle:BV1Protected:202:1:zh-cn:protected';
  const temporaryOwnerScope = {
    ownerTabId: 91,
    bvid: 'BV1Transcript00',
    cid: 101,
    page: 1,
  };
  const fetchTargets: Array<{ bvid: string; aid?: number | null; cid: number; page: number | null }> = [];
  const context = {
    ...videoContext(),
    transcriptEvidence: transcriptEvidenceState(protectedIdentityKey),
  };
  const state = await cacheCurrentVideoTranscriptEvidence(context, {
    now: 5000,
    temporaryOwner: temporaryOwnerScope,
    fetchPlayerInfo: async (target) => {
      fetchTargets.push(target);
      return {
        subtitle: {
          subtitles: [
            {
              id: 7,
              lan: 'zh-CN',
              lan_doc: 'Chinese',
              subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/private-track.json?token=secret',
            },
          ],
        },
      };
    },
    fetchSubtitleJson: async (url) => {
      fetchedUrl = url;
      return { body: [{ from: 0, to: 2, content: 'background fetched text' }] };
    },
    upsertEvidence: async (evidence, options) => {
      protectedKeys = Array.from(options?.protectedSourceIdentityKeys ?? []);
      temporaryOwnerSeen = options?.temporaryOwner ?? null;
      return store.upsert(evidence);
    },
  });

  assert.equal(state.status, 'cached');
  assert.equal(state.language, 'zh-CN');
  assert.equal(state.segmentCount, 1);
  assert.deepEqual(fetchTargets[0], { bvid: 'BV1Transcript00', aid: 8800, cid: 101, page: 1 });
  assert.deepEqual(protectedKeys, [protectedIdentityKey]);
  assert.deepEqual(temporaryOwnerSeen, temporaryOwnerScope);
  assert.match(fetchedUrl, /^https:\/\/aisubtitle\.hdslb\.com\//);
  assert.doesNotMatch(JSON.stringify(state), /private-track|subtitle_url|token=secret|SESSDATA|Key\.txt/i);
});

test('background cache blocks unsupported subtitle hosts before fetching body', async () => {
  let fetched = false;
  const state = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 5100,
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            id: 7,
            lan: 'zh-CN',
            subtitle_url: 'https://evil.example.invalid/private-track.json?token=secret',
          },
        ],
      },
    }),
    fetchSubtitleJson: async () => {
      fetched = true;
      return { body: [{ from: 0, to: 2, content: 'should not fetch' }] };
    },
  });

  assert.equal(state.status, 'track_unavailable');
  assert.equal(state.reason, 'subtitle_host_unsupported');
  assert.equal(fetched, false);
  assert.doesNotMatch(JSON.stringify(state), /evil\.example|private-track|token=secret|subtitle_url/i);
});

test('background cache distinguishes fetch failure from subtitle access failure', async () => {
  const endpointFailed = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 5200,
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            lan: 'zh-CN',
            subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/zh.json',
          },
        ],
      },
    }),
    fetchSubtitleJson: async () => {
      throw new Error('NETWORK_DOWN');
    },
  });
  assert.equal(endpointFailed.status, 'endpoint_failed');
  assert.equal(endpointFailed.active, false);
  assert.ok(endpointFailed.warnings.includes('transcript_endpoint_failed'));

  const accessFailure = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 5300,
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            lan: 'zh-CN',
            subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/private.json',
          },
        ],
      },
    }),
    fetchSubtitleJson: async () => {
      throw new Error('SUBTITLE_HTTP_403');
    },
  });
  assert.equal(accessFailure.status, 'login_required');
  assert.equal(accessFailure.active, false);
  assert.ok(accessFailure.warnings.includes('transcript_login_required'));
});

test('background cache reports language mismatch and unavailable track states', async () => {
  const mismatch = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 6000,
    requestedLanguage: 'en-US',
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            lan: 'zh-CN',
            subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/zh.json',
          },
        ],
      },
    }),
  });
  assert.equal(mismatch.status, 'language_mismatch');
  assert.equal(mismatch.active, false);

  const unavailable = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 7000,
    fetchPlayerInfo: async () => ({ subtitle: { subtitles: [{ lan: 'zh-CN' }] } }),
  });
  assert.equal(unavailable.status, 'track_unavailable');
  assert.equal(unavailable.active, false);
});

test('privacy audit keeps cached transcript text out of current video AI payload', () => {
  const store = memoryStore();
  const state = store.upsert(normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 2, content: 'SECRET TRANSCRIPT BODY SHOULD STAY LOCAL' },
      ],
    },
    baseNormalizeOptions(),
  ));
  const context = withTranscriptEvidenceState(videoContext(), state);
  context.sources.transcript = 'available';

  const payload = buildCurrentVideoSummaryAiPayload(context);
  const rawPayload = JSON.stringify(payload);
  const audit = auditAssistantPayload(payload, currentVideoSummaryPayloadContract);

  assert.equal(context.transcriptEvidence?.active, true);
  assert.equal(payload.availableSources.transcript, 'available');
  assert.equal(payload.availableSources.contentText, 'available');
  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assertAssistantPayloadAudit(payload, currentVideoSummaryPayloadContract);
  assert.doesNotMatch(
    rawPayload,
    /SECRET TRANSCRIPT BODY|segmentId|sourceHash|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i,
  );
});

test('cached subtitle body becomes active evidence for summary, video knowledge, and segment search', () => {
  const store = memoryStore();
  const state = store.upsert(normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 4, content: '模型架构从这里开始，介绍专家路由。' },
        { from: 4, to: 8, content: '这一段说明缓存后的字幕正文会作为本地证据。' },
      ],
    },
    baseNormalizeOptions(),
  ));
  const context = withTranscriptEvidenceState(videoContext(), state);
  context.sources.transcript = 'available';
  const summary = buildLocalCurrentVideoSummary(context, {
    transcriptSegments: store.segments,
    now: 8000,
  });
  const knowledge = buildVideoKnowledgeResult(context, {
    transcriptSegments: store.segments,
    now: 8000,
  });
  const search = searchCurrentVideoSegments(context, {
    query: '专家路由',
    transcriptSegments: store.segments,
    videoKnowledge: knowledge,
    now: 8000,
  });
  const raw = JSON.stringify({ summary, knowledge, search });

  assert.equal(context.transcriptEvidence?.active, true);
  assert.equal(summary.sourceTier, 'transcript_summary');
  assert.equal(knowledge.sourceState.transcriptEvidence, true);
  assert.ok(knowledge.nodes.some(node => node.source === 'transcript'));
  assert.equal(search.status, 'ready');
  assert.equal(search.candidates[0].binding.kind, 'transcript_segment');
  assert.doesNotMatch(raw, /subtitle_url|raw subtitle|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i);
});

function baseNormalizeOptions(overrides: Partial<Parameters<typeof normalizeBilibiliTranscriptEvidence>[1]> = {}) {
  return {
    bvid: 'BV1Transcript00',
    cid: 101,
    page: 1,
    language: 'zh-CN',
    sourceType: 'bilibili_player_wbi_v2' as const,
    trackId: '7',
    trackUrlHost: 'aisubtitle.hdslb.com',
    fetchedAt: 1000,
    ...overrides,
  };
}

function temporaryOwner(ownerTabId: number, evidence: CurrentVideoTranscriptEvidenceWrite) {
  return {
    ownerTabId,
    bvid: evidence.sourceRecord.bvid,
    cid: evidence.sourceRecord.cid,
    page: evidence.sourceRecord.page,
  };
}

function memoryStore() {
  const sources: CurrentVideoTranscriptSourceRecord[] = [];
  const segments: CurrentVideoTranscriptSegment[] = [];
  return {
    sources,
    segments,
    upsert(evidence: CurrentVideoTranscriptEvidenceWrite): CurrentVideoTranscriptEvidenceState {
      const plan = planTranscriptEvidenceUpsert(sources, segments, evidence);
      deleteSources(sources, segments, plan.sourceIdentityKeysToDelete);
      putSources(sources, plan.sourcesToPut);
      putSegments(segments, plan.segmentsToPut);
      return plan.state;
    },
  };
}

function transcriptEvidenceState(sourceIdentityKey: string): CurrentVideoTranscriptEvidenceState {
  return {
    status: 'cached',
    active: true,
    checkedAt: 1000,
    bvid: 'BV1Protected',
    cid: 202,
    page: 1,
    language: 'zh-CN',
    source: 'bilibili_subtitle',
    sourceType: 'bilibili_player_wbi_v2',
    sourceIdentityKey,
    sourceHash: 'protected',
    bodyHash: 'protected-body',
    timelineHash: 'protected-timeline',
    segmentCount: 1,
    staleSegmentCount: 0,
    serializedBytes: 100,
    coverageStartSeconds: 0,
    coverageEndSeconds: 1,
    fetchedAt: 1000,
    updatedAt: 1000,
    lastAccessedAt: 1000,
    persistent: true,
    temporary: false,
    reason: 'cached',
    message: 'cached',
    warnings: [],
  };
}

function deleteSources(
  sources: CurrentVideoTranscriptSourceRecord[],
  segments: CurrentVideoTranscriptSegment[],
  sourceIdentityKeys: string[],
): void {
  for (const sourceIdentityKey of sourceIdentityKeys) {
    for (let index = sources.length - 1; index >= 0; index -= 1) {
      if ((sources[index].sourceIdentityKey ?? sources[index].identityKey) === sourceIdentityKey) {
        sources.splice(index, 1);
      }
    }
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (segments[index].sourceIdentityKey === sourceIdentityKey) {
        segments.splice(index, 1);
      }
    }
  }
}

function putSources(
  target: CurrentVideoTranscriptSourceRecord[],
  values: CurrentVideoTranscriptSourceRecord[],
): void {
  for (const value of values) {
    const index = target.findIndex(item => item.identityKey === value.identityKey);
    if (index >= 0) {
      target[index] = value;
    } else {
      target.push(value);
    }
  }
}

function putSegments(
  target: CurrentVideoTranscriptSegment[],
  values: CurrentVideoTranscriptSegment[],
): void {
  for (const value of values) {
    const index = target.findIndex(item => item.segmentId === value.segmentId);
    if (index >= 0) {
      target[index] = value;
    } else {
      target.push(value);
    }
  }
}

function utf8JsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function videoContext(): CurrentVideoContext {
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Transcript00?p=1',
    collectedAt: 1000,
    bvid: 'BV1Transcript00',
    aid: 8800,
    cid: 101,
    title: 'Transcript cache video',
    authorName: 'Cache UP',
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: 'Main',
      total: 1,
    },
    parts: [{ page: 1, cid: 101, title: 'Main', durationSeconds: 600 }],
    chapters: [],
    description: {
      availability: 'available',
      text: 'Visible description remains the summary fallback.',
      length: 49,
    },
    sources: {
      metadata: 'available',
      description: 'available',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'unknown',
      contentText: 'unavailable',
    },
    subtitleProbe: null,
    transcriptEvidence: null,
    warnings: ['transcript_probe_pending'],
  };
}
