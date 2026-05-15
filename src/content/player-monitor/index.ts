import { detectVideo } from './video-detector';
import { attachEventListeners, type VideoContext } from './event-capture';
import { startHeartbeat } from './heartbeat';

interface BiliInitialState {
  bvid?: string;
  cid?: number;
  videoData?: {
    bvid?: string;
    cid?: number;
    title?: string;
    duration?: number;
    owner?: { mid?: number; name?: string };
    pages?: Array<{ cid?: number; duration?: number }>;
  };
  upData?: { mid?: number; name?: string };
}

let cleanup: (() => void) | null = null;
let lastBvid = '';
let retryTimer: number | null = null;

function isVideoPage(): boolean {
  return location.pathname.startsWith('/video/');
}

function extractBvidFromUrl(): string {
  const match = location.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/);
  return match?.[1] ?? '';
}

function getInitialState(): BiliInitialState | null {
  try {
    return (window as any).__INITIAL_STATE__ ?? null;
  } catch {
    return null;
  }
}

function getVideoContext() {
  const state = getInitialState();
  const urlBvid = extractBvidFromUrl();
  const stateBvid = state?.bvid ?? state?.videoData?.bvid ?? '';
  const bvid = urlBvid || stateBvid;
  const canTrustState = !urlBvid || !stateBvid || stateBvid === urlBvid;
  const cid = canTrustState ? state?.cid ?? state?.videoData?.cid ?? state?.videoData?.pages?.[0]?.cid ?? 0 : 0;
  const title = canTrustState && state?.videoData?.title
    ? state.videoData.title
    : document.title.replace('_哔哩哔哩_bilibili', '').trim();
  const duration = canTrustState ? state?.videoData?.duration ?? state?.videoData?.pages?.[0]?.duration ?? 0 : 0;
  const authorMid = canTrustState ? state?.videoData?.owner?.mid ?? state?.upData?.mid ?? 0 : 0;
  const authorName = canTrustState ? state?.videoData?.owner?.name ?? state?.upData?.name ?? '' : '';

  return { bvid, cid, title, duration, authorMid, authorName };
}

function scheduleInitialize(delay = 0): void {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }

  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    initializeMonitor();
  }, delay);
}

async function initializeMonitor(): Promise<void> {
  if (!isVideoPage()) return;

  const ctx = getVideoContext();
  if (!ctx.bvid) {
    console.warn('[BiliViz] No BVID found on video page');
    return;
  }

  // Skip re-initialization for the same video
  if (ctx.bvid === lastBvid) return;

  // Clean up previous listeners
  if (cleanup) {
    cleanup();
    cleanup = null;
  }

  try {
    const video = await detectVideo();
    lastBvid = ctx.bvid;
    console.log(`[BiliViz] Monitoring: ${ctx.title} (${ctx.bvid})`);

    const videoCtx: VideoContext = {
      bvid: ctx.bvid,
      cid: ctx.cid,
      title: ctx.title,
      duration: ctx.duration,
      authorMid: ctx.authorMid,
      authorName: ctx.authorName,
    };

    const removeEvents = attachEventListeners(video, videoCtx, (msg) => {
      chrome.runtime.sendMessage(msg).catch(() => {
        // SW may be inactive; the next heartbeat/action can wake it again.
      });
    });

    const removeHeartbeat = startHeartbeat(video, videoCtx, (msg) => {
      chrome.runtime.sendMessage(msg).catch(() => {});
    });

    cleanup = () => {
      removeEvents();
      removeHeartbeat();
    };
  } catch (e) {
    console.error('[BiliViz] Failed to initialize player monitor:', e);
  }
}

// Initial run
scheduleInitialize();

// Handle B站 SPA navigation: monitor URL changes
let lastUrl = location.href;
const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastBvid = '';
    scheduleInitialize(800);
    window.setTimeout(() => scheduleInitialize(2500), 2500);
  }
});
navObserver.observe(document.body, { childList: true, subtree: true });

// Also check periodically as fallback
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastBvid = '';
    scheduleInitialize(800);
    window.setTimeout(() => scheduleInitialize(2500), 2500);
  }
}, 2000);

console.log('[BiliViz] Player monitor loaded');
