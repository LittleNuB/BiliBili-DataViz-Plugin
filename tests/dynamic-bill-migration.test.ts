import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
      for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // Try the next TypeScript source shape.
        }
      }
      throw error;
    }
  },
});

const { default: Dexie } = await import('dexie');
const { db } = await import('../src/background/storage/db.ts');
const migration = await import('../src/background/dynamic-bill/migration.ts');
const generator = await import('../src/background/dynamic-bill/generator.ts');
const dynamicBillAi = await import('../src/background/dynamic-bill/ai.ts');
const dynamicBillSync = await import('../src/background/dynamic-bill/sync.ts');
const dynamicBillRepo = await import('../src/background/storage/dynamic-bill-repo.ts');
const { buildDynamicBillExplanationContent } = await import('../src/background/dynamic-bill/explanation-content.ts');
const { getRegisteredLocalDataCategories } = await import('../src/background/storage/local-data-category-registry.ts');
const localDataRepo = await import('../src/background/storage/local-data-privacy-repo.ts');
const { runLocalDataCategoryLifecycle } = await import('../src/shared/local-data-category-contract.ts');
const { LOCAL_DATA_CLEAR_CONFIRMATION } = await import('../src/shared/local-data-privacy.ts');
const { DEFAULT_CONFIG } = await import('../src/shared/types/config.ts');
const {
  DYNAMIC_BILL_MIGRATION_VERSION,
  DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE,
} = await import('../src/background/dynamic-bill/strategy.ts');

const DB_NAME = 'BiliAnalyticsDB';
const DAY_MS = 86_400_000;
const storageData = new Map<string, unknown>();
const sideEffects = {
  fetch: 0,
  storageGet: 0,
  storageSet: 0,
  storageRemove: 0,
  storageClear: 0,
};
let afterStorageRemove: (() => Promise<void>) | null = null;
let fetchHandler: ((...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) | null = null;

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    storage: {
      local: {
        async get(keys?: string | string[] | Record<string, unknown> | null) {
          sideEffects.storageGet++;
          if (typeof keys === 'string') {
            return storageData.has(keys) ? { [keys]: storageData.get(keys) } : {};
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys.filter(key => storageData.has(key)).map(key => [key, storageData.get(key)]),
            );
          }
          if (keys && typeof keys === 'object') {
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [
                key,
                storageData.has(key) ? storageData.get(key) : fallback,
              ]),
            );
          }
          return Object.fromEntries(storageData);
        },
        async set(values: Record<string, unknown>) {
          sideEffects.storageSet++;
          for (const [key, value] of Object.entries(values)) storageData.set(key, value);
        },
        async remove(keys: string | string[]) {
          sideEffects.storageRemove++;
          for (const key of Array.isArray(keys) ? keys : [keys]) storageData.delete(key);
          await afterStorageRemove?.();
        },
        async clear() {
          sideEffects.storageClear++;
          storageData.clear();
        },
      },
    },
  },
});

Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: (...args: Parameters<typeof fetch>) => {
    sideEffects.fetch++;
    if (fetchHandler) return fetchHandler(...args);
    return Promise.reject(new Error('TEST_NETWORK_SHOULD_NOT_RUN'));
  },
});

test.beforeEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
  storageData.clear();
  afterStorageRemove = null;
  fetchHandler = null;
  resetSideEffects();
});

test.after(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

test('first 0.13 read migrates a real 0.12 database before returning any bill data', async () => {
  const now = Date.now();
  await seedLegacyDatabase({
    feedback: [
      legacyCreatorFeedback(7, now - 10 * DAY_MS, 'older'),
      legacyCreatorFeedback(7, now - 5 * DAY_MS, 'newer'),
      legacyCreatorFeedback(8, now - 31 * DAY_MS, 'expired'),
      legacyCreatorFeedback(9, 'invalid', 'invalid'),
      legacyTopicFeedback(now - DAY_MS),
    ],
  });

  const items = await dynamicBillRepo.getDynamicBillItems();
  const pauses = await db.dynamicBillCreatorPauses.toArray();

  assert.deepEqual(items, []);
  assert.equal(await db.dynamicBillItems.count(), 0);
  assert.equal(await db.dynamicBillExplanations.count(), 0);
  assert.equal(await db.dynamicBillFeedback.count(), 0);
  assert.equal(await db.dynamicBillMigrations.count(), 1);
  assert.equal((await db.dynamicBillMigrations.toArray())[0].version, DYNAMIC_BILL_MIGRATION_VERSION);
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].creatorMid, 7);
  assert.equal(pauses[0].startedAt, now - 5 * DAY_MS);
  assert.equal(pauses[0].expiresAt, now + 25 * DAY_MS);
  assert.equal(pauses[0].source, 'migration');
});

test('failed migration rolls back every table and a later retry completes cleanly', async () => {
  const now = Date.now();
  await seedLegacyDatabase({
    feedback: [legacyCreatorFeedback(7, now - DAY_MS, 'retry')],
  });
  const failMarkerWrite = () => {
    throw new Error('TEST_ABORT_MIGRATION');
  };
  db.dynamicBillMigrations.hook('creating', failMarkerWrite);

  try {
    await assert.rejects(
      dynamicBillRepo.getDynamicBillItems(),
      hasMessage(DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE),
    );
    assert.equal(await db.dynamicBillItems.count(), 1);
    assert.equal(await db.dynamicBillExplanations.count(), 1);
    assert.equal(await db.dynamicBillFeedback.count(), 1);
    assert.equal(await db.dynamicBillCreatorPauses.count(), 0);
    assert.equal(await db.dynamicBillMigrations.count(), 0);
  } finally {
    db.dynamicBillMigrations.hook('creating').unsubscribe(failMarkerWrite);
  }

  assert.deepEqual(await dynamicBillRepo.getDynamicBillItems(), []);
  assert.equal(await db.dynamicBillItems.count(), 0);
  assert.equal(await db.dynamicBillExplanations.count(), 0);
  assert.equal(await db.dynamicBillFeedback.count(), 0);
  assert.equal(await db.dynamicBillCreatorPauses.count(), 1);
  assert.equal(await db.dynamicBillMigrations.count(), 1);
});

