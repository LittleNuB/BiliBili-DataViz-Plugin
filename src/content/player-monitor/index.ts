import { renderCurrentVideoAssistant } from './assistant-status';
import { collectCurrentVideoContext, isVideoPage, withVideoElementDuration } from './current-video-context';
import { attachEventListeners, type VideoContext } from './event-capture';
import { startHeartbeat } from './heartbeat';
import { detectVideo } from './video-detector';
import type { BiliVizContentMessage } from '../../shared/types/messages';
import type { CurrentVideoContextResult } from '../../shared/types/current-video-context';
import type { VideoKnowledgeJumpResponse, VideoKnowledgeNode } from '../../shared/types/video-knowledge';

let cleanup: (() => void) | null = null;
let lastContextKey = '';
let retryTimer: number | null = null;
let latestContext: CurrentVideoContextResult | null = null;

const RETURN_TOAST_ID = 'bdc-video-knowledge-return';
const PAGE_RETURN_KEY = 'bdc-video-knowledge-return-point';

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
  latestContext = context;
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
    latestContext = contextWithDuration;
    renderCurrentVideoAssistant(contextWithDuration);
    sendCurrentVideoContext(contextWithDuration);
    showStoredPageReturnIfAvailable(contextWithDuration);
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
  if (message?.action !== 'VIDEO_KNOWLEDGE_MANUAL_JUMP') return false;

  handleVideoKnowledgeManualJump(message.payload).then(sendResponse).catch((error) => {
    sendResponse({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      nodeId: String(message.payload?.node?.id ?? ''),
      previousPositionSeconds: null,
      targetSeconds: null,
      targetPage: null,
    } satisfies VideoKnowledgeJumpResponse);
  });
  return true;
});

async function handleVideoKnowledgeManualJump(payload: {
  node?: VideoKnowledgeNode;
  contextBvid?: string | null;
  confirmed?: boolean;
}): Promise<VideoKnowledgeJumpResponse> {
  const node = payload.node;
  if (!payload.confirmed || !node?.jumpAction?.requiresConfirmation) {
    throw new Error('CONFIRMATION_REQUIRED');
  }
  if (!node.jumpAction) {
    throw new Error('JUMP_TARGET_UNAVAILABLE');
  }
  if (latestContext?.kind !== 'video' || latestContext.bvid !== payload.contextBvid || node.bvid !== latestContext.bvid) {
    throw new Error('VIDEO_CONTEXT_CHANGED');
  }

  const targetPage = node.jumpAction.targetPage;
  const targetSeconds = node.jumpAction.targetSeconds;
  if (node.jumpAction.type === 'page' && targetPage && targetPage !== latestContext.currentPart.page) {
    const previousPositionSeconds = currentVideoElement()?.currentTime ?? null;
    storePageReturn(latestContext.url, previousPositionSeconds);
    window.setTimeout(() => {
      location.assign(urlForPage(targetPage));
    }, 0);
    return {
      ok: true,
      message: `Opening ${node.jumpAction.previewLabel}`,
      nodeId: node.id,
      previousPositionSeconds,
      targetSeconds,
      targetPage,
    };
  }

  if (typeof targetSeconds !== 'number' || !Number.isFinite(targetSeconds) || targetSeconds < 0) {
    throw new Error('INVALID_SEEK_TARGET');
  }

  const video = await detectVideo();
  const previousPositionSeconds = video.currentTime;
  video.currentTime = Math.min(targetSeconds, Number.isFinite(video.duration) ? video.duration : targetSeconds);
  showReturnToast(previousPositionSeconds);
  return {
    ok: true,
    message: `Jumped to ${node.jumpAction.previewLabel}`,
    nodeId: node.id,
    previousPositionSeconds,
    targetSeconds,
    targetPage,
  };
}

function currentVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video');
}

function urlForPage(page: number): string {
  const url = new URL(location.href);
  url.searchParams.set('p', String(page));
  return url.toString();
}

function storePageReturn(url: string, seconds: number | null): void {
  try {
    sessionStorage.setItem(PAGE_RETURN_KEY, JSON.stringify({ url, seconds, savedAt: Date.now() }));
  } catch {
    // Session storage can be unavailable in some embedded player contexts.
  }
}

function showStoredPageReturnIfAvailable(context: CurrentVideoContextResult): void {
  if (context.kind !== 'video') return;
  try {
    const raw = sessionStorage.getItem(PAGE_RETURN_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { url?: unknown; seconds?: unknown; savedAt?: unknown };
    if (typeof parsed.url !== 'string' || Date.now() - Number(parsed.savedAt ?? 0) > 10 * 60 * 1000) {
      sessionStorage.removeItem(PAGE_RETURN_KEY);
      return;
    }
    showReturnToast(
      typeof parsed.seconds === 'number' && Number.isFinite(parsed.seconds) ? parsed.seconds : null,
      parsed.url,
    );
    sessionStorage.removeItem(PAGE_RETURN_KEY);
  } catch {
    sessionStorage.removeItem(PAGE_RETURN_KEY);
  }
}

function showReturnToast(seconds: number | null, url?: string): void {
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
    ? 'Manual jump complete. You can return to the previous page.'
    : `Manual jump complete. Previous position: ${formatDuration(seconds)}.`;
  toast.appendChild(label);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Return';
  back.style.cssText = 'flex:1;border:0;border-radius:6px;background:#ffb347;color:#1a1a2e;font-weight:700;font-size:12px;padding:6px 8px;cursor:pointer';
  back.addEventListener('click', async () => {
    if (url) {
      location.assign(url);
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
  dismiss.textContent = 'Dismiss';
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
