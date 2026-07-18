import { DYNAMIC_UPDATE_WINDOW_DAYS } from '../../shared/constants';
import type {
  DynamicBillColumn,
  DynamicBillCreatorPauseRecord,
  DynamicBillCreatorPauseView,
  DynamicBillCreatorReviewPromptRecord,
  DynamicBillCreatorReviewPromptView,
  DynamicBillExplanation,
  DynamicBillFeedbackActionRecord,
  DynamicBillFeedbackStateView,
  DynamicBillFeedbackScope,
  DynamicBillFilterPreference,
  DynamicBillItem,
  DynamicBillLessReminderResult,
  DynamicBillOverview,
  DynamicBillPendingFeedbackActionView,
  DynamicBillReviewPromptResolveAction,
  DynamicBillReviewPromptResolveResult,
  DynamicBillRotationRecord,
  DynamicBillStatus,
  DynamicBillStatusFilter,
  DynamicBillUndoFeedbackResult,
  DynamicSyncState,
  FollowedCreator,
  FollowedVideoUpdate,
} from '../../shared/types/dynamic-bill';
import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import { buildDynamicBillExplanationContent } from '../dynamic-bill/explanation-content';
import { ensureDynamicBill013Migration } from '../dynamic-bill/migration';
import { DYNAMIC_BILL_COLUMNS, DYNAMIC_BILL_STRATEGY } from '../dynamic-bill/strategy';
import { compareFollowedVideoUpdatesNewestFirst } from '../dynamic-bill/update-order';
import { db } from './db';

const DYNAMIC_SYNC_STATE_KEY = 'dynamicBillSyncState';
const DYNAMIC_BILL_FILTER_KEY = 'dynamicBillFilterPreference';
const DYNAMIC_SYNC_STALE_TIMEOUT_MS = 5 * 60 * 1000;
export const DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS = 8_000;
const CREATOR_LESS_REMINDER_PAUSE_DAYS = 30;
const CREATOR_LESS_REMINDER_REVIEW_THRESHOLD = 3;
const DAY_MS = 86_400_000;
const DEFAULT_SYNC_STATE: DynamicSyncState = {
  status: 'idle',
  stage: 'idle',
  lastStartedAt: 0,
  lastFinishedAt: 0,
  lastSuccessAt: 0,
};
const DEFAULT_FILTER_PREFERENCE: DynamicBillFilterPreference = {
  status: 'active',
  updatedAt: 0,
};

export interface DynamicBillFeedbackProfile {
  pausedCreatorMids: Set<number>;
  pausesByCreatorMid: Map<number, DynamicBillCreatorPauseRecord>;
}

export type DynamicBillExplanationWriteResult =
  | { status: 'written'; explanation: DynamicBillExplanation }
  | { status: 'discarded' };

export interface DynamicBillExplanationAttempt {
  billKey: string;
  contentHash: string;
  model: string;
  generation: number;
}

export async function replaceFollowedCreatorSnapshot(creators: FollowedCreator[], syncedAt: number): Promise<number> {
  await ensureDynamicBill013Migration();
  const activeMids = new Set(creators.map(creator => creator.mid));

  await db.transaction('rw', db.followedCreators, async () => {
    const existing = await db.followedCreators.toArray();
    const existingByMid = new Map(existing.map(creator => [creator.mid, creator]));
    const nextCreators = creators.map(creator => {
      const previous = existingByMid.get(creator.mid);
      return {
        ...creator,
        id: previous?.id,
        isActive: true,
        firstSeenAt: previous?.firstSeenAt ?? previous?.syncedAt ?? syncedAt,
        syncedAt,
        lastSeenAt: syncedAt,
      };
    });

    if (nextCreators.length > 0) {
      await db.followedCreators.bulkPut(nextCreators);
    }

    await db.followedCreators
      .filter(creator => creator.isActive !== false && !activeMids.has(creator.mid))
      .modify({
        isActive: false,
        syncedAt,
      });
  });

  return creators.length;
}

export async function upsertFollowedVideoUpdates(updates: FollowedVideoUpdate[]): Promise<number> {
  await ensureDynamicBill013Migration();
  if (updates.length === 0) return 0;

  await db.transaction('rw', db.followedVideoUpdates, async () => {
    const existing = await db.followedVideoUpdates
      .where('updateKey')
      .anyOf(updates.map(update => update.updateKey))
      .toArray();
    const existingByKey = new Map(existing.map(update => [update.updateKey, update]));
    await db.followedVideoUpdates.bulkPut(updates.map(update => ({
      ...update,
      id: existingByKey.get(update.updateKey)?.id,
    })));
  });

  return updates.length;
}

export async function pruneFollowedVideoUpdatesOlderThan(days: number): Promise<number> {
  await ensureDynamicBill013Migration();
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(1, Math.floor(days)) * 86_400;
  return db.followedVideoUpdates.where('dynamicTime').below(cutoff).delete();
}

export async function getRecentFollowedVideoUpdates(windowDays = DYNAMIC_UPDATE_WINDOW_DAYS): Promise<FollowedVideoUpdate[]> {
  await ensureDynamicBill013Migration();
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(1, Math.floor(windowDays)) * 86_400;
  const updates = await db.followedVideoUpdates
    .where('dynamicTime')
    .aboveOrEqual(cutoff)
    .toArray();
  return updates.sort(compareFollowedVideoUpdatesNewestFirst);
}

