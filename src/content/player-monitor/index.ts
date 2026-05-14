import { detectVideo } from './video-detector';
import { attachEventListeners, type VideoContext } from './event-capture';
import { startHeartbeat } from './heartbeat';
import { getVideoContext } from '../utils/dom-utils';
import { isVideoPage } from '../utils/page-detector';

let cleanup: (() => void) | null = null;
let lastBvid = '';

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
