import type {
  LocalDataCategoryReadback,
  LocalDataCategoryUsage,
} from '../../shared/local-data-category-contract.ts';

export const BLIND_BOX_DRAW_HISTORY_STORAGE_KEY = 'blindBoxRecentDrawnBvids';
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
    const next = mergeBlindBoxDrawHistory(current, drawnBvids);
    await storage.set({ [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: next });
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
    if (generationEpoch !== drawHistoryEpoch) {
      return result.value;
    }

    const drawnBvids = normalizeBlindBoxDrawHistory(result.drawnBvids);
    if (drawnBvids.length > 0) {
      const next = mergeBlindBoxDrawHistory(current, drawnBvids);
      await storage.set({ [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: next });
    }
    return result.value;
  });
}

export async function coordinateBlindBoxDrawHistoryClear<T>(
  clear: (recentDrawnBvids: readonly string[]) => Promise<T>,
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'> = chrome.storage.local,
): Promise<T> {
  return enqueueMutation(async () => {
    drawHistoryEpoch += 1;
    const current = await readBlindBoxRecentDrawnBvids(storage);
    return clear(current);
  });
}

export async function collectBlindBoxDrawHistoryUsage(
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'>,
): Promise<LocalDataCategoryUsage> {
  const bvids = await getBlindBoxRecentDrawnBvids(storage);
  return {
    count: bvids.length,
    usageBytes: bvids.length > 0 ? serializedSize({ [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: bvids }) : 0,
  };
}

export async function clearBlindBoxDrawHistory(
  storage: BlindBoxDrawHistoryReadStorage,
): Promise<number> {
  return coordinateBlindBoxDrawHistoryClear(async before => {
    await storage.remove([BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]);
    return before.length;
  }, storage);
}

export async function readBlindBoxDrawHistoryAfterClear(
  storage: Pick<BlindBoxDrawHistoryStorage, 'get'>,
): Promise<LocalDataCategoryReadback> {
  const usage = await collectBlindBoxDrawHistoryUsage(storage);
  return {
    ...usage,
    empty: usage.count === 0,
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