test('concurrent and repeated gates create one pause and one marker', async () => {
  const now = Date.now();
  await seedLegacyDatabase({
    feedback: [
      legacyCreatorFeedback(7, now - 3 * DAY_MS, 'older'),
      legacyCreatorFeedback(7, now - DAY_MS, 'newer'),
    ],
  });

  await Promise.all([
    dynamicBillRepo.getDynamicBillItems(),
    dynamicBillRepo.getDynamicBillExplanationMap(['legacy-card']),
    dynamicBillRepo.getDynamicBillFeedbackProfile(),
    dynamicBillSync.getDynamicOverview(),
    migration.ensureDynamicBill013Migration(),
  ]);
  await Promise.all([
    migration.ensureDynamicBill013Migration(),
    dynamicBillRepo.getDynamicBillItems(),
    dynamicBillRepo.getDynamicBillFeedbackProfile(),
  ]);

  assert.equal(await db.dynamicBillCreatorPauses.count(), 1);
  assert.equal(await db.dynamicBillMigrations.count(), 1);
  assert.equal((await db.dynamicBillCreatorPauses.toArray())[0].startedAt, now - DAY_MS);
});

test('repository update ordering is stable across equal-time database insertion permutations', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const updates = [
    fixtureFollowedVideoUpdate(now, 1, 'z', nowSeconds, nowSeconds - 1),
    fixtureFollowedVideoUpdate(now, 1, 'b', nowSeconds, nowSeconds),
    fixtureFollowedVideoUpdate(now, 1, 'a', nowSeconds, nowSeconds),
  ];

  for (const insertionOrder of permutations(updates)) {
    await db.followedVideoUpdates.clear();
    await db.followedVideoUpdates.bulkAdd(insertionOrder);
    const ordered = await dynamicBillRepo.getRecentFollowedVideoUpdates();
    assert.deepEqual(
      ordered.map(update => update.updateKey),
      ['update-1-a', 'update-1-b', 'update-1-z'],
    );
  }
});

test('regeneration preserves state when the same update changes columns', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  const creatorMid = 606;
  await seedCurrentCandidate(now, creatorMid);
  const scenarios = ['opened', 'consumed', 'processed'] as const;

  for (const [index, status] of scenarios.entries()) {
    await db.dynamicBillItems.clear();
    await db.favoriteItems.clear();
    const initial = (await generator.generateDynamicBillItems()).items[0];
    assert.ok(initial);
    assert.equal(initial.column, 'follow_rotation');
    assert.equal(initial.billKey, `update:${initial.updateKey}`);

    const openedAt = now + index * 10 + 1;
    await dynamicBillRepo.markDynamicBillItemOpened(initial.billKey, openedAt);
    if (status === 'consumed') {
      await dynamicBillRepo.markDynamicBillItemsConsumedByBvid(
        initial.evidence.newVideo.bvid,
        openedAt + 1,
      );
    }
    if (status === 'processed') {
      await dynamicBillRepo.markDynamicBillItemProcessed(initial.billKey, openedAt + 2);
    }
    const before = (await dynamicBillRepo.getDynamicBillItems())[0];
    assert.equal(before.status, status);
    await dynamicBillAi.buildDynamicBillExplanations({ maxItems: 1 });
    assert.ok((await dynamicBillRepo.getDynamicBillItems())[0].explanation);

    await db.favoriteItems.put(fixtureFavoriteForCreator(now, creatorMid, status));
    const reclassified = (await generator.generateDynamicBillItems()).items[0];
    const reloaded = (await dynamicBillRepo.getDynamicBillItems())[0];

    assert.equal(reclassified.column, 'favorite_related');
    assert.equal(reclassified.billKey, initial.billKey);
    assert.equal(reloaded.explanation, undefined);
    assert.equal(
      await db.dynamicBillExplanations.where('billKey').equals(initial.billKey).count(),
      0,
    );
    assert.deepEqual(
      {
        status: reclassified.status,
        openedAt: reclassified.openedAt,
        consumedAt: reclassified.consumedAt,
        processedAt: reclassified.processedAt,
      },
      {
        status: before.status,
        openedAt: before.openedAt,
        consumedAt: before.consumedAt,
        processedAt: before.processedAt,
      },
      `${status} state changed after reclassification`,
    );
  }
});

test('regeneration preserves an explanation when its canonical input is unchanged', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 607);
  const initial = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(initial);
  await dynamicBillAi.buildDynamicBillExplanations({ maxItems: 1 });
  const before = (await dynamicBillRepo.getDynamicBillItems())[0];
  assert.ok(before.explanation);

  await dynamicBillRepo.replaceAllDynamicBillItems([
    { ...initial, generatedAt: initial.generatedAt + 1 },
  ], now + 1);

  const reloaded = (await dynamicBillRepo.getDynamicBillItems())[0];
  assert.deepEqual(reloaded.explanation, before.explanation);
  assert.equal(
    await db.dynamicBillExplanations.where('billKey').equals(initial.billKey).count(),
    1,
  );
});

test('item reads hide a hash-mismatched explanation before regeneration cleanup', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 608);
  const initial = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(initial);
  await dynamicBillAi.buildDynamicBillExplanations({ maxItems: 1 });
  assert.ok((await dynamicBillRepo.getDynamicBillItems())[0].explanation);

  await db.dynamicBillItems
    .where('billKey')
    .equals(initial.billKey)
    .modify({ column: 'favorite_related' });

  assert.equal((await dynamicBillRepo.getDynamicBillItems())[0].explanation, undefined);
  assert.equal(
    await db.dynamicBillExplanations.where('billKey').equals(initial.billKey).count(),
    1,
  );
});

test('late generated AI response cannot overwrite a newer explanation after reclassification', async () => {
  await assertLateAiResponseDiscarded('generated');
});

test('late failed AI response cannot overwrite a newer explanation after reclassification', async () => {
  await assertLateAiResponseDiscarded('failed');
});

for (const staleStatus of ['generated', 'failed', 'disabled', 'not_configured'] as const) {
  test(`same-hash stale ${staleStatus} explanation cannot overwrite a newer generated explanation`, async () => {
    await assertSameHashStaleExplanationDiscarded(staleStatus);
  });
}

