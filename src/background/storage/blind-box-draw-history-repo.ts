import type {
  LocalDataCategoryReadback,
  LocalDataCategoryRegistration,
  LocalDataCategoryUsage,
} from '../../shared/local-data-category-contract.ts';

export const BLIND_BOX_DRAW_HISTORY_STORAGE_KEY = 'blindBoxRecentDrawnBvids';
export const BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY = 'blindBoxRecentDrawnAt';
export const BLIND_BOX_DRAW_HISTORY_LIMIT = 50;

export interface BlindBoxDrawHistoryStorage {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
}

export type BlindBoxDrawHistoryReadStorage = Pick<BlindBoxDrawHistoryStorage, 'get' | 'remove'>;

interface BlindBoxDrawHistoryClaim<T> {
  value: T;
  drawnBvids: string[];
}

let mutationTail: Promise<void> = Promise.resolve();
let drawHistoryEpoch = 0;
let drawHistoryClearingDepth = 0;

export function getBlindBoxDrawHistoryEpoch(): number {
  return drawHistoryEpoch;
}

export async function getBlindBoxRecentDrawnBvids(
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'> = chrome.storage.local,
): Promise<string[]> {
  await mutationTail;
  return readBlindBoxRecentDrawnBvids(storage);
}

export async function recordBlindBoxDrawnBvids(
  drawnBvids: string[],
  storage: BlindBoxDrawHistoryStorage = chrome.storage.local,
): Promise<string[]> {
  return enqueueMutation(async () => {
    const current = await readBlindBoxRecentDrawnBvids(storage);
    if (drawHistoryClearingDepth > 0) return current;
    const next = mergeBlindBoxDrawHistory(current, drawnBvids);
    await storage.set({
      [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: next,
      [BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY]: Date.now(),
    });
    return next;
  });
}

export async function claimBlindBoxDrawHistory<T>(
  generationEpoch: number,
  claim: (recentDrawnBvids: string[]) => BlindBoxDrawHistoryClaim<T> | Promise<BlindBoxDrawHistoryClaim<T>>,
  storage: BlindBoxDrawHistoryStorage = chrome.storage.local,
): Promise<T> {
  return enqueueMutation(async () => {
    const current = await readBlindBoxRecentDrawnBvids(storage);
    const result = await claim(current);
    if (generationEpoch !== drawHistoryEpoch || drawHistoryClearingDepth > 0) {
      return result.value;
    }

    const drawnBvids = normalizeBlindBoxDrawHistory(result.drawnBvids);
    if (drawnBvids.length > 0) {
      const next = mergeBlindBoxDrawHistory(current, drawnBvids);
      await storage.set({
        [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: next,
        [BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY]: Date.now(),
      });
    }
    return result.value;
  });
}

export async function coordinateBlindBoxDrawHistoryClear<T>(
  clear: (recentDrawnBvids: readonly string[]) => Promise<T>,
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'> = chrome.storage.local,
): Promise<T> {
  return enqueueMutation(async () => {
    const endClearWindow = beginBlindBoxDrawHistoryClearWindow();
    try {
      const current = await readBlindBoxRecentDrawnBvids(storage);
      return await clear(current);
    } finally {
      endClearWindow();
    }
  });
}

export function beginBlindBoxDrawHistoryClearWindow(): () => void {
  let ended = false;
  drawHistoryEpoch += 1;
  drawHistoryClearingDepth += 1;
  return () => {
    if (ended) return;
    ended = true;
    drawHistoryClearingDepth = Math.max(0, drawHistoryClearingDepth - 1);
    if (drawHistoryClearingDepth === 0) drawHistoryEpoch += 1;
  };
}

export async function collectBlindBoxDrawHistoryUsage(
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'>,
): Promise<LocalDataCategoryUsage> {
  await mutationTail;
  const stored = await storage.get([
    BLIND_BOX_DRAW_HISTORY_STORAGE_KEY,
    BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY,
  ]);
  const bvids = normalizeBlindBoxDrawHistory(stored[BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]);
  const present = Object.fromEntries(
    Object.entries(stored).filter(([, value]) => value !== undefined),
  );
  return {
    count: bvids.length,
    usageBytes: Object.keys(present).length > 0 ? serializedSize(present) : 0,
  };
}

export async function clearBlindBoxDrawHistory(
  storage: BlindBoxDrawHistoryReadStorage,
): Promise<number> {
  return coordinateBlindBoxDrawHistoryClear(async before => {
    await storage.remove([
      BLIND_BOX_DRAW_HISTORY_STORAGE_KEY,
      BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY,
    ]);
    return before.length;
  }, storage);
}

export async function getBlindBoxDrawHistoryUpdatedAt(
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'> = chrome.storage.local,
): Promise<number | null> {
  await mutationTail;
  const stored = await storage.get([BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY]);
  const value = stored[BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export async function readBlindBoxDrawHistoryAfterClear(
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'>,
): Promise<LocalDataCategoryReadback> {
  const usage = await collectBlindBoxDrawHistoryUsage(storage);
  return {
    ...usage,
    empty: usage.count === 0 && usage.usageBytes === 0,
  };
}

export function getBlindBoxDrawHistoryLocalDataCategoryRegistration(
  storage?: BlindBoxDrawHistoryStorage,
): LocalDataCategoryRegistration {
  const resolveStorage = () => storage ?? chrome.storage.local;
  return {
    id: 'blindBoxDrawHistory',
    label: '盲盒抽取记录',
    includeInClearAll: true,
    collectUsage: () => collectBlindBoxDrawHistoryUsage(resolveStorage()),
    clear: async () => ({
      cleared: {
        blindBoxDrawHistory: await clearBlindBoxDrawHistory(resolveStorage()),
      },
    }),
    readAfterClear: () => readBlindBoxDrawHistoryAfterClear(resolveStorage()),
  };
}

export function mergeBlindBoxDrawHistory(existing: unknown, drawnBvids: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const bvid of [
    ...normalizeBlindBoxDrawHistory(drawnBvids),
    ...normalizeBlindBoxDrawHistory(existing),
  ]) {
    if (seen.has(bvid)) continue;
    seen.add(bvid);
    result.push(bvid);
    if (result.length >= BLIND_BOX_DRAW_HISTORY_LIMIT) break;
  }

  return result;
}

export function normalizeBlindBoxDrawHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    const bvid = typeof raw === 'string' ? raw.trim() : '';
    if (!isLikelyBvid(bvid) || seen.has(bvid)) continue;
    seen.add(bvid);
    result.push(bvid);
    if (result.length >= BLIND_BOX_DRAW_HISTORY_LIMIT) break;
  }

  return result;
}

async function readBlindBoxRecentDrawnBvids(
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'>,
): Promise<string[]> {
  const stored = await storage.get([BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]);
  return normalizeBlindBoxDrawHistory(stored[BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]);
}

function enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(mutation);
  mutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isLikelyBvid(value: string): boolean {
  return /^BV[0-9A-Za-z]{8,}$/.test(value);
}

function serializedSize(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
}
