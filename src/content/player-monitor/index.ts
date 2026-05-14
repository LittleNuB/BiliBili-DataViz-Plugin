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

function isVideoPage(): boolean {
  return location.pathname.startsWith('/video/');
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
  const bvid = state?.bvid ?? state?.videoData?.bvid ?? '';
  const cid = state?.cid ?? state?.videoData?.cid ?? state?.videoData?.pages?.[0]?.cid ?? 0;
  const title = state?.videoData?.title ?? document.title.replace('_哔哩哔哩_bilibili', '').trim();
  const duration = state?.videoData?.duration ?? state?.videoData?.pages?.[0]?.duration ?? 0;
  const authorMid = state?.videoData?.owner?.mid ?? state?.upData?.mid ?? 0;
  const authorName = state?.videoData?.owner?.name ?? state?.upData?.name ?? '';

  return { bvid, cid, title, duration, authorMid, authorName };
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
  lastBvid = ctx.bvid;

  // Clean up previous listeners
  if (cleanup) {
    cleanup();
    cleanup = null;
  }

  try {
    const video = await detectVideo();
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
        // SW may be inactive — that's OK, message will be dropped
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
initializeMonitor();

// Handle B站 SPA navigation: monitor URL changes
let lastPath = location.pathname;
const navObserver = new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    lastBvid = '';
    initializeMonitor();
  }
});
navObserver.observe(document.body, { childList: true, subtree: true });

// Also check periodically as fallback
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    lastBvid = '';
    initializeMonitor();
  }
}, 2000);

console.log('[BiliViz] Player monitor loaded');