test('no-generation explanation writes are discarded after a tracked attempt starts', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 626);
  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  const update = await db.followedVideoUpdates
    .where('updateKey')
    .equals(item.updateKey)
    .first();
  const { contentHash } = buildDynamicBillExplanationContent(item, update);
  const trackedAttempt = await dynamicBillRepo.beginDynamicBillExplanationAttempt(
    item.billKey,
    contentHash,
    'new-model',
  );
  assert.ok(trackedAttempt);

  const oldBefore = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 1, item.billKey),
    status: 'generated',
    summary: 'old no-generation before',
    reason: 'old reason before',
    viewingAngle: 'old angle before',
    model: 'old-model',
    contentHash,
  });
  const newWrite = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 2, item.billKey),
    status: 'generated',
    summary: 'tracked new result',
    reason: 'tracked new reason',
    viewingAngle: 'tracked new angle',
    model: 'new-model',
    contentHash,
    attemptGeneration: trackedAttempt.generation,
  });
  const oldAfter = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 3, item.billKey),
    status: 'generated',
    summary: 'old no-generation after',
    reason: 'old reason after',
    viewingAngle: 'old angle after',
    model: 'old-model',
    contentHash,
  });
  const stored = await db.dynamicBillExplanations
    .where('billKey')
    .equals(item.billKey)
    .first();
  const returned = (await dynamicBillRepo.getDynamicBillItems())[0].explanation;

  assert.equal(oldBefore.status, 'discarded');
  assert.equal(newWrite.status, 'written');
  assert.equal(oldAfter.status, 'discarded');
  assert.equal(stored?.summary, 'tracked new result');
  assert.equal(stored?.model, 'new-model');
  assert.equal(stored?.attemptGeneration, trackedAttempt.generation);
  assert.equal(returned?.summary, 'tracked new result');
});

test('no-generation bootstrap writes only once when no attempt metadata exists', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 627);
  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  const update = await db.followedVideoUpdates
    .where('updateKey')
    .equals(item.updateKey)
    .first();
  const { contentHash } = buildDynamicBillExplanationContent(item, update);

  const first = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 1, item.billKey),
    status: 'generated',
    summary: 'first bootstrap result',
    reason: 'first bootstrap reason',
    viewingAngle: 'first bootstrap angle',
    model: 'bootstrap-model',
    contentHash,
  });
  const second = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 2, item.billKey),
    status: 'generated',
    summary: 'second bootstrap result',
    reason: 'second bootstrap reason',
    viewingAngle: 'second bootstrap angle',
    model: 'bootstrap-model',
    contentHash,
  });
  const stored = await db.dynamicBillExplanations
    .where('billKey')
    .equals(item.billKey)
    .first();
  const reloadedItem = (await db.dynamicBillItems.where('billKey').equals(item.billKey).first());

  assert.equal(first.status, 'written');
  assert.equal(second.status, 'discarded');
  assert.equal(first.status === 'written' ? first.explanation.attemptGeneration : undefined, 1);
  assert.equal(stored?.summary, 'first bootstrap result');
  assert.equal(stored?.attemptGeneration, 1);
  assert.equal(reloadedItem?.explanationAttemptGeneration, 1);
});

test('unsafe but valid AI explanation JSON is rejected without storing visible raw tokens', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 628);
  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  enableFixtureAi();
  fetchHandler = () => Promise.resolve(aiResponse({
    summary: '这段解释包含 sourceHash=internal 和 BV1UnsafeToken',
    reason: '不要展示 transcript 或 segmentId',
    viewingAngle: 'confidence 不应出现在可见说明里',
    keywords: ['subtitle_url', 'local_fallback'],
    confidence: 0.9,
  }));

  const result = await dynamicBillAi.buildDynamicBillExplanations({ maxItems: 1 });
  const explanation = result.items[0]?.explanation;
  assert.ok(explanation);
  const visibleCopy = [
    explanation.summary,
    explanation.reason,
    explanation.viewingAngle,
    ...explanation.keywords,
    explanation.error ?? '',
  ].join('\n');

  assert.equal(result.generated, 0);
  assert.equal(result.failed, 1);
  assert.equal(explanation.status, 'failed');
  assert.doesNotMatch(
    visibleCopy,
    /fallback|transcript|confidence|sourceHash|segmentId|subtitle_url|BV1UnsafeToken/i,
  );
  assert.match(visibleCopy, /来自已关注 UP|这个视频出现|把它当作/);
});

test('safe AI explanation JSON is stored as generated output', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 629);
  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  enableFixtureAi();
  fetchHandler = () => Promise.resolve(aiResponse({
    summary: '这是一条围绕新投稿主题的简短说明',
    reason: '本地证据显示这个 UP 最近有新投稿，适合作为本轮关注回访。',
    viewingAngle: '先看标题和简介，再决定是否打开完整视频。',
    keywords: ['关注回访', '新投稿'],
    confidence: 0.82,
  }));

  const result = await dynamicBillAi.buildDynamicBillExplanations({ maxItems: 1 });
  const explanation = result.items[0]?.explanation;

  assert.equal(result.generated, 1);
  assert.equal(result.failed, 0);
  assert.equal(explanation?.status, 'generated');
  assert.equal(explanation?.summary, '这是一条围绕新投稿主题的简短说明');
  assert.deepEqual(explanation?.keywords, ['关注回访', '新投稿']);
  assert.equal(explanation?.confidence, 0.82);
});

test('regeneration deletes removed and orphaned explanations and privacy count follows readback', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 624);
  const initial = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(initial);
  const update = await db.followedVideoUpdates
    .where('updateKey')
    .equals(initial.updateKey)
    .first();
  const { contentHash } = buildDynamicBillExplanationContent(initial, update);
  await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now, initial.billKey),
    summary: '保留的解释',
    model: 'fixture-model',
    contentHash,
  });
  await db.dynamicBillExplanations.put({
    ...fixtureExplanation(now, 'orphaned-bill-key'),
    summary: '旧孤儿解释',
    model: 'fixture-model',
    contentHash: 'orphaned-hash',
  });

  assert.equal((await localDataRepo.getLocalDataPrivacySummary()).dynamicBill.explanationCount, 2);

  await dynamicBillRepo.replaceAllDynamicBillItems([initial], now + 1);
  const afterSameItems = await dynamicBillRepo.getDynamicBillItems();

  assert.equal(await db.dynamicBillExplanations.count(), 1);
  assert.equal((await localDataRepo.getLocalDataPrivacySummary()).dynamicBill.explanationCount, 1);
  assert.equal(afterSameItems[0]?.explanation?.summary, '保留的解释');
  assert.equal(
    await db.dynamicBillExplanations.where('billKey').equals('orphaned-bill-key').count(),
    0,
  );

  await dynamicBillRepo.replaceAllDynamicBillItems([], now + 2);

  assert.equal(await db.dynamicBillItems.count(), 0);
  assert.equal(await db.dynamicBillExplanations.count(), 0);
  assert.equal((await localDataRepo.getLocalDataPrivacySummary()).dynamicBill.explanationCount, 0);
});