export async function getActiveFollowedCreators(): Promise<FollowedCreator[]> {
  await ensureDynamicBill013Migration();
  const creators = await db.followedCreators.toArray();
  return creators.filter(creator => creator.isActive !== false);
}

export async function getFollowedCreatorSnapshot(): Promise<FollowedCreator[]> {
  await ensureDynamicBill013Migration();
  return db.followedCreators.toArray();
}

export async function getDynamicBillRotationRecords(): Promise<DynamicBillRotationRecord[]> {
  await ensureDynamicBill013Migration();
  return db.dynamicBillRotationRecords.toArray();
}

export async function getActiveDynamicBillCreatorPauses(now = Date.now()): Promise<DynamicBillCreatorPauseRecord[]> {
  await ensureDynamicBill013Migration();
  await finalizeExpiredDynamicBillFeedbackActions(now);
  await db.dynamicBillCreatorPauses.where('expiresAt').belowOrEqual(now).delete();
  return db.dynamicBillCreatorPauses.where('expiresAt').above(now).toArray();
}

export async function getDynamicBillActiveCreatorPauseViews(now = Date.now()): Promise<DynamicBillCreatorPauseView[]> {
  const pauses = await getActiveDynamicBillCreatorPauses(now);
  return pauses
    .sort((a, b) => a.expiresAt - b.expiresAt || a.creatorMid - b.creatorMid)
    .map(pause => toCreatorPauseView(pause, now));
}

export async function getDynamicBillFeedbackState(now = Date.now()): Promise<DynamicBillFeedbackStateView> {
  await ensureDynamicBill013Migration();
  await finalizeExpiredDynamicBillFeedbackActions(now);
  const [actions, prompts] = await Promise.all([
    db.dynamicBillFeedbackActions
      .where('state')
      .equals('pending_undo')
      .toArray(),
    db.dynamicBillCreatorReviewPrompts
      .where('state')
      .equals('pending')
      .toArray(),
  ]);

  return {
    pendingActions: actions
      .filter(action => action.undoDeadlineAt > now)
      .sort((a, b) => a.undoDeadlineAt - b.undoDeadlineAt || a.createdAt - b.createdAt)
      .map(toPendingFeedbackActionView),
    reviewPrompts: prompts
      .sort((a, b) => a.createdAt - b.createdAt || a.creatorMid - b.creatorMid)
      .map(toCreatorReviewPromptView),
  };
}

export async function applyDynamicBillCreatorLessReminder(
  billKey: string,
  options: {
    idempotencyKey?: string;
    now?: number;
  } = {},
): Promise<DynamicBillLessReminderResult | null> {
  await ensureDynamicBill013Migration();
  const now = normalizeOperationTimestamp(options.now);
  await finalizeExpiredDynamicBillFeedbackActions(now);
  const suppliedActionKey = normalizeActionKey(options.idempotencyKey);

  return db.transaction(
    'rw',
    [
      db.dynamicBillItems,
      db.dynamicBillCreatorPauses,
      db.dynamicBillFeedbackActions,
      db.dynamicBillCreatorFeedbackCounts,
      db.dynamicBillCreatorReviewPrompts,
    ],
    async () => {
      if (suppliedActionKey) {
        const existingByKey = await db.dynamicBillFeedbackActions
          .where('actionKey')
          .equals(suppliedActionKey)
          .first();
        if (existingByKey) {
          return existingLessReminderResult(existingByKey, await itemForAction(existingByKey), now);
        }
      }

      const item = await db.dynamicBillItems
        .where('billKey')
        .equals(billKey)
        .first();
      if (!item) return null;

      const existingForItem = await db.dynamicBillFeedbackActions
        .where('[billKey+creatorMid]')
        .equals([item.billKey, item.creatorMid])
        .filter(action => action.state !== 'undone')
        .first();
      if (existingForItem) {
        return existingLessReminderResult(existingForItem, item, now);
      }
      const existingPendingForCreator = await db.dynamicBillFeedbackActions
        .where('creatorMid')
        .equals(item.creatorMid)
        .filter(action => action.state === 'pending_undo')
        .first();
      if (existingPendingForCreator) {
        return existingLessReminderResult(existingPendingForCreator, await itemForAction(existingPendingForCreator) ?? item, now);
      }

      const existingPause = await db.dynamicBillCreatorPauses
        .where('creatorMid')
        .equals(item.creatorMid)
        .first();
      const actionKey = suppliedActionKey ?? makeActionKey(item, now);
      const undoToken = makeUndoToken(actionKey);
      const appliedProcessedAt = item.processedAt ?? now;
      const pauseExpiresAt = now + CREATOR_LESS_REMINDER_PAUSE_DAYS * DAY_MS;
      const action: DynamicBillFeedbackActionRecord = {
        actionKey,
        billKey: item.billKey,
        creatorMid: item.creatorMid,
        creatorName: item.creatorName,
        state: 'pending_undo',
        undoToken,
        undoDeadlineAt: now + DYNAMIC_BILL_CREATOR_LESS_REMINDER_UNDO_WINDOW_MS,
        previousStatus: item.status,
        previousOpenedAt: item.openedAt,
        previousConsumedAt: item.consumedAt,
        previousProcessedAt: item.processedAt,
        previousPause: existingPause ? { ...existingPause } : null,
        appliedProcessedAt,
        pauseStartedAt: now,
        pauseExpiresAt,
        createdAt: now,
        updatedAt: now,
      };
      const processedItem = applyProcessedStateForLessReminder(item, appliedProcessedAt);
      await db.dynamicBillItems.put(processedItem);
      await db.dynamicBillCreatorPauses.put({
        id: existingPause?.id,
        creatorMid: item.creatorMid,
        creatorName: item.creatorName,
        startedAt: now,
        expiresAt: pauseExpiresAt,
        source: 'user',
        billKey: item.billKey,
        actionKey,
        createdAt: existingPause?.createdAt ?? now,
        updatedAt: now,
      });
      await db.dynamicBillFeedbackActions.put(action);

      return {
        status: 'pending_undo',
        action: toPendingFeedbackActionView(action),
        item: processedItem,
      };
    },
  );
}

