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
const dynamicBillRepo = await import('../src/background/storage/dynamic-bill-repo.ts');
const messageHandlers = await import('../src/background/messages/handlers.ts');
const {
  DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS,
} = await import('../src/background/storage/dynamic-bill-repo.ts');

const DB_NAME = 'BiliAnalyticsDB';
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);
const openedTabs: string[] = [];

(globalThis as unknown as {
  chrome: {
    tabs: {
      create: (options: { url?: string }) => Promise<{ id: number }>;
    };
  };
}).chrome = {
  tabs: {
    async create(options: { url?: string }) {
      if (options.url) openedTabs.push(options.url);
      return { id: openedTabs.length };
    },
  },
};

test.beforeEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
  await db.open();
  await migration.ensureDynamicBill013Migration();
});

test.after(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

test('creator less reminder is atomic, pending, and idempotent before finalize', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 101, status: 'opened', openedAt: NOW - 1_000 });

  const first = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-101', {
    idempotencyKey: 'first-click',
    now: NOW,
  });
  const duplicate = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-101', {
    idempotencyKey: 'first-click',
    now: NOW + 10,
  });
  const item = await db.dynamicBillItems.where('billKey').equals('bill-101').first();
  const pause = await db.dynamicBillCreatorPauses.where('creatorMid').equals(101).first();

  assert.equal(first?.status, 'pending_undo');
  assert.equal(duplicate?.status, 'already_pending');
  assert.equal(await db.dynamicBillFeedbackActions.count(), 1);
  assert.equal(await db.dynamicBillCreatorFeedbackCounts.count(), 0);
  assert.equal(item?.status, 'processed');
  assert.equal(item?.openedAt, NOW - 1_000);
  assert.equal(item?.processedAt, NOW);
  assert.equal(pause?.source, 'user');
  assert.equal(pause?.billKey, 'bill-101');
  assert.equal(pause?.actionKey, first?.action?.actionKey);
  assert.equal(pause?.expiresAt, NOW + 30 * DAY_MS);
  assert.equal(first?.action?.undoDeadlineAt, NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS);
});

test('undo within the durable window restores item fields and the previous pause', { concurrency: false }, async () => {
  await seedItem({
    creatorMid: 102,
    status: 'consumed',
    openedAt: NOW - 3_000,
    consumedAt: NOW - 2_000,
  });
  await db.dynamicBillCreatorPauses.put({
    creatorMid: 102,
    creatorName: 'UP 102',
    startedAt: NOW - DAY_MS,
    expiresAt: NOW + 10 * DAY_MS,
    source: 'migration',
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
  });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-102', {
    idempotencyKey: 'undo-previous-pause',
    now: NOW,
  });
  assert.ok(applied?.action);
  assert.equal((await db.dynamicBillCreatorPauses.where('creatorMid').equals(102).first())?.source, 'user');

  const undo = await dynamicBillRepo.undoDynamicBillCreatorLessReminder(
    applied.action.undoToken,
    NOW + 1_000,
  );
  const item = await db.dynamicBillItems.where('billKey').equals('bill-102').first();
  const pause = await db.dynamicBillCreatorPauses.where('creatorMid').equals(102).first();

  assert.equal(undo.status, 'undone');
  assert.equal(item?.status, 'consumed');
  assert.equal(item?.openedAt, NOW - 3_000);
  assert.equal(item?.consumedAt, NOW - 2_000);
  assert.equal(item?.processedAt, undefined);
  assert.equal(pause?.source, 'migration');
  assert.equal(pause?.expiresAt, NOW + 10 * DAY_MS);
  assert.equal(await db.dynamicBillCreatorFeedbackCounts.count(), 0);
  assert.equal(await db.dynamicBillCreatorReviewPrompts.count(), 0);
});

test('repeated undo on the same token is idempotent before the deadline', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 113, status: 'opened', openedAt: NOW - 2_000 });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-113', {
    idempotencyKey: 'undo-idempotent',
    now: NOW,
  });
  assert.ok(applied?.action);

  const firstUndo = await dynamicBillRepo.undoDynamicBillCreatorLessReminder(
    applied.action.undoToken,
    NOW + 1_000,
  );
  const secondUndo = await dynamicBillRepo.undoDynamicBillCreatorLessReminder(
    applied.action.undoToken,
    NOW + 1_500,
  );
  const item = await db.dynamicBillItems.where('billKey').equals('bill-113').first();

  assert.equal(firstUndo.status, 'undone');
  assert.equal(secondUndo.status, 'already_undone');
  assert.equal(item?.status, 'opened');
  assert.equal(await db.dynamicBillCreatorPauses.where('creatorMid').equals(113).count(), 0);
  assert.equal(await db.dynamicBillCreatorFeedbackCounts.count(), 0);
});

