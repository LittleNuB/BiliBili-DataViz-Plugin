import { renderCurrentVideoAssistant } from './assistant-status';
import { collectCurrentVideoContext, isVideoPage, withVideoElementDuration } from './current-video-context';
import { attachEventListeners, type VideoContext } from './event-capture';
import { startHeartbeat } from './heartbeat';
import {
  performConfirmedTimestampJump,
  performTimestampReturn,
  type CurrentVideoTimestampReturnPoint,
} from './timestamp-jump';
import { detectVideo } from './video-detector';
import type { BiliVizContentMessage } from '../../shared/types/messages';
import type {
  CurrentVideoTimestampJumpContentPayload,
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from '../../shared/types/current-video-segment-retrieval';
import type { CurrentVideoContextResult } from '../../shared/types/current-video-context';

let cleanup: (() => void) | null = null;
let lastContextKey = '';
let retryTimer: number | null = null;
let latestContext: CurrentVideoContextResult | null = null;
let currentVideoTimestampReturnPoint: CurrentVideoTimestampReturnPoint | null = null;

const RETURN_TOAST_ID = 'bdc-current-video-return';

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
  const context = await collectAndPublishCurrentVideoContext();

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
    latestContext = contextWithDuration;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'CURRENT_VIDEO_TIMESTAMP_JUMP') {
    handleCurrentVideoTimestampJump(message.payload).then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        candidateId: String(message.payload?.candidateId ?? ''),
        targetSeconds: null,
        targetTimeLabel: null,
        returnPointSeconds: null,
        sourceLabel: null,
        confidence: null,
      } satisfies CurrentVideoTimestampJumpResponse);
    });
    return true;
  }

  if (message?.action === 'CURRENT_VIDEO_TIMESTAMP_RETURN') {
    handleCurrentVideoTimestampReturn().then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        candidateId: null,
        returnPointSeconds: null,
        targetSeconds: null,
      } satisfies CurrentVideoTimestampReturnResponse);
    });
    return true;
  }

  if (message?.action === 'COLLECT_CURRENT_VIDEO_CONTEXT') {
    collectAndPublishCurrentVideoContext().then(sendResponse).catch((error) => {
      sendResponse({
        kind: 'no_context',
        url: location.href,
        collectedAt: Date.now(),
        reason: error instanceof Error ? 'video_context_unavailable' : 'unknown',
        pageType: isVideoPage() ? 'video' : 'non_video',
      } satisfies CurrentVideoContextResult);
    });
    return true;
  }

  return false;
});

async function collectAndPublishCurrentVideoContext(): Promise<CurrentVideoContextResult> {
  const context = await collectCurrentVideoContext();
  latestContext = context;
  renderCurrentVideoAssistant(context);
  sendCurrentVideoContext(context);
  return context;
}

async function handleCurrentVideoTimestampJump(
  payload: CurrentVideoTimestampJumpContentPayload,
): Promise<CurrentVideoTimestampJumpResponse> {
  const result = await performConfirmedTimestampJump({
    payload,
    latestContext,
    video: currentUsableVideoElement(),
  });
  if (result.returnPoint) {
    currentVideoTimestampReturnPoint = result.returnPoint;
    showReturnToast(result.response.returnPointSeconds, handleCurrentVideoTimestampReturn);
  }
  return result.response;
}

async function handleCurrentVideoTimestampReturn(): Promise<CurrentVideoTimestampReturnResponse> {
  const result = await performTimestampReturn({
    returnPoint: currentVideoTimestampReturnPoint,
    latestContext,
    video: currentUsableVideoElement(),
  });
  if (result.clearReturnPoint) {
    currentVideoTimestampReturnPoint = null;
  }
  return result.response;
}

function currentVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video');
}

function currentUsableVideoElement(): HTMLVideoElement | null {
  const video = currentVideoElement();
  if (!video) return null;
  return video;
}

function showReturnToast(
  seconds: number | null,
  onReturn?: () => Promise<CurrentVideoTimestampReturnResponse>,
): void {
  const existing = document.getElementById(RETURN_TOAST_ID);
  existing?.remove();

  const toast = document.createElement('div');
  toast.id = RETURN_TOAST_ID;
  toast.style.cssText = [
    'position:fixed',
    'right:18px',
    'bottom:150px',
    'z-index:2147483647',
    'box-sizing:border-box',
    'max-width:min(300px,calc(100vw - 36px))',
    'padding:10px',
    'border:1px solid rgba(255,179,71,0.36)',
    'border-radius:8px',
    'background:rgba(26,26,46,0.97)',
    'color:#f2f2f6',
    'box-shadow:0 8px 28px rgba(0,0,0,0.28)',
    'font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  ].join(';');

  const label = document.createElement('div');
  label.textContent = seconds === null
    ? '手动跳转完成。你可以返回上一页。'
    : `手动跳转完成。上一播放位置：${formatDuration(seconds)}。`;
  toast.appendChild(label);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '返回';
  back.style.cssText = 'flex:1;border:0;border-radius:6px;background:#ffb347;color:#1a1a2e;font-weight:700;font-size:12px;padding:6px 8px;cursor:pointer';
  back.addEventListener('click', async () => {
    if (onReturn) {
      await onReturn();
      toast.remove();
      return;
    }
    if (seconds !== null) {
      const video = await detectVideo();
      video.currentTime = Math.max(0, seconds);
    }
    toast.remove();
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '关闭';
  dismiss.style.cssText = 'border:1px solid rgba(255,255,255,0.16);border-radius:6px;background:transparent;color:#c8c8d8;font-size:12px;padding:6px 8px;cursor:pointer';
  dismiss.addEventListener('click', () => toast.remove());
  actions.append(back, dismiss);
  toast.appendChild(actions);
  document.body.appendChild(toast);
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
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