export async function undoDynamicBillCreatorLessReminder(
  undoToken: string,
  now = Date.now(),
): Promise<DynamicBillUndoFeedbackResult> {
  await ensureDynamicBill013Migration();
  await finalizeExpiredDynamicBillFeedbackActions(now);

  return db.transaction(
    'rw',
    db.dynamicBillItems,
    db.dynamicBillCreatorPauses,
    db.dynamicBillFeedbackActions,
    async () => {
      const action = await db.dynamicBillFeedbackActions
        .where('undoToken')
        .equals(undoToken)
        .first();
      if (!action) return { status: 'invalid' };
      if (action.state !== 'pending_undo') return { status: 'expired' };
      if (action.undoDeadlineAt <= now) return { status: 'expired' };

      const [item, pause] = await Promise.all([
        db.dynamicBillItems.where('billKey').equals(action.billKey).first(),
        db.dynamicBillCreatorPauses.where('creatorMid').equals(action.creatorMid).first(),
      ]);
      if (!item || !itemMatchesPendingAction(item, action)) {
        return { status: 'conflict' };
      }
      const ownsCurrentPause = pauseMatchesAction(pause, action);

      const restoredItem = restoreItemBeforeFeedback(item, action);
      await db.dynamicBillItems.put(restoredItem);
      if (!ownsCurrentPause) {
        // A later settings restore or pause write already changed this creator's pause.
        // Keep that later user-visible pause state and only undo this bill item's status.
      } else if (action.previousPause) {
        await db.dynamicBillCreatorPauses.put({ ...action.previousPause });
      } else if (pause?.id !== undefined) {
        await db.dynamicBillCreatorPauses.delete(pause.id);
      }
      await db.dynamicBillFeedbackActions.put({
        ...action,
        state: 'undone',
        undoneAt: now,
        updatedAt: now,
      });

      return {
        status: 'undone',
        item: restoredItem,
      };
    },
  );
}

export async function restoreDynamicBillCreatorReminder(
  creatorMid: number,
  now = Date.now(),
): Promise<DynamicBillCreatorPauseView | null> {
  await ensureDynamicBill013Migration();
  await finalizeExpiredDynamicBillFeedbackActions(now);
  return db.transaction('rw', db.dynamicBillCreatorPauses, async () => {
    const pause = await db.dynamicBillCreatorPauses
      .where('creatorMid')
      .equals(creatorMid)
      .first();
    if (!pause) return null;

    const view = pause.expiresAt > now ? toCreatorPauseView(pause, now) : null;
    if (pause.id !== undefined) {
      await deleteCreatorPauseIfUnchanged(pause);
    }
    return view;
  });
}

export async function getDynamicBillCreatorReviewPrompts(now = Date.now()): Promise<DynamicBillCreatorReviewPromptView[]> {
  const state = await getDynamicBillFeedbackState(now);
  return state.reviewPrompts;
}

export async function resolveDynamicBillCreatorReviewPrompt(
  creatorMid: number,
  action: DynamicBillReviewPromptResolveAction,
  now = Date.now(),
): Promise<DynamicBillReviewPromptResolveResult> {
  await ensureDynamicBill013Migration();
  await finalizeExpiredDynamicBillFeedbackActions(now);

  return db.transaction('rw', db.dynamicBillCreatorReviewPrompts, async () => {
    const prompt = await db.dynamicBillCreatorReviewPrompts
      .where('creatorMid')
      .equals(creatorMid)
      .first();
    if (!prompt || prompt.state !== 'pending') {
      return { status: 'not_found' };
    }
    const nextPrompt: DynamicBillCreatorReviewPromptRecord = {
      ...prompt,
      state: action === 'open_space' ? 'opened' : 'dismissed',
      decision: action,
      resolvedAt: now,
      updatedAt: now,
    };
    await db.dynamicBillCreatorReviewPrompts.put(nextPrompt);
    const view = toCreatorReviewPromptView(prompt);
    return {
      status: 'resolved',
      prompt: view,
      url: action === 'open_space' ? creatorSpaceUrl(creatorMid) : undefined,
    };
  });
}

export async function finalizeExpiredDynamicBillFeedbackActions(
  now = Date.now(),
): Promise<DynamicBillCreatorReviewPromptView[]> {
  await ensureDynamicBill013Migration();
  const expiredActions = await db.dynamicBillFeedbackActions
    .where('undoDeadlineAt')
    .belowOrEqual(now)
    .filter(action => action.state === 'pending_undo')
    .toArray();
  const prompts: DynamicBillCreatorReviewPromptView[] = [];
  for (const action of expiredActions) {
    const prompt = await finalizeDynamicBillFeedbackAction(action.actionKey, now);
    if (prompt) prompts.push(prompt);
  }
  return prompts;
}