test('concurrent undo calls on one token do not report expired or finalize', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 114 });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-114', {
    idempotencyKey: 'undo-concurrent',
    now: NOW,
  });
  assert.ok(applied?.action);

  const results = await Promise.all([
    dynamicBillRepo.undoDynamicBillCreatorLessReminder(applied.action.undoToken, NOW + 1_000),
    dynamicBillRepo.undoDynamicBillCreatorLessReminder(applied.action.undoToken, NOW + 1_001),
  ]);
  const statuses = results.map(result => result.status).sort();

  assert.deepEqual(statuses, ['already_undone', 'undone']);
  assert.equal(await db.dynamicBillCreatorFeedbackCounts.count(), 0);
  assert.equal(await db.dynamicBillCreatorPauses.where('creatorMid').equals(114).count(), 0);
  assert.equal((await db.dynamicBillFeedbackActions.where('actionKey').equals(applied.action.actionKey).first())?.state, 'undone');
});

test('expired undo finalizes exactly once and old token fails closed', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 103 });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-103', {
    idempotencyKey: 'expire-once',
    now: NOW,
  });
  assert.ok(applied?.action);

  const expiredUndo = await dynamicBillRepo.undoDynamicBillCreatorLessReminder(
    applied.action.undoToken,
    NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 1,
  );
  const repeatedExpiredUndo = await dynamicBillRepo.undoDynamicBillCreatorLessReminder(
    applied.action.undoToken,
    NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 2,
  );
  await dynamicBillRepo.getDynamicBillFeedbackState(
    NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 3,
  );
  const count = await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(103).first();

  assert.equal(expiredUndo.status, 'expired');
  assert.equal(repeatedExpiredUndo.status, 'expired');
  assert.equal(count?.effectiveCount, 1);
  assert.equal(await db.dynamicBillFeedbackActions.where('state').equals('finalized').count(), 1);
});

test('third effective less reminder creates one pending prompt, while undone third does not count', { concurrency: false }, async () => {
  await finalizeAction(104, 'bill-104-a', NOW);
  await restoreCurrentPause(104, NOW + 20_000);
  await finalizeAction(104, 'bill-104-b', NOW + 40_000);
  await restoreCurrentPause(104, NOW + 60_000);
  await seedItem({ creatorMid: 104, billKey: 'bill-104-c' });
  const thirdUndone = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-104-c', {
    idempotencyKey: 'third-undone',
    now: NOW + 80_000,
  });
  assert.ok(thirdUndone?.action);
  assert.equal(
    (await dynamicBillRepo.undoDynamicBillCreatorLessReminder(thirdUndone.action.undoToken, NOW + 81_000)).status,
    'undone',
  );
  assert.equal((await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(104).first())?.effectiveCount, 2);
  assert.equal(await db.dynamicBillCreatorReviewPrompts.count(), 0);

  await finalizeAction(104, 'bill-104-d', NOW + 120_000);
  await dynamicBillRepo.getDynamicBillFeedbackState(NOW + 140_000);
  await dynamicBillRepo.getDynamicBillFeedbackState(NOW + 150_000);
  const count = await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(104).first();
  const prompts = await db.dynamicBillCreatorReviewPrompts.toArray();

  assert.equal(count?.effectiveCount, 3);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].state, 'pending');
  assert.equal(prompts[0].effectiveCount, 3);
});

test('prompt buttons resolve once and do not change the current pause', { concurrency: false }, async () => {
  await finalizeAction(105, 'bill-105-a', NOW);
  await restoreCurrentPause(105, NOW + 20_000);
  await finalizeAction(105, 'bill-105-b', NOW + 40_000);
  await restoreCurrentPause(105, NOW + 60_000);
  await finalizeAction(105, 'bill-105-c', NOW + 80_000);
  const pauseBefore = await db.dynamicBillCreatorPauses.where('creatorMid').equals(105).first();

  const opened = await dynamicBillRepo.resolveDynamicBillCreatorReviewPrompt(105, 'open_space', NOW + 100_000);
  const second = await dynamicBillRepo.resolveDynamicBillCreatorReviewPrompt(105, 'dismiss', NOW + 101_000);
  const pauseAfter = await db.dynamicBillCreatorPauses.where('creatorMid').equals(105).first();

  assert.equal(opened.status, 'resolved');
  assert.equal(opened.url, 'https://space.bilibili.com/105');
  assert.equal(second.status, 'not_found');
  assert.equal((await db.dynamicBillCreatorReviewPrompts.where('creatorMid').equals(105).first())?.state, 'opened');
  assert.equal(pauseAfter?.expiresAt, pauseBefore?.expiresAt);
  assert.equal(pauseAfter?.source, 'user');
});

