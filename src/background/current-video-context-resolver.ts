import type { CurrentVideoContextResult } from '../shared/types/current-video-context';

export interface CurrentVideoTabSnapshot {
  id: number;
  url: string | null;
  active: boolean;
  lastAccessed: number | null;
}

export interface ResolvedCurrentVideoTabState {
  tab: CurrentVideoTabSnapshot | null;
  context: CurrentVideoContextResult | null;
}

export const CURRENT_VIDEO_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

export function resolveCurrentVideoTabState(
  tabs: CurrentVideoTabSnapshot[],
  contexts: ReadonlyMap<number, CurrentVideoContextResult>,
  now = Date.now(),
): ResolvedCurrentVideoTabState {
  const orderedTabs = [...tabs].sort(compareTabsByRecency);
  const activeTabs = orderedTabs.filter(tab => tab.active);
  const primaryTab = activeTabs[0] ?? orderedTabs[0] ?? null;

  if (primaryTab?.url) {
    return {
      tab: primaryTab,
      context: resolveFreshMatchingVideoContext(primaryTab, contexts, now),
    };
  }

  const fallback = orderedTabs.find(tab => resolveFreshMatchingVideoContext(tab, contexts, now));
  if (!fallback) {
    return { tab: primaryTab, context: null };
  }

  return {
    tab: fallback,
    context: resolveFreshMatchingVideoContext(fallback, contexts, now),
  };
}

export function resolveFreshMatchingVideoContext(
  tab: CurrentVideoTabSnapshot,
  contexts: ReadonlyMap<number, CurrentVideoContextResult>,
  now = Date.now(),
): CurrentVideoContextResult | null {
  if (tab.id <= 0 || !tab.url || !isBilibiliVideoUrl(tab.url)) return null;

  const context = contexts.get(tab.id);
  if (!context || context.kind !== 'video') return null;
  if (extractBvidFromUrl(tab.url) !== context.bvid) return null;
  if (extractPageFromUrl(tab.url) !== context.currentPart.page) return null;
  if (now - context.collectedAt > CURRENT_VIDEO_CONTEXT_MAX_AGE_MS) return null;

  return context;
}

export function isBilibiliVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('bilibili.com') && parsed.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

export function extractBvidFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function extractPageFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('p') ?? '1');
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  } catch {
    return 1;
  }
}

function compareTabsByRecency(a: CurrentVideoTabSnapshot, b: CurrentVideoTabSnapshot): number {
  const lastAccessedDiff = normalizeLastAccessed(b.lastAccessed) - normalizeLastAccessed(a.lastAccessed);
  if (lastAccessedDiff !== 0) return lastAccessedDiff;
  if (a.active !== b.active) return Number(b.active) - Number(a.active);
  return b.id - a.id;
}

function normalizeLastAccessed(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : -1;
}
