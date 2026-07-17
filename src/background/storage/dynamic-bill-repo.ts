import { DYNAMIC_UPDATE_WINDOW_DAYS } from '../../shared/constants';
import type {
  DynamicBillColumn,
  DynamicBillCreatorPauseRecord,
  DynamicBillExplanation,
  DynamicBillFeedbackRecord,
  DynamicBillFeedbackResult,
  DynamicBillFeedbackScope,
  DynamicBillFeedbackSummary,
  DynamicBillFeedbackThresholds,
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
import { ensureDynamicBill013Migration } from '../dynamic-bill/migration';
import { DYNAMIC_BILL_COLUMNS, DYNAMIC_BILL_STRATEGY } from '../dynamic-bill/strategy';
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
  return updates.sort((a, b) => b.dynamicTime - a.dynamicTime);
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

  await db.transaction('rw', db.dynamicBillItems, db.dynamicBillRotationRecords, async () => {
    const existing = await db.dynamicBillItems.toArray();
    const existingByKey = new Map(existing.map(item => [item.billKey, item]));
    const existingRotations = await db.dynamicBillRotationRecords.toArray();
    const rotationIdsByCreator = new Map(existingRotations.map(record => [record.creatorMid, record.id]));

    await db.dynamicBillItems.clear();
    const nextItems = items.map(item => mergeExistingDynamicBillState(item, existingByKey.get(item.billKey)));
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
  });

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

  const explanations = await getDynamicBillExplanationMap(items.map(item => item.billKey));

  return sortDynamicBillItems(items.map(item => ({
    ...item,
    explanation: explanations.get(item.billKey),
  })));
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

export async function putDynamicBillExplanation(
  explanation: DynamicBillExplanation,
): Promise<DynamicBillExplanation> {
  await ensureDynamicBill013Migration();
  const existing = await db.dynamicBillExplanations
    .where('billKey')
    .equals(explanation.billKey)
    .first();
  const next: DynamicBillExplanation = {
    ...explanation,
    id: existing?.id,
  };
  await db.dynamicBillExplanations.put(next);
  return next;
}

export async function getDynamicBillFilterPreference(): Promise<DynamicBillFilterPreference> {
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
  const preference: DynamicBillFilterPreference = {
    status,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [DYNAMIC_BILL_FILTER_KEY]: preference });
  return preference;
}

export async function addDynamicBillFeedback(
  billKey: string,
  scope: DynamicBillFeedbackScope,
  createdAt = Date.now(),
): Promise<DynamicBillFeedbackResult> {
  await ensureDynamicBill013Migration();
  if (scope !== 'creator') throw new Error('0.13 只支持“少提醒这个 UP”。');

  let result: DynamicBillFeedbackResult | null = null;
  await db.transaction('rw', db.dynamicBillItems, db.dynamicBillCreatorPauses, async () => {
    const item = await db.dynamicBillItems.where('billKey').equals(billKey).first();
    if (!item) throw new Error('DYNAMIC_BILL_ITEM_NOT_FOUND');

    const pause = await upsertCreatorPauseInCurrentTransaction(item, createdAt);
    const patch = buildStatusPatch(item, 'processed', createdAt) ?? {};
    const nextItem = { ...item, ...patch };
    if (item.id !== undefined && Object.keys(patch).length > 0) {
      await db.dynamicBillItems.update(item.id, patch);
    }

    const feedback = buildDynamicBillFeedbackRecord(item, createdAt);
    result = {
      feedback,
      summary: buildDynamicBillFeedbackSummary(feedback, pause),
      item: nextItem,
    };
  });

  if (!result) throw new Error('DYNAMIC_BILL_ITEM_NOT_FOUND');
  return result;
}

export async function getDynamicBillFeedbackProfile(): Promise<DynamicBillFeedbackProfile> {
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
  };
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

async function upsertCreatorPauseInCurrentTransaction(
  item: DynamicBillItem,
  startedAt: number,
): Promise<DynamicBillCreatorPauseRecord> {
  const expiresAt = startedAt + DYNAMIC_BILL_STRATEGY.lessRemindPauseDays * 86_400_000;
  const existing = await db.dynamicBillCreatorPauses
    .where('creatorMid')
    .equals(item.creatorMid)
    .first();
  const next: DynamicBillCreatorPauseRecord = {
    id: existing?.id,
    creatorMid: item.creatorMid,
    creatorName: item.creatorName,
    startedAt,
    expiresAt: Math.max(expiresAt, existing?.expiresAt ?? 0),
    source: 'less_remind',
    billKey: item.billKey,
    createdAt: existing?.createdAt ?? startedAt,
    updatedAt: startedAt,
  };
  await db.dynamicBillCreatorPauses.put(next);
  return next;
}

function buildDynamicBillFeedbackRecord(
  item: DynamicBillItem,
  createdAt: number,
): DynamicBillFeedbackRecord {
  return {
    scope: 'creator',
    key: String(item.creatorMid),
    label: item.creatorName || String(item.creatorMid),
    billKey: item.billKey,
    column: item.column,
    creatorMid: item.creatorMid,
    creatorName: item.creatorName,
    createdAt,
  };
}

function buildDynamicBillFeedbackSummary(
  feedback: DynamicBillFeedbackRecord,
  pause: DynamicBillCreatorPauseRecord,
): DynamicBillFeedbackSummary {
  return {
    scope: 'creator',
    key: feedback.key,
    label: feedback.label,
    count: 1,
    isDampened: true,
    isBlocked: true,
    shouldShowCreatorReviewPrompt: false,
    pauseStartedAt: pause.startedAt,
    pauseExpiresAt: pause.expiresAt,
    thresholds: getDynamicBillFeedbackThresholds(),
  };
}

function getDynamicBillFeedbackThresholds(): DynamicBillFeedbackThresholds {
  return {
    pauseDays: DYNAMIC_BILL_STRATEGY.lessRemindPauseDays,
    creatorReviewPromptCount: 3,
  };
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