test('concurrent prompt opens resolve once and create at most one tab through the handler', { concurrency: false }, async () => {
  await createPendingReviewPrompt(109, NOW);
  openedTabs.length = 0;

  const [first, second] = await Promise.all([
    messageHandlers.handleRequest({
      action: 'OPEN_DYNAMIC_BILL_CREATOR_REVIEW_PROMPT',
      params: { creatorMid: 109 },
    }),
    messageHandlers.handleRequest({
      action: 'OPEN_DYNAMIC_BILL_CREATOR_REVIEW_PROMPT',
      params: { creatorMid: 109 },
    }),
  ]);
  const results = [first.data, second.data] as Array<{ status: string; url?: string }>;

  assert.equal(results.filter(result => result.status === 'resolved').length, 1);
  assert.equal(results.filter(result => result.status === 'not_found').length, 1);
  assert.deepEqual(openedTabs, ['https://space.bilibili.com/109']);
  assert.equal((await db.dynamicBillCreatorReviewPrompts.where('creatorMid').equals(109).first())?.state, 'opened');
});

test('concurrent prompt open and dismiss are mutually exclusive', { concurrency: false }, async () => {
  await createPendingReviewPrompt(110, NOW);

  const results = await Promise.all([
    dynamicBillRepo.resolveDynamicBillCreatorReviewPrompt(110, 'open_space', NOW + 100_000),
    dynamicBillRepo.resolveDynamicBillCreatorReviewPrompt(110, 'dismiss', NOW + 100_001),
  ]);
  const resolved = results.filter(result => result.status === 'resolved');
  const stored = await db.dynamicBillCreatorReviewPrompts.where('creatorMid').equals(110).first();

  assert.equal(resolved.length, 1);
  assert.equal(results.filter(result => result.status === 'not_found').length, 1);
  assert.ok(stored?.state === 'opened' || stored?.state === 'dismissed');
  assert.equal(stored?.decision, stored?.state === 'opened' ? 'open_space' : 'dismiss');
});

test('same bill with different idempotency keys creates one pending action and finalizes once', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 115 });

  const results = await Promise.all([
    dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-115', {
      idempotencyKey: 'same-bill-a',
      now: NOW,
    }),
    dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-115', {
      idempotencyKey: 'same-bill-b',
      now: NOW + 1,
    }),
  ]);
  const stateBeforeFinalize = await dynamicBillRepo.getDynamicBillFeedbackState(NOW + 1_000);

  assert.equal(results.filter(result => result?.status === 'pending_undo').length, 1);
  assert.equal(results.filter(result => result?.status === 'already_pending').length, 1);
  assert.equal(await db.dynamicBillFeedbackActions.where('state').equals('pending_undo').count(), 1);
  assert.equal(await db.dynamicBillCreatorPauses.where('creatorMid').equals(115).count(), 1);
  assert.equal(stateBeforeFinalize.pendingActions.length, 1);

  await dynamicBillRepo.getDynamicBillFeedbackState(
    NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 2,
  );
  const count = await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(115).first();

  assert.equal(count?.effectiveCount, 1);
  assert.equal(await db.dynamicBillFeedbackActions.where('state').equals('finalized').count(), 1);
});

test('same creator on different bill keys has one pending action and one effective finalize', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 116, billKey: 'bill-116-a' });
  await seedItem({ creatorMid: 116, billKey: 'bill-116-b' });

  const results = await Promise.all([
    dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-116-a', {
      idempotencyKey: 'same-creator-a',
      now: NOW,
    }),
    dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-116-b', {
      idempotencyKey: 'same-creator-b',
      now: NOW + 1,
    }),
  ]);
  const items = await db.dynamicBillItems.where('creatorMid').equals(116).toArray();
  const stateBeforeFinalize = await dynamicBillRepo.getDynamicBillFeedbackState(NOW + 1_000);

  assert.equal(results.filter(result => result?.status === 'pending_undo').length, 1);
  assert.equal(results.filter(result => result?.status === 'already_pending').length, 1);
  assert.equal(await db.dynamicBillFeedbackActions.where('state').equals('pending_undo').count(), 1);
  assert.equal(await db.dynamicBillCreatorPauses.where('creatorMid').equals(116).count(), 1);
  assert.equal(items.filter(item => item.status === 'processed').length, 1);
  assert.equal(stateBeforeFinalize.pendingActions.length, 1);

  await dynamicBillRepo.getDynamicBillFeedbackState(
    NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 2,
  );
  const count = await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(116).first();

  assert.equal(count?.effectiveCount, 1);
  assert.equal(await db.dynamicBillFeedbackActions.where('state').equals('finalized').count(), 1);
});

