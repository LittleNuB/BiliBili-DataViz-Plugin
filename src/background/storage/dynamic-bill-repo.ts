import { DYNAMIC_UPDATE_WINDOW_DAYS } from '../../shared/constants';
import type {
  DynamicBillColumn,
  DynamicBillItem,
  DynamicBillOverview,
  DynamicBillStatus,
  DynamicSyncState,
  FollowedCreator,
  FollowedVideoUpdate,
} from '../../shared/types/dynamic-bill';
import { db } from './db';

const DYNAMIC_SYNC_STATE_KEY = 'dynamicBillSyncState';
const DYNAMIC_SYNC_STALE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SYNC_STATE: DynamicSyncState = {
  status: 'idle',
  stage: 'idle',
  lastStartedAt: 0,
  lastFinishedAt: 0,
  lastSuccessAt: 0,
};

export async function replaceFollowedCreatorSnapshot(creators: FollowedCreator[], syncedAt: number): Promise<number> {
  const activeMids = new Set(creators.map(creator => creator.mid));

  await db.transaction('rw', db.followedCreators, async () => {
    const existing = await db.followedCreators.toArray();
    const existingByMid = new Map(existing.map(creator => [creator.mid, creator]));
    const nextCreators = creators.map(creator => ({
      ...creator,
      id: existingByMid.get(creator.mid)?.id,
      isActive: true,
      syncedAt,
      lastSeenAt: syncedAt,
    }));

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
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(1, Math.floor(days)) * 86_400;
  return db.followedVideoUpdates.where('dynamicTime').below(cutoff).delete();
}

export async function getRecentFollowedVideoUpdates(windowDays = DYNAMIC_UPDATE_WINDOW_DAYS): Promise<FollowedVideoUpdate[]> {
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(1, Math.floor(windowDays)) * 86_400;
  return db.followedVideoUpdates
    .where('dynamicTime')
    .aboveOrEqual(cutoff)
    .reverse()
    .sortBy('dynamicTime');
}

export async function getActiveFollowedCreators(): Promise<FollowedCreator[]> {
  const creators = await db.followedCreators.toArray();
  return creators.filter(creator => creator.isActive !== false);
}

export async function replaceDynamicBillItemsForColumn(
  column: DynamicBillColumn,
  items: DynamicBillItem[],
): Promise<DynamicBillItem[]> {
  const storedItems: DynamicBillItem[] = [];

  await db.transaction('rw', db.dynamicBillItems, async () => {
    const existing = await db.dynamicBillItems.where('column').equals(column).toArray();
    const existingByKey = new Map(existing.map(item => [item.billKey, item]));
    await db.dynamicBillItems.where('column').equals(column).delete();

    const nextItems = items.map(item => mergeExistingDynamicBillState(item, existingByKey.get(item.billKey)));
    if (nextItems.length > 0) {
      await db.dynamicBillItems.bulkPut(nextItems);
      storedItems.push(...nextItems);
    }
  });

  return storedItems.sort((a, b) => a.localRank - b.localRank);
}

export async function getDynamicBillItems(options: {
  column?: DynamicBillColumn;
  status?: DynamicBillStatus;
} = {}): Promise<DynamicBillItem[]> {
  let items = options.column
    ? await db.dynamicBillItems.where('column').equals(options.column).toArray()
    : await db.dynamicBillItems.toArray();

  if (options.status) {
    items = items.filter(item => item.status === options.status);
  }

  return items.sort((a, b) => {
    if (a.status !== b.status) return statusOrder(a.status) - statusOrder(b.status);
    return a.localRank - b.localRank;
  });
}

export async function getDynamicBillOverview(windowDays = DYNAMIC_UPDATE_WINDOW_DAYS): Promise<DynamicBillOverview> {
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