export async function replaceAllDynamicBillItems(
  items: DynamicBillItem[],
  generatedAt = Date.now(),
): Promise<DynamicBillItem[]> {
  await ensureDynamicBill013Migration();
  const storedItems: DynamicBillItem[] = [];

  await db.transaction(
    'rw',
    db.dynamicBillItems,
    db.dynamicBillRotationRecords,
    db.dynamicBillExplanations,
    db.followedVideoUpdates,
    async () => {
      const existing = await db.dynamicBillItems.toArray();
      const existingByKey = new Map(existing.map(item => [item.billKey, item]));
      const existingRotations = await db.dynamicBillRotationRecords.toArray();
      const rotationIdsByCreator = new Map(existingRotations.map(record => [record.creatorMid, record.id]));

      await db.dynamicBillItems.clear();
      const nextItems = items.map(item => mergeExistingDynamicBillState(item, existingByKey.get(item.billKey)));
      const updateKeys = Array.from(new Set(nextItems.map(item => item.updateKey)));
      const updates = updateKeys.length > 0
        ? await db.followedVideoUpdates.where('updateKey').anyOf(updateKeys).toArray()
        : [];
      const updatesByKey = new Map(updates.map(update => [update.updateKey, update]));
      const explanations = await db.dynamicBillExplanations.toArray();
      const nextItemsByKey = new Map(nextItems.map(item => [item.billKey, item]));
      for (const explanation of explanations) {
        const item = nextItemsByKey.get(explanation.billKey);
        if (!item) {
          await db.dynamicBillExplanations
            .where('billKey')
            .equals(explanation.billKey)
            .delete();
          continue;
        }
        const { contentHash } = buildDynamicBillExplanationContent(
          item,
          updatesByKey.get(item.updateKey),
        );
        if (explanation.contentHash !== contentHash) {
          clearDynamicBillExplanationAttempt(item);
          await db.dynamicBillExplanations
            .where('billKey')
            .equals(explanation.billKey)
            .delete();
        }
      }
      if (nextItems.length > 0) {
        await db.dynamicBillItems.bulkPut(nextItems);
        storedItems.push(...nextItems);
        await db.dynamicBillRotationRecords.bulkPut(nextItems.map(item => ({
          id: rotationIdsByCreator.get(item.creatorMid),
          creatorMid: item.creatorMid,
          creatorName: item.creatorName,
          lastShownAt: generatedAt,
          lastBillKey: item.billKey,
          lastColumn: item.column,
          updatedAt: generatedAt,
        })));
      }
    },
  );

  return sortDynamicBillItems(storedItems);
}

export async function replaceDynamicBillItemsForColumn(
  column: DynamicBillColumn,
  items: DynamicBillItem[],
): Promise<DynamicBillItem[]> {
  await ensureDynamicBill013Migration();
  const existingOtherColumns = await db.dynamicBillItems
    .filter(item => item.column !== column)
    .toArray();
  return replaceAllDynamicBillItems([...existingOtherColumns, ...items]);
}

export async function getDynamicBillItems(options: {
  column?: DynamicBillColumn;
  status?: DynamicBillStatus;
} = {}): Promise<DynamicBillItem[]> {
  await ensureDynamicBill013Migration();
  await finalizeExpiredDynamicBillFeedbackActions();
  let items = options.column
    ? await db.dynamicBillItems.where('column').equals(options.column).toArray()
    : await db.dynamicBillItems.toArray();

  if (options.status) {
    items = items.filter(item => item.status === options.status);
  }

  const [explanations, updates] = await Promise.all([
    getDynamicBillExplanationMap(items.map(item => item.billKey)),
    items.length > 0
      ? db.followedVideoUpdates
        .where('updateKey')
        .anyOf(Array.from(new Set(items.map(item => item.updateKey))))
        .toArray()
      : Promise.resolve([]),
  ]);
  const updatesByKey = new Map(updates.map(update => [update.updateKey, update]));

  return sortDynamicBillItems(items.map(item => ({
    ...item,
    explanation: validExplanationForItem(
      item,
      explanations.get(item.billKey),
      updatesByKey.get(item.updateKey),
    ),
  })));
}

function validExplanationForItem(
  item: DynamicBillItem,
  explanation: DynamicBillExplanation | undefined,
  update: FollowedVideoUpdate | undefined,
): DynamicBillExplanation | undefined {
  if (!explanation) return undefined;
  const { contentHash } = buildDynamicBillExplanationContent(item, update);
  return explanation.contentHash === contentHash ? explanation : undefined;
}

export async function getDynamicBillExplanationMap(
  billKeys: string[],
): Promise<Map<string, DynamicBillExplanation>> {
  await ensureDynamicBill013Migration();
  const uniqueKeys = Array.from(new Set(billKeys.filter(Boolean)));
  if (uniqueKeys.length === 0) return new Map();

  const explanations = await db.dynamicBillExplanations
    .where('billKey')
    .anyOf(uniqueKeys)
    .toArray();
  return new Map(explanations.map(explanation => [explanation.billKey, explanation]));
}