test('fallback explanation copy uses natural untitled text without raw BVID', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  const creatorMid = 625;
  await seedCurrentCandidate(now, creatorMid);
  await db.followedVideoUpdates
    .where('updateKey')
    .equals(`update-${creatorMid}`)
    .modify({
      bvid: 'BV1RawFallback625',
      title: '',
    });
  storageData.set('userConfig', {
    ...DEFAULT_CONFIG,
    dynamicBill: {
      ...DEFAULT_CONFIG.dynamicBill,
      aiExplanationsEnabled: false,
    },
  });

  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  const result = await dynamicBillAi.buildDynamicBillExplanations({ maxItems: 1 });
  const explanation = result.items[0]?.explanation;
  assert.ok(explanation);
  const visibleCopy = [
    explanation.summary,
    explanation.reason,
    explanation.viewingAngle,
    ...explanation.keywords,
  ].join('\n');

  assert.match(explanation.summary, /《视频标题暂缺》/);
  assert.doesNotMatch(visibleCopy, /BV1RawFallback625|BVID/);
});

test('AI explanation payload excludes rotation ledger facts and creator identifiers', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  const creatorMid = 609;
  await seedCurrentCandidate(now, creatorMid);
  await db.dynamicBillRotationRecords.put({
    creatorMid,
    creatorName: `UP ${creatorMid}`,
    lastShownAt: now - 7 * DAY_MS,
    lastBillKey: 'old-rotation-item',
    lastColumn: 'follow_rotation',
    updatedAt: now - 7 * DAY_MS,
  });
  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  const rotationFact = item.evidence.facts.find(fact => fact.includes('全局轮换记录'));
  assert.ok(rotationFact);

  const payload = await dynamicBillAi.buildDynamicBillExplanationPayload(item);
  const raw = JSON.stringify(payload);
  const payloadFacts = payload.localEvidence.facts.join('\n');

  assert.equal(payload.column, '关注轮换');
  assert.equal(payload.localEvidence.facts.includes(rotationFact), false);
  assert.doesNotMatch(payloadFacts, /轮换.*(?:记录|上次|展示过|最久未展示)/);
  assert.match(payloadFacts, /AI 不参与入选、归属、轮换或状态/);
  assert.doesNotMatch(raw, /creatorMid|authorMid|rotationLastShownAt|lastShownAt|lastBillKey|lastColumn/);
});

test('generation excludes same-video BVIDs outside the long evidence window without requiring history', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  await seedCurrentCandidate(now, 612);
  await seedCurrentCandidate(now, 613);
  await db.watchHistory.put({
    sessionKey: `old-same-video:${nowSeconds}`,
    kid: nowSeconds,
    avid: 612,
    bvid: 'BV1fixture612',
    cid: 1,
    title: '旧观看记录',
    authorName: 'UP 612',
    authorMid: 612,
    tagName: '知识',
    tags: [],
    cover: '',
    viewAt: nowSeconds - 240 * 86_400,
    progress: 120,
    duration: 120,
    actualCompletion: 1,
    deviceType: 2,
    isFavorite: false,
    business: 'archive',
    dt: 0,
    syncedAt: now,
  });

  const result = await generator.generateDynamicBillItems();

  assert.equal(result.excludedRecentSameVideoCount, 1);
  assert.deepEqual(result.items.map(item => item.creatorMid), [613]);
  assert.equal(result.items[0].evidence.longWindow.watchedCount, 0);
});

test('legacy feedback injected after the marker cannot change candidates, pauses, or settings counts', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 101);

  const beforeItems = await generator.generateDynamicBillItems();
  const beforePauses = await dynamicBillRepo.getActiveDynamicBillCreatorPauses(now);
  const beforeSummary = (await localDataRepo.getLocalDataPrivacySummary()).dynamicBill;

  await db.dynamicBillFeedback.bulkAdd([
    legacyCreatorFeedback(101, now, 'post-marker-creator'),
    legacyTopicFeedback(now),
  ]);

  const afterPauses = await dynamicBillRepo.getActiveDynamicBillCreatorPauses(now);
  const afterSummary = (await localDataRepo.getLocalDataPrivacySummary()).dynamicBill;
  const afterItems = await generator.generateDynamicBillItems();

  assert.deepEqual(afterPauses, beforePauses);
  assert.deepEqual(afterSummary, beforeSummary);
  assert.deepEqual(
    afterItems.items.map(item => [item.creatorMid, item.column]),
    beforeItems.items.map(item => [item.creatorMid, item.column]),
  );
  assert.equal(await db.dynamicBillFeedback.count(), 2);
  assert.equal(await db.dynamicBillMigrations.count(), 1);
});

