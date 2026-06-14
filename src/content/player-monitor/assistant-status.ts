import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
} from '../../shared/types/current-video-context';
import { buildLocalCurrentVideoSummary } from '../../shared/current-video-summary';

const CARD_ID = 'bdc-current-video-assistant';
const STYLE_ID = 'bdc-current-video-assistant-style';

const CSS = `
#${CARD_ID} {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2147483646;
  width: min(320px, calc(100vw - 36px));
  box-sizing: border-box;
  border: 1px solid rgba(251, 114, 153, 0.28);
  border-radius: 8px;
  background: rgba(26, 26, 46, 0.96);
  color: #f2f2f6;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  padding: 12px;
}
#${CARD_ID} .bdc-assistant-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: #fb7299;
  font-size: 13px;
  font-weight: 700;
}
#${CARD_ID} .bdc-assistant-close {
  border: 0;
  background: transparent;
  color: #b8b8c8;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
#${CARD_ID} .bdc-assistant-video {
  color: #ffffff;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
  margin-bottom: 8px;
}
#${CARD_ID} .bdc-assistant-row {
  color: #c8c8d8;
  font-size: 12px;
  line-height: 1.45;
  margin-top: 4px;
}
#${CARD_ID} .bdc-assistant-muted {
  color: #9090a0;
}
#${CARD_ID} .bdc-assistant-warning {
  margin-top: 10px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(255, 179, 71, 0.12);
  color: #ffcf8a;
  font-size: 12px;
  line-height: 1.45;
}
#${CARD_ID} .bdc-assistant-tier {
  display: inline-block;
  margin: 4px 0 6px;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(251, 114, 153, 0.16);
  color: #ffd6e2;
  font-size: 11px;
  font-weight: 700;
}
#${CARD_ID} .bdc-assistant-summary {
  color: #f2f2f6;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 4px;
}
#${CARD_ID} .bdc-assistant-link {
  display: inline-block;
  margin-top: 10px;
  color: #ffffff;
  background: #fb7299;
  border-radius: 6px;
  padding: 7px 10px;
  text-decoration: none;
  font-size: 12px;
  font-weight: 650;
}
`;

export function renderCurrentVideoAssistant(context: CurrentVideoContextResult): void {
  injectStyle();

  const existing = document.getElementById(CARD_ID);
  const card = existing ?? document.createElement('aside');
  card.id = CARD_ID;
  card.setAttribute('aria-label', 'Bili-Bill 本地助手状态');
  card.textContent = '';

  const header = document.createElement('div');
  header.className = 'bdc-assistant-title';
  header.textContent = 'Bili-Bill 本地助手';

  const close = document.createElement('button');
  close.className = 'bdc-assistant-close';
  close.type = 'button';
  close.title = '隐藏';
  close.textContent = 'x';
  close.addEventListener('click', () => card.remove());
  header.appendChild(close);
  card.appendChild(header);

  if (context.kind === 'video') {
    const summary = buildLocalCurrentVideoSummary(context, {
      aiStatus: 'not_requested',
      aiNote: '页面悬浮卡只显示本地证据；启用后可在 Popup 查看 AI 摘要。',
    });
    appendText(card, 'div', 'bdc-assistant-video', context.title ?? context.bvid);
    appendText(card, 'div', 'bdc-assistant-tier', `${summary.sourceTierLabel} / 证据强度 ${summary.confidence === 'medium' ? '中' : '低'}`);
    appendText(card, 'div', 'bdc-assistant-summary', summary.summary);
    appendText(card, 'div', 'bdc-assistant-row', `BVID ${context.bvid} / CID ${context.cid ?? '未知'}`);
    appendText(
      card,
      'div',
      'bdc-assistant-row',
      `UP 主 ${context.authorName ?? '未知'}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-row',
      `时长 ${formatDuration(context.durationSeconds)} / 第 ${context.currentPart.page}${context.currentPart.total ? ` / ${context.currentPart.total} P` : ' P'}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-row bdc-assistant-muted',
      `来源：元数据 ${availabilityLabel(context.sources.metadata)}，简介 ${availabilityLabel(context.sources.description)}，分 P ${availabilityLabel(context.sources.pages)}，章节 ${availabilityLabel(context.sources.chapters)}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-row bdc-assistant-muted',
      `字幕 ${availabilityLabel(context.sources.transcript)}；正文文本 ${availabilityLabel(context.sources.contentText)}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-warning',
      subtitleStatusMessage(context),
    );
  } else {
    appendText(card, 'div', 'bdc-assistant-video', '没有当前视频上下文');
    appendText(
      card,
      'div',
      'bdc-assistant-row bdc-assistant-muted',
      '请打开 B 站视频页后再使用当前视频助手上下文。',
    );
  }

  const dashboard = document.createElement('a');
  dashboard.className = 'bdc-assistant-link';
  dashboard.href = chrome.runtime.getURL('dashboard/index.html');
  dashboard.target = '_blank';
  dashboard.rel = 'noopener noreferrer';
  dashboard.textContent = '打开完整面板';
  card.appendChild(dashboard);

  if (!existing) {
    document.body.appendChild(card);
  }
}

function appendText(parent: HTMLElement, tag: 'div' | 'p', className: string, text: string): void {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  parent.appendChild(el);
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '未知';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function availabilityLabel(value: string): string {
  switch (value) {
    case 'available':
      return '可用';
    case 'unavailable':
      return '不可用';
    case 'unknown':
      return '未知';
    default:
      return '未知';
  }
}

function subtitleStatusMessage(context: CurrentVideoContext): string {
  if (context.subtitleProbe) return context.subtitleProbe.message;
  if (context.sources.transcript === 'unknown') {
    return '字幕来源等待后台探测；当前只使用元数据/简介 fallback，不能做完整视频总结。';
  }
  if (context.sources.description === 'available') {
    return '简介可用，但字幕和完整正文文本不可用；这不是完整视频总结。';
  }
  return '当前没有可用字幕、简介或完整正文文本；这不是完整视频总结。';
}
