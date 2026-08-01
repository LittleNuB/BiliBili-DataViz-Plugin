import { buildSidebarCard } from './renderer';
import { findSidebarAnchor, placeSidebarCard, SIDEBAR_CARD_ID } from './placement';

const INITIAL_DELAY_MS = 2_000;
const REINJECTION_DELAY_MS = 500;
const ANCHOR_TIMEOUT_MS = 10_000;
const ANCHOR_POLL_INTERVAL_MS = 250;

let initializationTimer: ReturnType<typeof setTimeout> | null = null;
let initializationInFlight: Promise<void> | null = null;
let injectedCard: HTMLElement | null = null;
let cachedQuickStats: Parameters<typeof buildSidebarCard>[0] | null = null;
let retryAfterInitialization = false;
let navigationGeneration = 0;

function isHomePage(): boolean {
  return location.pathname === '/' || location.pathname === '/index.html';
}

function waitForSidebarAnchor(
  timeout = ANCHOR_TIMEOUT_MS,
  interval = ANCHOR_POLL_INTERVAL_MS,
): Promise<ReturnType<typeof findSidebarAnchor>> {
  const existing = findSidebarAnchor();
  if (existing) return Promise.resolve(existing);

  return new Promise(resolve => {
    const start = Date.now();
    const timer = setInterval(() => {
      const anchor = findSidebarAnchor();
      if (anchor) {
        clearInterval(timer);
        resolve(anchor);
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        resolve(null);
      }
    }, interval);
  });
}

async function initializeSidebar(): Promise<void> {
  if (!isHomePage()) return;
  const generation = navigationGeneration;

  try {
    const existingCard = document.getElementById(SIDEBAR_CARD_ID);
    if (existingCard instanceof HTMLElement) {
      injectedCard = existingCard;
      return;
    }

    const anchor = await waitForSidebarAnchor();
    if (generation !== navigationGeneration || !anchor || !isHomePage()) return;
    if (!document.contains(anchor.container)) {
      retryAfterInitialization = true;
      return;
    }

    if (!cachedQuickStats) {
      const response = await chrome.runtime.sendMessage({ action: 'GET_QUICK_STATS' });
      if (!response || !response.success || !response.data) {
        console.warn('[BiliViz] Failed to get quick stats for sidebar');
        return;
      }
      if (generation !== navigationGeneration || !isHomePage()) return;
      cachedQuickStats = response.data;
    }

    if (generation !== navigationGeneration || !isHomePage()) return;
    if (!document.contains(anchor.container)) {
      retryAfterInitialization = true;
      return;
    }

    const quickStats = cachedQuickStats;
    if (!quickStats) return;
    const card = buildSidebarCard(quickStats);
    if (placeSidebarCard(document, anchor, card)) {
      injectedCard = card;
      console.log('[BiliViz] Sidebar card injected');
    }
  } catch {
    console.warn('[BiliViz] Sidebar card unavailable');
  }
}

function scheduleInitialization(delay: number): void {
  if (!isHomePage() || initializationTimer || initializationInFlight) return;
  initializationTimer = setTimeout(() => {
    initializationTimer = null;
    initializationInFlight = initializeSidebar().finally(() => {
      initializationInFlight = null;
      if (retryAfterInitialization) {
        retryAfterInitialization = false;
        scheduleInitialization(REINJECTION_DELAY_MS);
      }
    });
  }, delay);
}

scheduleInitialization(INITIAL_DELAY_MS);

// Also listen for B站 SPA navigation back to homepage
let lastPath = location.pathname;
const navObserver = new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    navigationGeneration += 1;
    cachedQuickStats = null;
    retryAfterInitialization = false;
    if (injectedCard && document.contains(injectedCard)) {
      injectedCard.remove();
    }
    injectedCard = null;
    if (isHomePage()) {
      if (initializationInFlight) {
        retryAfterInitialization = true;
      } else {
        scheduleInitialization(INITIAL_DELAY_MS);
      }
    }
    return;
  }

  if (isHomePage() && injectedCard && !document.contains(injectedCard)) {
    injectedCard = null;
    if (initializationInFlight) {
      retryAfterInitialization = true;
    } else {
      scheduleInitialization(REINJECTION_DELAY_MS);
    }
  }
});
navObserver.observe(document.body, { childList: true, subtree: true });

console.log('[BiliViz] Sidebar card loaded');