export async function beginDynamicBillExplanationAttempt(
  billKey: string,
  contentHash: string,
  model: string,
): Promise<DynamicBillExplanationAttempt | null> {
  await ensureDynamicBill013Migration();
  return db.transaction(
    'rw',
    db.dynamicBillItems,
    db.followedVideoUpdates,
    db.dynamicBillExplanations,
    async () => {
      const item = await db.dynamicBillItems
        .where('billKey')
        .equals(billKey)
        .first();
      if (!item) return null;

      const update = await db.followedVideoUpdates
        .where('updateKey')
        .equals(item.updateKey)
        .first();
      const current = buildDynamicBillExplanationContent(item, update);
      if (current.contentHash !== contentHash) return null;

      const existing = await db.dynamicBillExplanations
        .where('billKey')
        .equals(billKey)
        .first();
      const generation = nextDynamicBillExplanationAttemptGeneration(
        item.explanationAttemptGeneration,
        existing?.attemptGeneration,
      );
      await db.dynamicBillItems.put({
        ...item,
        explanationAttemptGeneration: generation,
        explanationAttemptContentHash: contentHash,
        explanationAttemptModel: model,
      });
      return {
        billKey,
        contentHash,
        model,
        generation,
      };
    },
  );
}

export async function putDynamicBillExplanation(
  explanation: DynamicBillExplanation,
): Promise<DynamicBillExplanationWriteResult> {
  await ensureDynamicBill013Migration();
  return db.transaction(
    'rw',
    db.dynamicBillItems,
    db.followedVideoUpdates,
    db.dynamicBillExplanations,
    async () => {
      const item = await db.dynamicBillItems
        .where('billKey')
        .equals(explanation.billKey)
        .first();
      if (!item) return { status: 'discarded' };

      const update = await db.followedVideoUpdates
        .where('updateKey')
        .equals(item.updateKey)
        .first();
      const { contentHash } = buildDynamicBillExplanationContent(item, update);
      if (contentHash !== explanation.contentHash) {
        return { status: 'discarded' };
      }

      const existing = await db.dynamicBillExplanations
        .where('billKey')
        .equals(explanation.billKey)
        .first();
      const requestedGeneration = normalizeAttemptGeneration(explanation.attemptGeneration);
      let nextGeneration = requestedGeneration;
      if (requestedGeneration !== null) {
        if (
          item.explanationAttemptGeneration !== requestedGeneration
          || item.explanationAttemptContentHash !== explanation.contentHash
          || item.explanationAttemptModel !== explanation.model
        ) {
          return { status: 'discarded' };
        }
      } else {
        if (hasDynamicBillExplanationAttemptMetadata(item, existing)) {
          return { status: 'discarded' };
        }
        nextGeneration = nextDynamicBillExplanationAttemptGeneration(
          item.explanationAttemptGeneration,
          existing?.attemptGeneration,
        );
        await db.dynamicBillItems.put({
          ...item,
          explanationAttemptGeneration: nextGeneration,
          explanationAttemptContentHash: explanation.contentHash,
          explanationAttemptModel: explanation.model,
        });
      }
      const next: DynamicBillExplanation = {
        ...explanation,
        id: existing?.id,
        attemptGeneration: nextGeneration ?? undefined,
      };
      await db.dynamicBillExplanations.put(next);
      return { status: 'written', explanation: next };
    },
  );
}

export async function getDynamicBillFilterPreference(): Promise<DynamicBillFilterPreference> {
  await ensureDynamicBill013Migration();
  const result = await chrome.storage.local.get(DYNAMIC_BILL_FILTER_KEY);
  const stored = result[DYNAMIC_BILL_FILTER_KEY] as Partial<DynamicBillFilterPreference> | undefined;
  if (!stored || !isDynamicBillStatusFilter(stored.status)) {
    return DEFAULT_FILTER_PREFERENCE;
  }

  return {
    status: stored.status,
    updatedAt: normalizeTimestamp(stored.updatedAt),
  };
}

export async function setDynamicBillFilterPreference(
  status: DynamicBillStatusFilter,
): Promise<DynamicBillFilterPreference> {
  await ensureDynamicBill013Migration();
  const preference: DynamicBillFilterPreference = {
    status,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [DYNAMIC_BILL_FILTER_KEY]: preference });
  return preference;
}

export async function clearDynamicBillStoredState(): Promise<void> {
  await ensureDynamicBill013Migration();
  await chrome.storage.local.remove([
    DYNAMIC_SYNC_STATE_KEY,
    DYNAMIC_BILL_FILTER_KEY,
  ]);
}

export async function addDynamicBillFeedback(
  _billKey: string,
  _scope: DynamicBillFeedbackScope,
): Promise<never> {
  await ensureDynamicBill013Migration();
  // DB-013-B owns creation of new pause records; DB-013-A keeps this protocol path inert.
  throw new Error('当前版本不提供创建新的 UP 暂停记录。');
}

export async function getDynamicBillFeedbackProfile(): Promise<DynamicBillFeedbackProfile> {
  await ensureDynamicBill013Migration();
  const pauses = await getActiveDynamicBillCreatorPauses();
  return {
    pausedCreatorMids: new Set(pauses.map(pause => pause.creatorMid)),
    pausesByCreatorMid: new Map(pauses.map(pause => [pause.creatorMid, pause])),
  };
}

