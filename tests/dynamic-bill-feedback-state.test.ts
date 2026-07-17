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
const {
  DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS,
} = await import('../src/background/storage/dynamic-bill-repo.ts');

const DB_NAME = 'BiliAnalyticsDB';
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);

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
  await dynamicBillRepo.getDynamicBillFeedbackState(
    NOW + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS + 2,
  );
  const count = await db.dynamicBillCreatorFeedbackCounts.where('creatorMid').equals(103).first();

  assert.equal(expiredUndo.status, 'expired');
  assert.equal(count?.effectiveCount, 1);
  assert.equal(await db.dynamicBillFeedbackActions.where('state').equals('finalized').count(), 1);
});

test('third effective less reminder creates one pending prompt, while undone third does not count', { concurrency: false }, async () => {
  await finalizeAction(104, 'bill-104-a', NOW);
  await dynamicBillRepo.restoreDynamicBillCreatorReminder(104, NOW + 20_000);
  await finalizeAction(104, 'bill-104-b', NOW + 40_000);
  await dynamicBillRepo.restoreDynamicBillCreatorReminder(104, NOW + 60_000);
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
  await dynamicBillRepo.restoreDynamicBillCreatorReminder(105, NOW + 20_000);
  await finalizeAction(105, 'bill-105-b', NOW + 40_000);
  await dynamicBillRepo.restoreDynamicBillCreatorReminder(105, NOW + 60_000);
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

test('settings restore deletes only the pause; expiry also cleans active pause state', { concurrency: false }, async () => {
  await seedItem({ creatorMid: 106 });
  const applied = await dynamicBillRepo.applyDynamicBillCreatorLessReminder('bill-106', {
    idempotencyKey: 'restore-only-pause',
    now: NOW,
  });
  assert.ok(applied?.action);
  const restored = await dynamicBillRepo.restoreDynamicBillCreatorReminder(106, NOW + 1_000);
  assert.equal(restored?.creatorMid, 106);
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
  await dynamicBillRepo.restoreDynamicBillCreatorReminder(108, NOW + 20_000);
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