test('settings restore rejects a stale observed pause and preserves the later pause', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 111 });
  await db.dynamicBillCreatorPauses.put({
    creatorMid: 111,
    creatorName: 'UP 111',
    startedAt: NOW - DAY_MS,
    expiresAt: NOW + 10 * DAY_MS,
    source: 'migration',
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
  });
  const observed = (await dynamicBillRepo.getDynamicBillActiveCreatorPauseViews(NOW))
    .find(pause => pause.creatorMid === 111);
  assert.ok(observed);

  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-111', {
    idempotencyKey: 'restore-stale-later-pause',
    now: NOW + 2,
  });
  const restored = await dynamicBillRepo.restoreDynamicBillCreatorReminder(111, observed.version, NOW + 3);
  const finalPause = await db.dynamicBillCreatorPauses.where('creatorMid').equals(111).first();

  assert.ok(applied?.action);
  assert.equal(restored.status, 'stale');
  assert.equal(restored.currentPause?.source, 'user');
  assert.equal(finalPause?.source, 'user');
  assert.equal(finalPause?.actionKey, applied.action.actionKey);
  assert.equal(finalPause?.expiresAt, NOW + 2 + 30 * DAY_MS);
});

test('undo after settings restore does not resurrect or overwrite the restored pause state', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 112, status: 'opened', openedAt: NOW - 4_000 });
  await db.dynamicBillCreatorPauses.put({
    creatorMid: 112,
    creatorName: 'UP 112',
    startedAt: NOW - DAY_MS,
    expiresAt: NOW + 10 * DAY_MS,
    source: 'migration',
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
  });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-112', {
    idempotencyKey: 'restore-undo-race',
    now: NOW,
  });
  assert.ok(applied?.action);
  const observed = (await dynamicBillRepo.getDynamicBillActiveCreatorPauseViews(NOW + 1))
    .find(pause => pause.creatorMid === 112);
  assert.ok(observed);

  const restored = await dynamicBillRepo.restoreDynamicBillCreatorReminder(112, observed.version, NOW + 1);
  const undo = await dynamicBillRepo.undoDynamicBillCreatorLessReminder(applied.action.undoToken, NOW + 2);
  const item = await db.dynamicBillItems.where('billKey').equals('bill-112').first();

  assert.equal(restored.status, 'restored');
  assert.equal(undo.status, 'undone');
  assert.equal(await db.dynamicBillCreatorPauses.where('creatorMid').equals(112).count(), 0);
  assert.equal(item?.status, 'opened');
  assert.equal(item?.openedAt, NOW - 4_000);
  assert.equal((await db.dynamicBillFeedbackActions.where('actionKey').equals(applied.action.actionKey).first())?.state, 'undone');
});

test('settings restore deletes only the pause; expiry also cleans active pause state', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 106 });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-106', {
    idempotencyKey: 'restore-only-pause',
    now: NOW,
  });
  assert.ok(applied?.action);
  const observed = (await dynamicBillRepo.getDynamicBillActiveCreatorPauseViews(NOW + 1_000))
    .find(pause => pause.creatorMid === 106);
  assert.ok(observed);
  const restored = await dynamicBillRepo.restoreDynamicBillCreatorReminder(106, observed.version, NOW + 1_000);
  const secondRestore = await dynamicBillRepo.restoreDynamicBillCreatorReminder(106, observed.version, NOW + 1_001);

  assert.equal(restored.status, 'restored');
  assert.equal(restored.pause?.creatorMid, 106);
  assert.equal(secondRestore.status, 'not_found');
  assert.equal(await db.dynamicBillCreatorPauses.count(), 0);
  assert.equal(await db.dynamicBillCreatorFeedbackCounts.count(), 0);

  await dynamicBillRepo.getDynamicBillFeedbackState(
    NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 1,
  );
  assert.equal((await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(106).first())?.effectiveCount, 1);

  await seedItem({ creatorMid: 107 });
  await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-107', {
    idempotencyKey: 'expire-pause',
    now: NOW,
  });
  assert.equal((await dynamicBillRepo.getActiveDynamicBillCreatorPauses(NOW)).length, 1);
  assert.equal((await dynamicBillRepo.getActiveDynamicBillCreatorPauses(NOW + 31 * DAY_MS)).length, 0);
});

