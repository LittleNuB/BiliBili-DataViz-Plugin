import { DYNAMIC_UPDATE_WINDOW_DAYS } from '../../shared/constants';
import type {
  DynamicBillColumn,
  DynamicBillCreatorPauseRecord,
  DynamicBillExplanation,
  DynamicBillFeedbackScope,
  DynamicBillFilterPreference,
  DynamicBillItem,
  DynamicBillOverview,
  DynamicBillRotationRecord,
  DynamicBillStatus,
  DynamicBillStatusFilter,
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
  await db.dynamicBillCreatorPauses.where('expiresAt').belowOrEqual(now).delete();
  return db.dynamicBillCreatorPauses.where('expiresAt').above(now).toArray();
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
