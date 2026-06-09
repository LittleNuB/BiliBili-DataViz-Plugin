import type { CurrentVideoContextResult } from '../../shared/types/current-video-context';
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
  card.setAttribute('aria-label', 'Bili-Bill local assistant status');
  card.textContent = '';

  const header = document.createElement('div');
  header.className = 'bdc-assistant-title';
  header.textContent = 'Bili-Bill local assistant';

  const close = document.createElement('button');
  close.className = 'bdc-assistant-close';
  close.type = 'button';
  close.title = 'Hide';
  close.textContent = 'x';
  close.addEventListener('click', () => card.remove());
  header.appendChild(close);
  card.appendChild(header);

  if (context.kind === 'video') {
    const summary = buildLocalCurrentVideoSummary(context, {
      aiStatus: 'not_requested',
      aiNote: 'Page overlay shows local evidence only; AI summary is available from the popup when enabled.',
    });
    appendText(card, 'div', 'bdc-assistant-video', context.title ?? context.bvid);
    appendText(card, 'div', 'bdc-assistant-tier', `${summary.sourceTierLabel} / ${summary.confidence} confidence`);
    appendText(card, 'div', 'bdc-assistant-summary', summary.summary);
    appendText(card, 'div', 'bdc-assistant-row', `BVID ${context.bvid} / CID ${context.cid ?? 'unknown'}`);
    appendText(
      card,
      'div',
      'bdc-assistant-row',
      `UP ${context.authorName ?? 'unknown'}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-row',
      `Duration ${formatDuration(context.durationSeconds)} / Part ${context.currentPart.page}${context.currentPart.total ? ` of ${context.currentPart.total}` : ''}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-row bdc-assistant-muted',
      `Sources: metadata ${context.sources.metadata}, description ${context.sources.description}, pages ${context.sources.pages}, chapters ${context.sources.chapters}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-row bdc-assistant-muted',
      `Transcript ${context.sources.transcript}; content text ${context.sources.contentText}`,
    );
    appendText(
      card,
      'div',
      'bdc-assistant-warning',
      context.sources.description === 'available'
        ? 'Description is available, but transcript and full content text are unavailable. This is not a full video summary.'
        : 'No transcript, description, or full content text source is available. This is not a full video summary.',
    );
  } else {
    appendText(card, 'div', 'bdc-assistant-video', 'No current video context');
    appendText(
      card,
      'div',
      'bdc-assistant-row bdc-assistant-muted',
      'Open a Bilibili video page to use the local current-video assistant context.',
    );
  }

  const dashboard = document.createElement('a');
  dashboard.className = 'bdc-assistant-link';
  dashboard.href = chrome.runtime.getURL('dashboard/index.html');
  dashboard.target = '_blank';
  dashboard.rel = 'noopener noreferrer';
  dashboard.textContent = 'Open dashboard';
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
  if (!seconds) return 'unknown';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