test('legacy feedback injected after migration does not affect new counts or prompts', { concurrency: false }, async () => {
  await db.dynamicBillFeedback.add({
    scope: 'creator',
    key: '108',
    label: 'legacy',
    billKey: 'legacy',
    column: 'buried_follow',
    creatorMid: 108,
    creatorName: 'UP 108',
    createdAt: NOW,
  });

  await finalizeAction(108, 'bill-108-a', NOW);
  await restoreCurrentPause(108, NOW + 20_000);
  await finalizeAction(108, 'bill-108-b', NOW + 40_000);
  const count = await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(108).first();

  assert.equal(await db.dynamicBillFeedback.count(), 1);
  assert.equal(count?.effectiveCount, 2);
  assert.equal(await db.dynamicBillCreatorReviewPrompts.count(), 0);
});

async function finalizeAction(creatorMid: number, billKey: string, now: number): Promise<void> {
  await seedItem({ creatorMid, billKey });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder(billKey, {
    idempotencyKey: `${billKey}-action`,
    now,
  });
  assert.ok(applied?.action);
  await dynamicBillRepo.getDynamicBillFeedbackState(
    now + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 1,
  );
}

async function restoreCurrentPause(creatorMid: number, now: number): Promise<void> {
  const pause = (await dynamicBillRepo.getDynamicBillActiveCreatorPauseViews(now))
    .find(item => item.creatorMid === creatorMid);
  assert.ok(pause, `Expected active pause for creator ${creatorMid}`);
  const restored = await dynamicBillRepo.restoreDynamicBillCreatorReminder(creatorMid, pause.version, now);
  assert.equal(restored.status, 'restored');
}

async function createPendingReviewPrompt(creatorMid: number, now: number): Promise<void> {
  await finalizeAction(creatorMid, `bill-${creatorMid}-a`, now);
  await restoreCurrentPause(creatorMid, now + 20_000);
  await finalizeAction(creatorMid, `bill-${creatorMid}-b`, now + 40_000);
  await restoreCurrentPause(creatorMid, now + 60_000);
  await finalizeAction(creatorMid, `bill-${creatorMid}-c`, now + 80_000);
}

async function seedItem(options: {
  creatorMid: number;
  billKey?: string;
  status?: 'unopened' | 'opened' | 'consumed' | 'processed';
  openedAt?: number;
  consumedAt?: number;
  processedAt?: number;
}): Promise<void> {
  const billKey = options.billKey ?? `bill-${options.creatorMid}`;
  const creatorName = `UP ${options.creatorMid}`;
  await db.dynamicBillItems.put({
    billKey,
    column: 'follow_rotation',
    status: options.status ?? 'unopened',
    updateKey: `${billKey}-update`,
    creatorMid: options.creatorMid,
    creatorName,
    creatorFace: '',
    historyBvids: [],
    openedAt: options.openedAt,
    consumedAt: options.consumedAt,
    processedAt: options.processedAt,
    evidence: {
      kind: 'follow_rotation',
      longWindow: windowEvidence(),
      recentWindow: windowEvidence(),
      newVideo: {
        updateKey: `${billKey}-update`,
        dynamicId: `${billKey}-dynamic`,
        bvid: `BV${String(options.creatorMid).padStart(10, '0')}`,
        avid: options.creatorMid,
        title: `Video ${options.creatorMid}`,
        cover: '',
        duration: 120,
        pubtime: 0,
        dynamicTime: 0,
        tagName: 'tech',
        tags: [],
      },
      follow: {
        followAgeKnown: false,
      },
      cooldownRatio: 0,
      daysSinceLastWatch: null,
      facts: [],
      thresholds: {
        longWindowDays: 180,
        recentWindowDays: 30,
        updateWindowDays: 7,
        positiveCompletionRate: 0.5,
        minPositiveWatchSeconds: 180,
        minBuriedFollowAgeDays: 180,
        minObservedFollowDays: 30,
        minBuriedWeakWatchCount: 1,
        maxBuriedRecentWatchCount: 1,
        maxBuriedRecentPositiveWatchCount: 0,
        maxItemsPerColumn: 5,
        maxItemsTotal: 15,
      },
    },
    localRank: 1,
    score: 0,
    generatedAt: NOW,
  });
}

function windowEvidence() {
  return {
    windowDays: 30,
    startedAt: 0,
    endedAt: 0,
    watchedCount: 0,
    positiveWatchCount: 0,
    totalWatchTimeSeconds: 0,
    avgCompletion: 0,
    lastWatchedAt: 0,
  };
}