export async function markDynamicBillItemOpened(billKey: string, openedAt = Date.now()): Promise<DynamicBillItem | null> {
  await ensureDynamicBill013Migration();
  const item = await db.dynamicBillItems.where('billKey').equals(billKey).first();
  if (!item) return null;

  await advanceDynamicBillItemsByBvid(item.evidence.newVideo.bvid, 'opened', openedAt);
  return (await db.dynamicBillItems.where('billKey').equals(billKey).first()) ?? item;
}

export async function markDynamicBillItemProcessed(billKey: string, processedAt = Date.now()): Promise<DynamicBillItem | null> {
  await ensureDynamicBill013Migration();
  const item = await db.dynamicBillItems.where('billKey').equals(billKey).first();
  if (!item) return null;

  const patch = buildStatusPatch(item, 'processed', processedAt);
  if (!patch || item.id === undefined) return item;

  await db.dynamicBillItems.update(item.id, patch);
  return {
    ...item,
    ...patch,
  };
}

export async function markDynamicBillItemsConsumedByBvid(bvid: string, consumedAt = Date.now()): Promise<number> {
  await ensureDynamicBill013Migration();
  return advanceDynamicBillItemsByBvid(bvid, 'consumed', consumedAt);
}

export async function markDynamicBillItemsConsumedByHistoryRecords(
  records: WatchHistoryRecord[],
  consumedAt = Date.now(),
): Promise<number> {
  await ensureDynamicBill013Migration();
  const bvids = new Set(
    records
      .filter(isEffectiveHistoryRecord)
      .map(record => record.bvid)
      .filter(Boolean),
  );
  if (bvids.size === 0) return 0;

  let updated = 0;
  for (const bvid of bvids) {
    updated += await markDynamicBillItemsConsumedByBvid(bvid, consumedAt);
  }
  return updated;
}

export async function getDynamicBillOverview(windowDays = DYNAMIC_UPDATE_WINDOW_DAYS): Promise<DynamicBillOverview> {
  await ensureDynamicBill013Migration();
  const [syncState, creators, recentUpdates] = await Promise.all([
    getDynamicSyncState(),
    db.followedCreators.toArray(),
    getRecentFollowedVideoUpdates(windowDays),
  ]);
  const activeCreators = creators.filter(creator => creator.isActive !== false);
  const followAgeKnownCount = activeCreators.filter(creator => creator.followAgeKnown).length;
  const lastVideoDynamicTime = recentUpdates.reduce((latest, update) => Math.max(latest, update.dynamicTime), 0);

  return {
    syncState,
    followedCreatorCount: creators.length,
    activeFollowedCreatorCount: activeCreators.length,
    followAgeKnownCount,
    followAgeUnknownCount: activeCreators.length - followAgeKnownCount,
    recentVideoUpdateCount: recentUpdates.length,
    lastVideoDynamicTime,
    updateWindowDays: windowDays,
  };
}

export async function getDynamicSyncState(): Promise<DynamicSyncState> {
  await ensureDynamicBill013Migration();
  const result = await chrome.storage.local.get(DYNAMIC_SYNC_STATE_KEY);
  const state: DynamicSyncState = {
    ...DEFAULT_SYNC_STATE,
    ...(result[DYNAMIC_SYNC_STATE_KEY] ?? {}),
  };
  if (isStaleSyncState(state)) {
    const failedState: DynamicSyncState = {
      ...state,
      status: 'failed',
      lastFinishedAt: Date.now(),
      lastError: 'SYNC_STALE_TIMEOUT',
    };
    await setDynamicSyncState(failedState);
    return failedState;
  }
  return state;
}

export async function setDynamicSyncState(state: DynamicSyncState): Promise<void> {
  await ensureDynamicBill013Migration();
  await chrome.storage.local.set({ [DYNAMIC_SYNC_STATE_KEY]: state });
}

function isStaleSyncState(state: DynamicSyncState): boolean {
  return state.status === 'syncing'
    && state.lastStartedAt > 0
    && Date.now() - state.lastStartedAt > DYNAMIC_SYNC_STALE_TIMEOUT_MS;
}

async function finalizeDynamicBillFeedbackAction(
  actionKey: string,
  now: number,
): Promise<DynamicBillCreatorReviewPromptView | null> {
  return db.transaction(
    'rw',
    db.dynamicBillFeedbackActions,
    db.dynamicBillCreatorFeedbackCounts,
    db.dynamicBillCreatorReviewPrompts,
    async () => {
      const action = await db.dynamicBillFeedbackActions
        .where('actionKey')
        .equals(actionKey)
        .first();
      if (!action || action.state !== 'pending_undo' || action.undoDeadlineAt > now) {
        return null;
      }

      const existingCount = await db.dynamicBillCreatorFeedbackCounts
        .where('creatorMid')
        .equals(action.creatorMid)
        .first();
      const effectiveCount = (existingCount?.effectiveCount ?? 0) + 1;
      const existingPrompt = await db.dynamicBillCreatorReviewPrompts
        .where('creatorMid')
        .equals(action.creatorMid)
        .first();
      let promptView: DynamicBillCreatorReviewPromptView | null = null;

      if (effectiveCount >= CREATOR_LESS_REMINDER_REVIEW_THRESHOLD && !existingPrompt) {
        const prompt: DynamicBillCreatorReviewPromptRecord = {
          creatorMid: action.creatorMid,
          creatorName: action.creatorName,
          state: 'pending',
          effectiveCount,
          actionKey: action.actionKey,
          createdAt: now,
          updatedAt: now,
        };
        await db.dynamicBillCreatorReviewPrompts.add(prompt);
        promptView = toCreatorReviewPromptView(prompt);
      }

      await db.dynamicBillCreatorFeedbackCounts.put({
        id: existingCount?.id,
        creatorMid: action.creatorMid,
        creatorName: action.creatorName,
        effectiveCount,
        promptCreatedAt: existingCount?.promptCreatedAt ?? promptView?.createdAt,
        promptActionKey: existingCount?.promptActionKey ?? (promptView ? action.actionKey : undefined),
        createdAt: existingCount?.createdAt ?? now,
        updatedAt: now,
      });
      await db.dynamicBillFeedbackActions.put({
        ...action,
        state: 'finalized',
        effectiveCountAfterFinalize: effectiveCount,
        finalizedAt: now,
        updatedAt: now,
      });

      return promptView;
    },
  );
}