test('dynamic bill clear counts only 0.13 data and removes hidden legacy feedback', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 202);
  const generated = await generator.generateDynamicBillItems();
  const item = generated.items[0];
  await db.dynamicBillExplanations.put({
    billKey: item.billKey,
    status: 'disabled',
    summary: '本地说明',
    reason: '本地规则',
    viewingAngle: '按需查看',
    keywords: [],
    confidence: 0,
    model: '',
    generatedAt: now,
    contentHash: 'fixture',
  });
  await db.dynamicBillCreatorPauses.put({
    creatorMid: 303,
    creatorName: '迁移暂停 UP',
    startedAt: now - DAY_MS,
    expiresAt: now + DAY_MS,
    source: 'migration',
    createdAt: now,
    updatedAt: now,
  });
  await db.dynamicBillFeedback.add(legacyCreatorFeedback(202, now, 'ignored-after-marker'));
  await dynamicBillRepo.setDynamicSyncState({
    status: 'success',
    stage: 'complete',
    lastStartedAt: now - 1_000,
    lastFinishedAt: now,
    lastSuccessAt: now,
  });
  await dynamicBillRepo.setDynamicBillFilterPreference('processed');

  const result = await localDataRepo.clearDynamicBillLocalData();
  const summary = (await localDataRepo.getLocalDataPrivacySummary()).dynamicBill;
  const filter = await dynamicBillRepo.getDynamicBillFilterPreference();

  assert.deepEqual(result.cleared, {
    followedCreators: 1,
    followedVideoUpdates: 1,
    dynamicBillItems: 1,
    dynamicBillExplanations: 1,
    dynamicBillCreatorPauses: 1,
    dynamicBillRotationRecords: 1,
  });
  assert.deepEqual(summary, {
    activeFollowedCreatorCount: 0,
    followedVideoUpdateCount: 0,
    billItemCount: 0,
    rotationRecordCount: 0,
    creatorPauseCount: 0,
    unopenedItems: 0,
    openedItems: 0,
    consumedItems: 0,
    processedItems: 0,
    explanationCount: 0,
    lastGeneratedAt: null,
    lastSyncedAt: null,
    syncStatus: 'idle',
  });
  assert.deepEqual(filter, { status: 'active', updatedAt: 0 });
  assert.equal(await db.dynamicBillMigrations.count(), 1);
  assert.equal(await db.dynamicBillFeedback.count(), 0);
});

test('standalone dynamic bill clear fails closed when lifecycle readback finds surviving data', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 404);
  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  let inserted = false;
  afterStorageRemove = async () => {
    if (inserted) return;
    inserted = true;
    await db.dynamicBillItems.put({
      ...item,
      id: undefined,
      billKey: 'surviving-standalone-item',
      updateKey: 'surviving-standalone-update',
      evidence: {
        ...item.evidence,
        newVideo: {
          ...item.evidence.newVideo,
          updateKey: 'surviving-standalone-update',
          bvid: 'BV1standaloneSurvivor',
        },
      },
    });
  };

  await assert.rejects(
    localDataRepo.clearDynamicBillLocalData(),
    hasMessage('动态账单本地数据清理失败，请稍后重试。'),
  );
  assert.equal(await db.dynamicBillItems.count(), 1);
  assert.equal(await db.dynamicBillMigrations.count(), 1);
});

