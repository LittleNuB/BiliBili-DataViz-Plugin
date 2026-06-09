import { renderCurrentVideoAssistant } from './assistant-status';
import { collectCurrentVideoContext, isVideoPage, withVideoElementDuration } from './current-video-context';
import { attachEventListeners, type VideoContext } from './event-capture';
import { startHeartbeat } from './heartbeat';
import { detectVideo } from './video-detector';
import type { BiliVizContentMessage } from '../../shared/types/messages';
import type { CurrentVideoContextResult } from '../../shared/types/current-video-context';

let cleanup: (() => void) | null = null;
let lastContextKey = '';
let retryTimer: number | null = null;

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
  const context = collectCurrentVideoContext();
  renderCurrentVideoAssistant(context);
  sendCurrentVideoContext(context);

  if (!isVideoPage()) {
    cleanupMonitor();
    lastContextKey = '';
    return;
  }

  if (context.kind !== 'video') {
    console.warn('[BiliViz] No BVID found on video page');
    return;
  }

  const contextKey = `${context.bvid}:${context.cid || `p${context.currentPart.page}`}`;
  if (contextKey === lastContextKey) return;

  cleanupMonitor();

  try {
    const video = await detectVideo();
    const contextWithDuration = withVideoElementDuration(context, video);
    renderCurrentVideoAssistant(contextWithDuration);
    sendCurrentVideoContext(contextWithDuration);
    lastContextKey = contextKey;
    console.log(
      `[BiliViz] Monitoring: ${contextWithDuration.title} (${contextWithDuration.bvid}, cid=${contextWithDuration.cid || 'unknown'}, p=${contextWithDuration.currentPart.page})`,
    );

    const videoCtx: VideoContext = {
      bvid: contextWithDuration.bvid,
      cid: contextWithDuration.cid ?? 0,
      title: contextWithDuration.title ?? '',
      duration: contextWithDuration.durationSeconds ?? 0,
      authorMid: contextWithDuration.authorMid ?? 0,
      authorName: contextWithDuration.authorName ?? '',
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

function cleanupMonitor(): void {
  if (!cleanup) return;
  cleanup();
  cleanup = null;
}

function sendCurrentVideoContext(context: CurrentVideoContextResult): void {
  const message: BiliVizContentMessage = {
    action: 'CURRENT_VIDEO_CONTEXT_UPDATE',
    payload: context,
  };

  chrome.runtime.sendMessage(message).catch(() => {
    // SW may be inactive; the next page update or player event will retry.
  });
}

scheduleInitialize();

let lastUrl = location.href;
const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastContextKey = '';
    scheduleInitialize(800);
    window.setTimeout(() => scheduleInitialize(2500), 2500);
  }
});
navObserver.observe(document.body, { childList: true, subtree: true });

setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastContextKey = '';
    scheduleInitialize(800);
    window.setTimeout(() => scheduleInitialize(2500), 2500);
  }
}, 2000);

console.log('[BiliViz] Player monitor loaded');