async function existingLessReminderResult(
  action: DynamicBillFeedbackActionRecord,
  item: DynamicBillItem | null,
  now: number,
): Promise<DynamicBillLessReminderResult | null> {
  if (!item) return null;
  if (action.state === 'pending_undo' && action.undoDeadlineAt > now) {
    return {
      status: 'already_pending',
      action: toPendingFeedbackActionView(action),
      item,
    };
  }

  const prompt = await db.dynamicBillCreatorReviewPrompts
    .where('creatorMid')
    .equals(action.creatorMid)
    .first();
  return {
    status: 'already_finalized',
    action: null,
    item,
    reviewPrompt: prompt?.state === 'pending'
      ? toCreatorReviewPromptView(prompt)
      : undefined,
  };
}

async function itemForAction(action: DynamicBillFeedbackActionRecord): Promise<DynamicBillItem | null> {
  return (await db.dynamicBillItems
    .where('billKey')
    .equals(action.billKey)
    .first()) ?? null;
}

function applyProcessedStateForLessReminder(
  item: DynamicBillItem,
  processedAt: number,
): DynamicBillItem {
  return {
    ...item,
    status: statusOrder(item.status) < statusOrder('processed') ? 'processed' : item.status,
    processedAt,
  };
}

function restoreItemBeforeFeedback(
  item: DynamicBillItem,
  action: DynamicBillFeedbackActionRecord,
): DynamicBillItem {
  const restored: DynamicBillItem = {
    ...item,
    status: action.previousStatus,
  };
  setOptionalTimestamp(restored, 'openedAt', action.previousOpenedAt);
  setOptionalTimestamp(restored, 'consumedAt', action.previousConsumedAt);
  setOptionalTimestamp(restored, 'processedAt', action.previousProcessedAt);
  return restored;
}

function setOptionalTimestamp(
  item: DynamicBillItem,
  key: 'openedAt' | 'consumedAt' | 'processedAt',
  value: number | undefined,
): void {
  if (value === undefined) {
    delete item[key];
    return;
  }
  item[key] = value;
}

function pauseMatchesAction(
  pause: DynamicBillCreatorPauseRecord | undefined,
  action: DynamicBillFeedbackActionRecord,
): boolean {
  return pause?.actionKey === action.actionKey
    && pause.expiresAt === action.pauseExpiresAt
    && pause.startedAt === action.pauseStartedAt
    && pause.source === 'user';
}

async function deleteCreatorPauseIfUnchanged(
  pause: DynamicBillCreatorPauseRecord,
): Promise<boolean> {
  if (pause.id === undefined) return false;
  const current = await db.dynamicBillCreatorPauses.get(pause.id);
  if (!current || !sameCreatorPauseIdentity(current, pause)) return false;
  await db.dynamicBillCreatorPauses.delete(pause.id);
  return true;
}

function sameCreatorPauseIdentity(
  current: DynamicBillCreatorPauseRecord,
  expected: DynamicBillCreatorPauseRecord,
): boolean {
  return current.id === expected.id
    && current.creatorMid === expected.creatorMid
    && current.startedAt === expected.startedAt
    && current.expiresAt === expected.expiresAt
    && current.source === expected.source
    && current.billKey === expected.billKey
    && current.actionKey === expected.actionKey;
}

function itemMatchesPendingAction(
  item: DynamicBillItem,
  action: DynamicBillFeedbackActionRecord,
): boolean {
  return item.status === 'processed'
    && item.processedAt === action.appliedProcessedAt;
}

function toPendingFeedbackActionView(
  action: DynamicBillFeedbackActionRecord,
): DynamicBillPendingFeedbackActionView {
  return {
    actionKey: action.actionKey,
    billKey: action.billKey,
    creatorMid: action.creatorMid,
    creatorName: action.creatorName,
    undoToken: action.undoToken,
    undoDeadlineAt: action.undoDeadlineAt,
    createdAt: action.createdAt,
  };
}

function toCreatorPauseView(
  pause: DynamicBillCreatorPauseRecord,
  now: number,
): DynamicBillCreatorPauseView {
  return {
    creatorMid: pause.creatorMid,
    creatorName: pause.creatorName,
    startedAt: pause.startedAt,
    expiresAt: pause.expiresAt,
    source: pause.source,
    remainingDays: Math.max(0, Math.ceil((pause.expiresAt - now) / DAY_MS)),
  };
}