test('registered dynamic bill lifecycle uses real Dexie tables and fails closed on surviving data', async () => {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  await seedCurrentCandidate(now, 606);
  const generated = await generator.generateDynamicBillItems();
  const item = generated.items[0];
  assert.ok(item);
  await db.dynamicBillExplanations.put(fixtureExplanation(now, item.billKey));
  await db.dynamicBillCreatorPauses.put({
    creatorMid: 707,
    creatorName: '迁移暂停 UP',
    startedAt: now - DAY_MS,
    expiresAt: now + DAY_MS,
    source: 'migration',
    createdAt: now,
    updatedAt: now,
  });
  await db.dynamicBillFeedback.add(legacyCreatorFeedback(606, now, 'hidden-after-marker'));
  await dynamicBillRepo.setDynamicSyncState({
    status: 'success',
    stage: 'complete',
    lastStartedAt: now - 1_000,
    lastFinishedAt: now,
    lastSuccessAt: now,
  });
  await dynamicBillRepo.setDynamicBillFilterPreference('processed');

  const category = getRegisteredLocalDataCategories().find(entry => entry.id === 'dynamicBill');
  assert.ok(category);
  const usage = await category.collectUsage();
  assert.equal(usage.count, 6);
  assert.ok(usage.usageBytes > 0);

  const successfulLifecycle = await runLocalDataCategoryLifecycle(category);
  assert.equal(successfulLifecycle.status, 'success');
  if (successfulLifecycle.status === 'success') {
    assert.deepEqual(successfulLifecycle.clearResult.cleared, {
      followedCreators: 1,
      followedVideoUpdates: 1,
      dynamicBillItems: 1,
      dynamicBillExplanations: 1,
      dynamicBillCreatorPauses: 1,
      dynamicBillRotationRecords: 1,
    });
    assert.deepEqual(successfulLifecycle.after, {
      count: 0,
      usageBytes: 0,
      empty: true,
    });
  }
  assert.deepEqual(await Promise.all([
    db.followedCreators.count(),
    db.followedVideoUpdates.count(),
    db.dynamicBillItems.count(),
    db.dynamicBillExplanations.count(),
    db.dynamicBillCreatorPauses.count(),
    db.dynamicBillRotationRecords.count(),
    db.dynamicBillFeedback.count(),
  ]), [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(await db.dynamicBillMigrations.count(), 1);
  assert.equal(storageData.has('dynamicBillSyncState'), false);
  assert.equal(storageData.has('dynamicBillFilterPreference'), false);

  const survivor = {
    ...item,
    id: undefined,
    billKey: 'surviving-item',
    updateKey: 'surviving-update',
    evidence: {
      ...item.evidence,
      newVideo: {
        ...item.evidence.newVideo,
        updateKey: 'surviving-update',
        bvid: 'BV1surviving',
      },
    },
  };
  await db.dynamicBillItems.put(survivor);
  const failedLifecycle = await runLocalDataCategoryLifecycle({
    ...category,
    clear: async () => {
      const result = await category.clear();
      await db.dynamicBillItems.put(survivor);
      return result;
    },
  });

  assert.equal(failedLifecycle.status, 'failure');
  if (failedLifecycle.status === 'failure') {
    assert.equal(failedLifecycle.failedStage, 'readback');
    assert.equal(failedLifecycle.failureReason, 'data_remaining');
    assert.equal(failedLifecycle.before?.count, 1);
    assert.equal(failedLifecycle.after?.count, 1);
    assert.match(failedLifecycle.message, /回读后仍有本地数据/);
  }
  assert.equal(await db.dynamicBillItems.count(), 1);
  assert.equal(await db.dynamicBillMigrations.count(), 1);
});

test('clear all leaves every table and local setting untouched when migration fails', async () => {
  const now = Date.now();
  await seedLegacyDatabase({
    feedback: [legacyCreatorFeedback(7, now - DAY_MS, 'clear-all-failure')],
    seedUnrelatedRows: true,
  });
  storageData.set('preservedSetting', { enabled: true });
  const tablesBefore = await snapshotDatabaseTables();
  const storageBefore = [...storageData.entries()];
  const failMarkerWrite = () => {
    throw new Error('TEST_ABORT_MIGRATION');
  };
  db.dynamicBillMigrations.hook('creating', failMarkerWrite);

  try {
    await assert.rejects(
      localDataRepo.clearAllLocalData(LOCAL_DATA_CLEAR_CONFIRMATION),
      hasMessage(DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE),
    );
  } finally {
    db.dynamicBillMigrations.hook('creating').unsubscribe(failMarkerWrite);
  }

  assert.deepEqual(await snapshotDatabaseTables(), tablesBefore);
  assert.deepEqual([...storageData.entries()], storageBefore);
  assert.equal(sideEffects.storageGet, 0);
  assert.equal(sideEffects.storageSet, 0);
  assert.equal(sideEffects.storageRemove, 0);
  assert.equal(sideEffects.storageClear, 0);
});

test('every protected entry fails with one Chinese error before reads, writes, or network work', async () => {
  const now = Date.now();
  await seedLegacyDatabase({
    feedback: [legacyCreatorFeedback(7, now - DAY_MS, 'failure')],
    seedUnrelatedRows: true,
  });
  const failMarkerWrite = () => {
    throw new Error('TEST_ABORT_MIGRATION');
  };
  db.dynamicBillMigrations.hook('creating', failMarkerWrite);

  let unrelatedReads = 0;
  const countRead = <T>(value: T): T => {
    unrelatedReads++;
    return value;
  };
  const readTables = [
    db.watchHistory,
    db.favoriteItems,
    db.currentVideoTranscriptSources,
  ];
  for (const table of readTables) table.hook('reading', countRead);
  resetSideEffects();

  const entries: Array<[string, () => Promise<unknown>]> = [
    ['overview', () => dynamicBillSync.getDynamicOverview()],
    ['sync', () => dynamicBillSync.syncDynamicBillUpdates()],
    ['generate', () => generator.generateDynamicBillItems()],
    ['explanations', () => dynamicBillAi.buildDynamicBillExplanations()],
    ['items', () => dynamicBillRepo.getDynamicBillItems()],
    ['explanation read', () => dynamicBillRepo.getDynamicBillExplanationMap(['legacy-card'])],
    ['explanation write', () => dynamicBillRepo.putDynamicBillExplanation(fixtureExplanation(now))],
    ['feedback read', () => dynamicBillRepo.getDynamicBillFeedbackProfile()],
    ['feedback write', () => dynamicBillRepo.addDynamicBillFeedback('legacy-card', 'creator')],
    ['opened state', () => dynamicBillRepo.markDynamicBillItemOpened('legacy-card')],
    ['processed state', () => dynamicBillRepo.markDynamicBillItemProcessed('legacy-card')],
    ['consumed state', () => dynamicBillRepo.markDynamicBillItemsConsumedByBvid('BV1legacy')],
    ['filter read', () => dynamicBillRepo.getDynamicBillFilterPreference()],
    ['filter write', () => dynamicBillRepo.setDynamicBillFilterPreference('active')],
    ['sync state read', () => dynamicBillRepo.getDynamicSyncState()],
    ['sync state write', () => dynamicBillRepo.setDynamicSyncState(fixtureSyncState())],
    ['stored state clear', () => dynamicBillRepo.clearDynamicBillStoredState()],
    ['settings stats', () => localDataRepo.getLocalDataPrivacySummary()],
    ['dynamic clear', () => localDataRepo.clearDynamicBillLocalData()],
    ['clear all', () => localDataRepo.clearAllLocalData(LOCAL_DATA_CLEAR_CONFIRMATION)],
  ];
  const outcomes: string[] = [];

  try {
    for (const [name, run] of entries) {
      try {
        await run();
        outcomes.push(`${name}:resolved`);
      } catch (error) {
        outcomes.push(`${name}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    for (const table of readTables) table.hook('reading').unsubscribe(countRead);
    db.dynamicBillMigrations.hook('creating').unsubscribe(failMarkerWrite);
  }

  assert.deepEqual(
    outcomes,
    entries.map(([name]) => `${name}:${DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE}`),
  );
  assert.deepEqual(sideEffects, {
    fetch: 0,
    storageGet: 0,
    storageSet: 0,
    storageRemove: 0,
    storageClear: 0,
  });
  assert.equal(unrelatedReads, 0);
  assert.equal(await db.dynamicBillItems.count(), 1);
  assert.equal(await db.dynamicBillExplanations.count(), 1);
  assert.equal(await db.dynamicBillFeedback.count(), 1);
  assert.equal(await db.dynamicBillCreatorPauses.count(), 0);
  assert.equal(await db.dynamicBillMigrations.count(), 0);
});

function resetSideEffects(): void {
  sideEffects.fetch = 0;
  sideEffects.storageGet = 0;
  sideEffects.storageSet = 0;
  sideEffects.storageRemove = 0;
  sideEffects.storageClear = 0;
}

function hasMessage(message: string): (error: unknown) => boolean {
  return error => error instanceof Error && error.message === message;
}

async function assertLateAiResponseDiscarded(
  outcome: 'generated' | 'failed',
): Promise<void> {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  const creatorMid = outcome === 'generated' ? 610 : 611;
  await seedCurrentCandidate(now, creatorMid);
  const initial = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(initial);
  assert.equal(initial.column, 'follow_rotation');
  enableFixtureAi();
  const response = deferred<Response>();
  fetchHandler = () => response.promise;

  const oldRun = dynamicBillAi.buildDynamicBillExplanations({ maxItems: 1 });
  await waitFor(() => sideEffects.fetch === 1);

  await db.favoriteItems.put(fixtureFavoriteForCreator(now, creatorMid, outcome));
  const reclassified = (await generator.generateDynamicBillItems()).items[0];
  assert.equal(reclassified.column, 'favorite_related');
  const currentUpdate = await db.followedVideoUpdates
    .where('updateKey')
    .equals(reclassified.updateKey)
    .first();
  const { contentHash } = buildDynamicBillExplanationContent(reclassified, currentUpdate);
  const newerAttempt = await dynamicBillRepo.beginDynamicBillExplanationAttempt(
    reclassified.billKey,
    contentHash,
    'fixture-model',
  );
  assert.ok(newerAttempt);
  const newerWrite = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 1, reclassified.billKey),
    status: 'generated',
    summary: '新的收藏关联解释',
    reason: '新的本地证据解释',
    model: 'fixture-model',
    contentHash,
    attemptGeneration: newerAttempt.generation,
  });

  if (outcome === 'generated') {
    response.resolve(aiResponse({
      summary: '旧轮换解释',
      reason: '旧轮换证据',
      viewingAngle: '旧视角',
      keywords: ['旧轮换'],
      confidence: 0.8,
    }));
  } else {
    response.reject(new Error('OLD_AI_REQUEST_FAILED'));
  }

  const result = await oldRun;
  assert.equal(newerWrite.status, 'written');
  const stored = await db.dynamicBillExplanations
    .where('billKey')
    .equals(reclassified.billKey)
    .first();
  const returned = (await dynamicBillRepo.getDynamicBillItems())[0].explanation;

  assert.equal(result.processed, 1);
  assert.equal(result.generated, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.discarded, 1);
  assert.equal(stored?.summary, '新的收藏关联解释');
  assert.equal(stored?.contentHash, contentHash);
  assert.equal(stored?.attemptGeneration, newerAttempt.generation);
  assert.equal(returned?.summary, '新的收藏关联解释');
  assert.equal(returned?.contentHash, contentHash);
}

async function assertSameHashStaleExplanationDiscarded(
  staleStatus: 'generated' | 'failed' | 'disabled' | 'not_configured',
): Promise<void> {
  await seedLegacyDatabase();
  await migration.ensureDynamicBill013Migration();
  const now = Date.now();
  const creatorMid = 620 + ['generated', 'failed', 'disabled', 'not_configured'].indexOf(staleStatus);
  await seedCurrentCandidate(now, creatorMid);
  const item = (await generator.generateDynamicBillItems()).items[0];
  assert.ok(item);
  const update = await db.followedVideoUpdates
    .where('updateKey')
    .equals(item.updateKey)
    .first();
  const { contentHash } = buildDynamicBillExplanationContent(item, update);

  const staleAttempt = await dynamicBillRepo.beginDynamicBillExplanationAttempt(
    item.billKey,
    contentHash,
    'fixture-model',
  );
  const newerAttempt = await dynamicBillRepo.beginDynamicBillExplanationAttempt(
    item.billKey,
    contentHash,
    'fixture-model',
  );
  assert.ok(staleAttempt);
  assert.ok(newerAttempt);
  assert.ok(newerAttempt.generation > staleAttempt.generation);

  const newerWrite = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 2, item.billKey),
    status: 'generated',
    summary: `newer generated ${staleStatus}`,
    reason: 'newer reason',
    viewingAngle: 'newer angle',
    model: 'fixture-model',
    contentHash,
    attemptGeneration: newerAttempt.generation,
  });
  const staleWrite = await dynamicBillRepo.putDynamicBillExplanation({
    ...fixtureExplanation(now + 1, item.billKey),
    status: staleStatus,
    summary: `stale ${staleStatus}`,
    reason: 'stale reason',
    viewingAngle: 'stale angle',
    model: 'fixture-model',
    contentHash,
    attemptGeneration: staleAttempt.generation,
  });
  const stored = await db.dynamicBillExplanations
    .where('billKey')
    .equals(item.billKey)
    .first();
  const returned = (await dynamicBillRepo.getDynamicBillItems())[0].explanation;

  assert.equal(newerWrite.status, 'written');
  assert.equal(staleWrite.status, 'discarded');
  assert.equal(stored?.summary, `newer generated ${staleStatus}`);
  assert.equal(stored?.attemptGeneration, newerAttempt.generation);
  assert.equal(returned?.summary, `newer generated ${staleStatus}`);
}

function enableFixtureAi(): void {
  storageData.set('userConfig', {
    ...DEFAULT_CONFIG,
    ai: {
      baseURL: 'https://fixture.invalid/v1',
      apiKey: 'fixture-key',
      chatModel: 'fixture-model',
    },
    dynamicBill: {
      aiExplanationsEnabled: true,
    },
  });
}

function aiResponse(content: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('TEST_CONDITION_TIMEOUT');
}

async function snapshotDatabaseTables(): Promise<Record<string, unknown[]>> {
  return Object.fromEntries(await Promise.all(
    db.tables.map(async table => [table.name, await table.toArray()] as const),
  ));
}

async function seedLegacyDatabase(options: {
  feedback?: Array<Record<string, unknown>>;
  seedUnrelatedRows?: boolean;
} = {}): Promise<void> {
  const fixture = new Dexie(DB_NAME);
  fixture.version(8).stores({
    watchHistory: '++id, kid, &sessionKey, avid, bvid, [avid+cid+viewAt], authorMid, tagName, viewAt, dt',
    playerEvents: '++id, [bvid+cid], eventType, timestamp, tabId',
    dailyAggregates: '++id, &date',
    favoriteFolders: '++id, &mediaId, title, syncedAt',
    favoriteItems: '++id, &itemKey, mediaId, avid, bvid, authorMid, tagName, favTime, syncedAt',
    smartFavoriteIndex: '++id, &itemKey, status, indexedAt, contentHash',
    followedCreators: '++id, &mid, followedAt, followAgeKnown, isActive, syncedAt, lastSeenAt',
    followedVideoUpdates: '++id, &updateKey, dynamicId, bvid, authorMid, dynamicTime, pubtime, syncedAt',
    dynamicBillItems: '++id, &billKey, column, status, creatorMid, updateKey, generatedAt, localRank',
    dynamicBillFeedback: '++id, [scope+key], scope, key, creatorMid, billKey, column, createdAt',
    dynamicBillExplanations: '++id, &billKey, status, generatedAt, model, contentHash',
    currentVideoTranscriptSources: '++id, &identityKey, bvid, [bvid+cid+page], [bvid+cid+page+language], sourceHash, stale, updatedAt',
    currentVideoTranscriptSegments: '++id, &segmentId, bvid, [bvid+cid+page], [bvid+cid+page+language], sourceHash, stale, updatedAt',
  });
  await fixture.open();
  await fixture.table('dynamicBillItems').add({
    billKey: 'legacy-card',
    column: 'afk_update',
    status: 'unopened',
    creatorMid: 7,
    updateKey: 'legacy-update',
    generatedAt: Date.now() - 1_000,
    localRank: 0,
  });
  await fixture.table('dynamicBillExplanations').add({
    billKey: 'legacy-card',
    status: 'generated',
    generatedAt: Date.now() - 1_000,
    model: 'legacy-model',
    contentHash: 'legacy-hash',
  });
  if (options.feedback?.length) {
    await fixture.table('dynamicBillFeedback').bulkAdd(options.feedback);
  }
  if (options.seedUnrelatedRows) {
    await fixture.table('watchHistory').add(fixtureHistory());
    await fixture.table('favoriteItems').add(fixtureFavorite());
    await fixture.table('currentVideoTranscriptSources').add(fixtureTranscriptSource());
  }
  fixture.close();
  await db.open();
}

async function seedCurrentCandidate(now: number, creatorMid: number): Promise<void> {
  const nowSeconds = Math.floor(now / 1000);
  await db.followedCreators.put({
    mid: creatorMid,
    name: `UP ${creatorMid}`,
    face: '',
    sign: '',
    followAgeKnown: false,
    special: false,
    attribute: 0,
    tagId: 0,
    isActive: true,
    firstSeenAt: now,
    syncedAt: now,
    lastSeenAt: now,
  });
  await db.followedVideoUpdates.put({
    updateKey: `update-${creatorMid}`,
    dynamicId: `dynamic-${creatorMid}`,
    bvid: `BV1fixture${creatorMid}`,
    avid: creatorMid,
    title: `fixture video ${creatorMid}`,
    intro: '',
    cover: '',
    duration: 120,
    pubtime: nowSeconds - 60,
    dynamicTime: nowSeconds - 60,
    authorMid: creatorMid,
    authorName: `UP ${creatorMid}`,
    authorFace: '',
    tagName: '知识',
    tags: [],
    syncedAt: now,
  });
}

function legacyCreatorFeedback(
  creatorMid: number,
  createdAt: number | string,
  suffix: string,
): Record<string, unknown> {
  return {
    scope: 'creator',
    key: String(creatorMid),
    label: `legacy creator ${creatorMid}`,
    billKey: `legacy-${suffix}`,
    column: 'afk_update',
    creatorMid,
    creatorName: `UP ${creatorMid}`,
    createdAt,
  };
}

function legacyTopicFeedback(createdAt: number): Record<string, unknown> {
  return {
    scope: 'topic',
    key: 'category:legacy',
    label: 'legacy topic',
    billKey: 'legacy-topic',
    column: 'variety',
    creatorMid: 88,
    creatorName: 'legacy topic UP',
    topicKind: 'category',
    topicLabel: 'legacy',
    createdAt,
  };
}

function fixtureExplanation(now: number, billKey = 'legacy-card') {
  return {
    billKey,
    status: 'disabled' as const,
    summary: 'fixture',
    reason: 'fixture',
    viewingAngle: 'fixture',
    keywords: [],
    confidence: 0,
    model: '',
    generatedAt: now,
    contentHash: 'fixture',
  };
}

function fixtureFollowedVideoUpdate(
  now: number,
  creatorMid: number,
  key: string,
  dynamicTime: number,
  pubtime: number,
) {
  return {
    updateKey: `update-${creatorMid}-${key}`,
    dynamicId: `dynamic-${creatorMid}-${key}`,
    bvid: `BV1fixture${creatorMid}${key}`,
    avid: creatorMid,
    title: `fixture video ${creatorMid} ${key}`,
    intro: '',
    cover: '',
    duration: 120,
    pubtime,
    dynamicTime,
    authorMid: creatorMid,
    authorName: `UP ${creatorMid}`,
    authorFace: '',
    tagName: '知识',
    tags: [],
    syncedAt: now,
  };
}

function fixtureFavoriteForCreator(now: number, creatorMid: number, suffix: string) {
  return {
    itemKey: `favorite-${creatorMid}-${suffix}`,
    mediaId: 100 + creatorMid,
    folderTitle: 'Fixture folder',
    avid: creatorMid + 10_000,
    bvid: `BV1favorite${creatorMid}${suffix}`,
    title: `Favorite ${creatorMid}`,
    intro: '',
    authorName: `UP ${creatorMid}`,
    authorMid: creatorMid,
    tagName: '知识',
    tags: [],
    cover: '',
    duration: 120,
    pubtime: 0,
    favTime: Math.floor(now / 1000),
    syncedAt: now,
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    return permutations(rest).map(permutation => [value, ...permutation]);
  });
}

function fixtureSyncState() {
  return {
    status: 'idle' as const,
    stage: 'idle' as const,
    lastStartedAt: 0,
    lastFinishedAt: 0,
    lastSuccessAt: 0,
  };
}

function fixtureHistory(): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    sessionKey: `fixture:${nowSeconds}`,
    kid: 1,
    avid: 1,
    bvid: 'BV1history',
    cid: 1,
    title: 'fixture history',
    authorName: 'fixture UP',
    authorMid: 404,
    tagName: '知识',
    tags: [],
    cover: '',
    viewAt: nowSeconds,
    progress: 10,
    duration: 100,
    actualCompletion: 0.1,
    deviceType: 2,
    isFavorite: false,
    business: 'archive',
    dt: 2,
    syncedAt: Date.now(),
  };
}

function fixtureFavorite(): Record<string, unknown> {
  return {
    itemKey: 'fixture-favorite',
    mediaId: 1,
    avid: 1,
    bvid: 'BV1favorite',
    authorMid: 505,
    tagName: '知识',
    favTime: Math.floor(Date.now() / 1000),
    syncedAt: Date.now(),
  };
}

function fixtureTranscriptSource(): Record<string, unknown> {
  return {
    identityKey: 'BV1transcript:1:1:zh-CN',
    bvid: 'BV1transcript',
    cid: 1,
    page: 1,
    language: 'zh-CN',
    sourceHash: 'fixture',
    stale: false,
    updatedAt: Date.now(),
  };
}