function toCreatorReviewPromptView(
  prompt: DynamicBillCreatorReviewPromptRecord,
): DynamicBillCreatorReviewPromptView {
  return {
    creatorMid: prompt.creatorMid,
    creatorName: prompt.creatorName,
    effectiveCount: prompt.effectiveCount,
    createdAt: prompt.createdAt,
  };
}

function normalizeOperationTimestamp(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : Date.now();
}

function normalizeActionKey(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return `creator-less:${normalized.slice(0, 160)}`;
}

function makeActionKey(item: DynamicBillItem, now: number): string {
  return `creator-less:${item.billKey}:${item.creatorMid}:${now}:${randomToken()}`;
}

function makeUndoToken(actionKey: string): string {
  return `${actionKey}:undo:${randomToken()}`;
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint32Array(4);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('');
  }
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function creatorSpaceUrl(creatorMid: number): string {
  return `https://space.bilibili.com/${encodeURIComponent(String(creatorMid))}`;
}

function mergeExistingDynamicBillState(
  item: DynamicBillItem,
  existing?: DynamicBillItem,
): DynamicBillItem {
  if (!existing) return item;
  return {
    ...item,
    id: existing.id,
    status: existing.status,
    openedAt: existing.openedAt,
    consumedAt: existing.consumedAt,
    processedAt: existing.processedAt,
    explanationAttemptGeneration: existing.explanationAttemptGeneration,
    explanationAttemptContentHash: existing.explanationAttemptContentHash,
    explanationAttemptModel: existing.explanationAttemptModel,
  };
}

function clearDynamicBillExplanationAttempt(item: DynamicBillItem): void {
  delete item.explanationAttemptGeneration;
  delete item.explanationAttemptContentHash;
  delete item.explanationAttemptModel;
}

function nextDynamicBillExplanationAttemptGeneration(
  ...values: Array<number | undefined>
): number {
  return Math.max(0, ...values.map(value => normalizeAttemptGeneration(value) ?? 0)) + 1;
}

function hasDynamicBillExplanationAttemptMetadata(
  item: DynamicBillItem,
  existing?: DynamicBillExplanation,
): boolean {
  return normalizeAttemptGeneration(item.explanationAttemptGeneration) !== null
    || typeof item.explanationAttemptContentHash === 'string'
    || typeof item.explanationAttemptModel === 'string'
    || normalizeAttemptGeneration(existing?.attemptGeneration) !== null;
}

function normalizeAttemptGeneration(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

async function advanceDynamicBillItemsByBvid(
  bvid: string,
  status: DynamicBillStatus,
  timestamp: number,
): Promise<number> {
  if (!bvid) return 0;

  let updated = 0;
  await db.transaction('rw', db.dynamicBillItems, async () => {
    const items = await db.dynamicBillItems.toArray();
    const nextItems: DynamicBillItem[] = [];

    for (const item of items) {
      if (item.evidence.newVideo.bvid !== bvid) continue;
      const patch = buildStatusPatch(item, status, timestamp);
      if (!patch) continue;
      nextItems.push({ ...item, ...patch });
      updated++;
    }

    if (nextItems.length > 0) {
      await db.dynamicBillItems.bulkPut(nextItems);
    }
  });

  return updated;
}

function buildStatusPatch(
  item: DynamicBillItem,
  targetStatus: DynamicBillStatus,
  timestamp: number,
): Partial<DynamicBillItem> | null {
  if (statusOrder(item.status) > statusOrder(targetStatus)) return null;

  const patch: Partial<DynamicBillItem> = {};
  if (statusOrder(item.status) < statusOrder(targetStatus)) {
    patch.status = targetStatus;
  }

  if (targetStatus === 'opened' && !item.openedAt) {
    patch.openedAt = timestamp;
  }
  if (targetStatus === 'consumed' && !item.consumedAt) {
    patch.consumedAt = timestamp;
  }
  if (targetStatus === 'processed' && !item.processedAt) {
    patch.processedAt = timestamp;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function isEffectiveHistoryRecord(record: WatchHistoryRecord): boolean {
  return record.isFavorite
    || record.actualCompletion >= DYNAMIC_BILL_STRATEGY.positiveCompletionRate
    || record.progress >= DYNAMIC_BILL_STRATEGY.minPositiveWatchSeconds;
}

function sortDynamicBillItems(items: DynamicBillItem[]): DynamicBillItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return statusOrder(a.status) - statusOrder(b.status);
    const columnDelta = columnOrder(a.column) - columnOrder(b.column);
    if (columnDelta !== 0) return columnDelta;
    return a.localRank - b.localRank;
  });
}

function columnOrder(column: DynamicBillColumn): number {
  const index = DYNAMIC_BILL_COLUMNS.indexOf(column);
  return index >= 0 ? index : 99;
}

function isDynamicBillStatusFilter(status: unknown): status is DynamicBillStatusFilter {
  return status === 'active'
    || status === 'unopened'
    || status === 'opened'
    || status === 'consumed'
    || status === 'processed';
}

function normalizeTimestamp(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function statusOrder(status: DynamicBillStatus): number {
  switch (status) {
    case 'unopened':
      return 0;
    case 'opened':
      return 1;
    case 'consumed':
      return 2;
    case 'processed':
      return 3;
    default:
      return 4;
  }
}
