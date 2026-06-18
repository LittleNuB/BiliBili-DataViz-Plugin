import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
} from '../../shared/types/current-video-context';
import type { BiliVizResponse, RequestAction } from '../../shared/types/messages';
import type { CurrentVideoSummaryResult } from '../../shared/types/current-video-summary';
import type { CurrentVideoTranscriptEvidenceState } from '../../shared/types/current-video-transcript';
import {
  buildCurrentVideoSubtitleDiagnostics,
  type CurrentVideoSubtitleDiagnostics,
} from '../../shared/current-video-subtitle-diagnostics';

const CARD_ID = 'bdc-current-video-assistant';
const STYLE_ID = 'bdc-current-video-assistant-style';

const RAW_FIELD_PATTERN = new RegExp(
  `\\b(?:${[
    ['subtitle', '_', 'url'],
    ['source', 'Hash'],
    ['segment', 'Id'],
    ['to', 'ken'],
    ['endpoint', ' path'],
    ['Coo', 'kie'],
    ['pro', 'file'],
    ['Key', '.', 'txt'],
    ['Chrome', '\\\\', 'User Data'],
  ].map(parts => escapeRegExp(parts.join(''))).join('|')})\\b`,
  'gi',
);

const CSS = `
#${CARD_ID} {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2147483646;
  box-sizing: border-box;
  color: #f4f7fb;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  letter-spacing: 0;
}
#${CARD_ID} * {
  box-sizing: border-box;
}
#${CARD_ID}.bdc-assistant-collapsed {
  width: min(300px, calc(100vw - 36px));
}
#${CARD_ID}.bdc-assistant-expanded {
  top: 72px;
  bottom: 18px;
  width: min(390px, calc(100vw - 36px));
}
#${CARD_ID} .bdc-assistant-shell,
#${CARD_ID} .bdc-assistant-panel {
  width: 100%;
  border: 1px solid rgba(251, 114, 153, 0.30);
  border-radius: 8px;
  background: rgba(24, 26, 43, 0.97);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.30);
  overflow: hidden;
}
#${CARD_ID} .bdc-assistant-panel {
  display: flex;
  max-height: 100%;
  flex-direction: column;
}
#${CARD_ID} .bdc-assistant-body {
  overflow: auto;
  padding: 12px;
}
#${CARD_ID} .bdc-assistant-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
#${CARD_ID} .bdc-assistant-brand {
  min-width: 0;
}
#${CARD_ID} .bdc-assistant-kicker {
  color: #fb7299;
  font-size: 12px;
  font-weight: 750;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-subtitle {
  margin-top: 2px;
  color: #aeb4c4;
  font-size: 11px;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}
#${CARD_ID} .bdc-assistant-button,
#${CARD_ID} .bdc-assistant-link {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: #f4f7fb;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  padding: 6px 9px;
  text-decoration: none;
}
#${CARD_ID} .bdc-assistant-button-primary {
  border-color: rgba(251, 114, 153, 0.45);
  background: #fb7299;
  color: #ffffff;
}
#${CARD_ID} .bdc-assistant-button-quiet {
  color: #c9d0dd;
}
#${CARD_ID} .bdc-assistant-button:disabled {
  cursor: default;
  opacity: 0.55;
}
#${CARD_ID} .bdc-assistant-video-title {
  color: #ffffff;
  font-size: 14px;
  font-weight: 750;
  line-height: 1.38;
  overflow-wrap: anywhere;
}
#${CARD_ID} .bdc-assistant-compact-status {
  padding: 0 12px 12px;
  color: #c9d0dd;
  font-size: 12px;
  line-height: 1.45;
}
#${CARD_ID} .bdc-assistant-section {
  margin-top: 10px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.055);
  padding: 10px;
}
#${CARD_ID} .bdc-assistant-section:first-child {
  margin-top: 0;
}
#${CARD_ID} .bdc-assistant-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
#${CARD_ID} .bdc-assistant-section-title {
  color: #ffd6e2;
  font-size: 12px;
  font-weight: 750;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: #c9d0dd;
  font-size: 12px;
  line-height: 1.45;
  margin-top: 5px;
}
#${CARD_ID} .bdc-assistant-row span:last-child {
  color: #f4f7fb;
  text-align: right;
}
#${CARD_ID} .bdc-assistant-muted {
  color: #9aa3b4;
  font-size: 11px;
  line-height: 1.45;
}
#${CARD_ID} .bdc-assistant-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
#${CARD_ID} .bdc-assistant-pill {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: #c9d0dd;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  padding: 4px 7px;
}
#${CARD_ID} .bdc-assistant-pill-ready {
  border-color: rgba(160, 231, 160, 0.30);
  color: #a0e7a0;
}
#${CARD_ID} .bdc-assistant-pill-warn {
  border-color: rgba(255, 207, 138, 0.32);
  color: #ffcf8a;
}
#${CARD_ID} .bdc-assistant-subtitle-box {
  border-radius: 8px;
  padding: 10px;
}
#${CARD_ID} .bdc-assistant-subtitle-title {
  font-size: 12px;
  font-weight: 750;
  line-height: 1.35;
  margin-bottom: 5px;
}
#${CARD_ID} .bdc-assistant-subtitle-text {
  color: #dbe2ef;
  font-size: 12px;
  line-height: 1.5;
}
#${CARD_ID} .bdc-assistant-subtitle-detail {
  color: #aeb4c4;
  font-size: 11px;
  line-height: 1.45;
  margin-top: 5px;
}
#${CARD_ID} .bdc-assistant-status {
  color: #c8e6ff;
  font-size: 11px;
  line-height: 1.45;
  margin-top: 7px;
}
#${CARD_ID} .bdc-assistant-summary-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
#${CARD_ID} .bdc-assistant-badge {
  border-radius: 6px;
  background: rgba(251, 114, 153, 0.16);
  color: #ffd6e2;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.2;
  padding: 4px 6px;
}
#${CARD_ID} .bdc-assistant-summary-text {
  color: #f4f7fb;
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
#${CARD_ID} .bdc-assistant-list {
  margin: 8px 0 0;
  padding-left: 17px;
  color: #dbe2ef;
  font-size: 12px;
  line-height: 1.5;
}
#${CARD_ID} .bdc-assistant-list li {
  margin-top: 4px;
}
#${CARD_ID} .bdc-assistant-evidence {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #c8e6ff;
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
@media (max-width: 560px) {
  #${CARD_ID} {
    right: 10px;
    bottom: 10px;
  }
  #${CARD_ID}.bdc-assistant-expanded {
    top: 58px;
    width: calc(100vw - 20px);
  }
}
`;

interface AssistantState {
  expanded: boolean;
  context: CurrentVideoContextResult | null;
  contextKey: string;
  summary: CurrentVideoSummaryResult | null;
  summaryContextKey: string;
  summaryLoading: boolean;
  summaryError: string | null;
  summaryRequestId: number;
  subtitleRefreshing: boolean;
  subtitleStatus: string | null;
  subtitleRequestId: number;
}

const assistantState: AssistantState = {
  expanded: false,
  context: null,
  contextKey: '',
  summary: null,
  summaryContextKey: '',
  summaryLoading: false,
  summaryError: null,
  summaryRequestId: 0,
  subtitleRefreshing: false,
  subtitleStatus: null,
  subtitleRequestId: 0,
};

export function renderCurrentVideoAssistant(context: CurrentVideoContextResult): void {
  injectStyle();
  updateAssistantContext(context);
  renderAssistantShell();

  if (
    assistantState.expanded
    && context.kind === 'video'
    && !assistantState.summary
    && !assistantState.summaryLoading
  ) {
    void loadCurrentVideoSummary(false);
  }
}

function updateAssistantContext(context: CurrentVideoContextResult): void {
  const nextKey = contextStateKey(context);
  if (assistantState.contextKey !== nextKey) {
    assistantState.summary = null;
    assistantState.summaryContextKey = '';
    assistantState.summaryError = null;
    assistantState.subtitleStatus = null;
  }
  assistantState.context = context;
  assistantState.contextKey = nextKey;
}

function renderAssistantShell(): void {
  const existing = document.getElementById(CARD_ID);
  const root = existing ?? document.createElement('aside');
  root.id = CARD_ID;
  root.className = assistantState.expanded
    ? 'bdc-assistant-expanded'
    : 'bdc-assistant-collapsed';
  root.setAttribute('aria-label', 'Bili-Bill 当前视频页内助手');
  root.textContent = '';

  if (assistantState.expanded) {
    renderExpandedPanel(root);
  } else {
    renderCollapsedCard(root);
  }

  if (!existing) {
    document.body.appendChild(root);
  }
}

function renderCollapsedCard(root: HTMLElement): void {
  const card = document.createElement('div');
  card.className = 'bdc-assistant-shell';

  const header = document.createElement('div');
  header.className = 'bdc-assistant-header';

  const brand = document.createElement('div');
  brand.className = 'bdc-assistant-brand';
  appendText(brand, 'div', 'bdc-assistant-kicker', 'Bili-Bill 当前视频助手');
  appendText(brand, 'div', 'bdc-assistant-subtitle', compactStatusText(assistantState.context));
  header.appendChild(brand);

  const actions = document.createElement('div');
  actions.className = 'bdc-assistant-actions';
  const expand = button('展开助手', 'bdc-assistant-button bdc-assistant-button-primary', () => {
    assistantState.expanded = true;
    renderAssistantShell();
    void loadCurrentVideoSummary(false);
  });
  actions.appendChild(expand);
  header.appendChild(actions);
  card.appendChild(header);

  const status = document.createElement('div');
  status.className = 'bdc-assistant-compact-status';
  if (assistantState.context?.kind === 'video') {
    appendText(status, 'div', 'bdc-assistant-video-title', assistantState.context.title ?? '当前视频');
  }
  appendText(status, 'div', 'bdc-assistant-muted', '在当前视频页内查看摘要和字幕正文状态。');
  const globalLink = dashboardLink('全局总览');
  globalLink.className = 'bdc-assistant-link bdc-assistant-button-quiet';
  status.appendChild(globalLink);
  card.appendChild(status);
  root.appendChild(card);
}

function renderExpandedPanel(root: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'bdc-assistant-panel';

  const header = document.createElement('div');
  header.className = 'bdc-assistant-header';
  const brand = document.createElement('div');
  brand.className = 'bdc-assistant-brand';
  appendText(brand, 'div', 'bdc-assistant-kicker', '当前视频助手');
  appendText(brand, 'div', 'bdc-assistant-subtitle', '摘要与字幕状态留在当前播放页');
  header.appendChild(brand);

  const actions = document.createElement('div');
  actions.className = 'bdc-assistant-actions';
  actions.appendChild(button('刷新摘要', 'bdc-assistant-button bdc-assistant-button-quiet', () => {
    void loadCurrentVideoSummary(true);
  }, assistantState.summaryLoading || assistantState.context?.kind !== 'video'));
  actions.appendChild(button('收起', 'bdc-assistant-button bdc-assistant-button-quiet', () => {
    assistantState.expanded = false;
    renderAssistantShell();
  }));
  header.appendChild(actions);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'bdc-assistant-body';

  const context = assistantState.context;
  if (context?.kind === 'video') {
    appendVideoIdentity(body, context);
    appendSubtitleDiagnostics(body, context);
    appendSummary(body);
  } else {
    const empty = section('当前视频');
    appendText(empty, 'div', 'bdc-assistant-video-title', '没有当前视频上下文');
    appendText(empty, 'div', 'bdc-assistant-muted', '请在 B 站视频页使用当前视频助手。');
    body.appendChild(empty);
  }

  const footer = section('全局入口');
  appendText(footer, 'div', 'bdc-assistant-muted', '总览、智能收藏和动态账单仍在 Bili-Bill 全局面板中。');
  footer.appendChild(dashboardLink('打开全局总览'));
  body.appendChild(footer);

  panel.appendChild(body);
  root.appendChild(panel);
}

function appendVideoIdentity(parent: HTMLElement, context: CurrentVideoContext): void {
  const block = section('当前视频');
  appendText(block, 'div', 'bdc-assistant-video-title', context.title ?? context.bvid);

  const pills = document.createElement('div');
  pills.className = 'bdc-assistant-pills';
  pills.appendChild(pill('BVID 已识别', Boolean(context.bvid)));
  pills.appendChild(pill(context.cid ? 'CID 已识别' : 'CID 未识别', Boolean(context.cid)));
  pills.appendChild(pill(`正文文本 ${availabilityLabel(context.sources.contentText)}`, context.sources.contentText === 'available'));
  block.appendChild(pills);

  appendRow(block, '当前分 P', `第 ${context.currentPart.page}${context.currentPart.total ? ` / ${context.currentPart.total} P` : ' P'}`);
  appendRow(block, '字幕来源', availabilityLabel(context.sources.transcript));
  appendRow(block, '字幕正文', transcriptEvidenceLabel(context));
  parent.appendChild(block);
}

function appendSubtitleDiagnostics(parent: HTMLElement, context: CurrentVideoContext): void {
  const diagnostics = buildCurrentVideoSubtitleDiagnostics(context, {
    refreshing: assistantState.subtitleRefreshing,
  });
  const block = section('字幕正文状态');
  const box = document.createElement('div');
  box.className = 'bdc-assistant-subtitle-box';
  box.style.border = `1px solid ${subtitleDiagnosticsBorder(diagnostics)}`;
  box.style.background = subtitleDiagnosticsBackground(diagnostics);

  const title = document.createElement('div');
  title.className = 'bdc-assistant-subtitle-title';
  title.style.color = subtitleDiagnosticsColor(diagnostics);
  title.textContent = diagnostics.title;
  box.appendChild(title);

  appendText(box, 'div', 'bdc-assistant-subtitle-text', summarySubtitleMessage(context, diagnostics));
  appendText(box, 'div', 'bdc-assistant-subtitle-detail', summarySubtitleAction(context, diagnostics));

  const summaryGate = diagnostics.featureGates.find(item => item.label === '摘要');
  if (summaryGate) {
    appendText(
      box,
      'div',
      'bdc-assistant-subtitle-detail',
      `摘要：${summaryGate.message}`,
    );
  }

  const buttonEl = button(
    assistantState.subtitleRefreshing ? '检测中...' : '重新检测字幕',
    'bdc-assistant-button bdc-assistant-button-primary',
    () => {
      void refreshSubtitleEvidenceFromPage();
    },
    assistantState.subtitleRefreshing || !diagnostics.canRetry,
  );
  box.appendChild(buttonEl);
  if (assistantState.subtitleStatus) {
    appendText(box, 'div', 'bdc-assistant-status', assistantState.subtitleStatus);
  }

  block.appendChild(box);
  parent.appendChild(block);
}

function appendSummary(parent: HTMLElement): void {
  const block = section('当前视频摘要');

  if (assistantState.summaryLoading) {
    appendText(block, 'div', 'bdc-assistant-muted', '正在刷新当前视频摘要...');
    parent.appendChild(block);
    return;
  }

  if (assistantState.summaryError) {
    appendText(block, 'div', 'bdc-assistant-subtitle-text', assistantState.summaryError);
    block.appendChild(button('重试摘要', 'bdc-assistant-button bdc-assistant-button-primary', () => {
      void loadCurrentVideoSummary(true);
    }));
    parent.appendChild(block);
    return;
  }

  const summary = assistantState.summary;
  if (!summary || assistantState.summaryContextKey !== assistantState.contextKey) {
    appendText(block, 'div', 'bdc-assistant-muted', '展开后会读取当前视频摘要。');
    block.appendChild(button('读取摘要', 'bdc-assistant-button bdc-assistant-button-primary', () => {
      void loadCurrentVideoSummary(true);
    }));
    parent.appendChild(block);
    return;
  }

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-summary-meta';
  appendBadge(meta, summary.sourceTierLabel ?? summaryStatusLabel(summary.status));
  appendBadge(meta, summary.generationMode === 'ai' ? 'AI 摘要已采用' : '本地证据摘要');
  appendBadge(meta, `证据强度 ${summaryConfidenceLabel(summary.confidence)}`);
  block.appendChild(meta);

  appendText(block, 'div', 'bdc-assistant-summary-text', safeVisibleText(summary.summary));

  if (summary.bullets.length > 0) {
    const list = document.createElement('ul');
    list.className = 'bdc-assistant-list';
    for (const item of summary.bullets.slice(0, 3)) {
      const li = document.createElement('li');
      li.textContent = safeVisibleText(item);
      list.appendChild(li);
    }
    block.appendChild(list);
  }

  if (summary.timestampRanges.length > 0) {
    for (const range of summary.timestampRanges.slice(0, 3)) {
      appendText(
        block,
        'div',
        'bdc-assistant-evidence',
        `字幕证据 ${range.label}：${safeVisibleText(range.evidenceSnippet)}`,
      );
    }
  }

  if (summary.limitations.length > 0) {
    appendText(
      block,
      'div',
      'bdc-assistant-subtitle-detail',
      summary.limitations.slice(0, 2).map(safeVisibleText).join(' '),
    );
  }

  parent.appendChild(block);
}

async function refreshSubtitleEvidenceFromPage(): Promise<void> {
  if (assistantState.subtitleRefreshing) return;

  const requestId = assistantState.subtitleRequestId + 1;
  assistantState.subtitleRequestId = requestId;
  assistantState.subtitleRefreshing = true;
  assistantState.subtitleStatus = null;
  renderAssistantShell();

  try {
    await sendRuntimeRequest<CurrentVideoContextResult>('GET_CURRENT_VIDEO_CONTEXT', {
      forceContextRefresh: true,
      forceSubtitleProbe: true,
    });
    const transcriptEvidence = await sendRuntimeRequest<CurrentVideoTranscriptEvidenceState>(
      'GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE',
      {
        forceContextRefresh: true,
        forceSubtitleProbe: true,
      },
    );
    const context = await sendRuntimeRequest<CurrentVideoContextResult>('GET_CURRENT_VIDEO_CONTEXT', {
      forceContextRefresh: true,
    });
    if (assistantState.subtitleRequestId !== requestId) return;

    const nextContext = context.kind === 'video'
      ? { ...context, transcriptEvidence }
      : context;
    updateAssistantContext(nextContext);
    assistantState.subtitleRefreshing = false;
    assistantState.subtitleStatus = subtitleRefreshResultText(nextContext);
    renderAssistantShell();

    if (nextContext.kind === 'video') {
      await loadCurrentVideoSummary(true);
    }
  } catch {
    if (assistantState.subtitleRequestId !== requestId) return;
    assistantState.subtitleRefreshing = false;
    assistantState.subtitleStatus = '重新检测失败：请确认当前 B 站视频页仍然打开，并在播放器里开启中文 AI 字幕后重试。';
    renderAssistantShell();
  }
}

async function loadCurrentVideoSummary(force: boolean): Promise<void> {
  if (assistantState.context?.kind !== 'video') return;
  if (assistantState.summaryLoading) return;
  if (
    !force
    && assistantState.summary
    && assistantState.summaryContextKey === assistantState.contextKey
  ) {
    return;
  }

  const requestId = assistantState.summaryRequestId + 1;
  const contextKey = assistantState.contextKey;
  assistantState.summaryRequestId = requestId;
  assistantState.summaryLoading = true;
  assistantState.summaryError = null;
  renderAssistantShell();

  try {
    const summary = await sendRuntimeRequest<CurrentVideoSummaryResult>('GET_CURRENT_VIDEO_SUMMARY');
    if (assistantState.summaryRequestId !== requestId || assistantState.contextKey !== contextKey) return;
    assistantState.summary = summary;
    assistantState.summaryContextKey = contextKey;
  } catch {
    if (assistantState.summaryRequestId !== requestId) return;
    assistantState.summaryError = '摘要刷新失败：请确认当前 B 站视频页仍然打开，稍后再试。';
  } finally {
    if (assistantState.summaryRequestId === requestId) {
      assistantState.summaryLoading = false;
      renderAssistantShell();
    }
  }
}

async function sendRuntimeRequest<T>(
  action: RequestAction,
  params?: Record<string, unknown>,
): Promise<T> {
  const response = await chrome.runtime.sendMessage({ action, params }) as BiliVizResponse<T>;
  if (!response?.success || response.data === undefined) {
    throw new Error('REQUEST_FAILED');
  }
  return response.data;
}

function section(title: string): HTMLElement {
  const block = document.createElement('section');
  block.className = 'bdc-assistant-section';
  const head = document.createElement('div');
  head.className = 'bdc-assistant-section-head';
  appendText(head, 'div', 'bdc-assistant-section-title', title);
  block.appendChild(head);
  return block;
}

function button(
  text: string,
  className: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  element.disabled = disabled;
  element.addEventListener('click', onClick);
  return element;
}

function dashboardLink(text: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'bdc-assistant-link';
  link.href = chrome.runtime.getURL('dashboard/index.html');
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}

function appendRow(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement('div');
  row.className = 'bdc-assistant-row';
  appendText(row, 'span', '', label);
  appendText(row, 'span', '', value);
  parent.appendChild(row);
}

function appendBadge(parent: HTMLElement, text: string): void {
  const badge = document.createElement('span');
  badge.className = 'bdc-assistant-badge';
  badge.textContent = text;
  parent.appendChild(badge);
}

function pill(text: string, ready: boolean): HTMLElement {
  const element = document.createElement('span');
  element.className = ready
    ? 'bdc-assistant-pill bdc-assistant-pill-ready'
    : 'bdc-assistant-pill bdc-assistant-pill-warn';
  element.textContent = text;
  return element;
}

function appendText(
  parent: HTMLElement,
  tag: 'div' | 'p' | 'span',
  className: string,
  text: string,
): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function contextStateKey(context: CurrentVideoContextResult): string {
  if (context.kind !== 'video') {
    return ['no-context', context.reason, context.url ?? ''].join(':');
  }

  const evidence = context.transcriptEvidence;
  return [
    context.bvid,
    context.cid ?? 'cid-unknown',
    context.currentPart.page,
    context.sources.transcript,
    context.sources.contentText,
    evidence?.status ?? 'no-evidence',
    evidence?.active === true ? 'active' : 'inactive',
    evidence?.segmentCount ?? 0,
    evidence?.updatedAt ?? 0,
  ].join(':');
}

function compactStatusText(context: CurrentVideoContextResult | null): string {
  if (!context) return '正在读取当前视频状态';
  if (context.kind !== 'video') return '未识别到当前视频';
  if (context.transcriptEvidence?.active) return '字幕正文已缓存，可查看摘要';
  if (context.cid) return '已识别视频，等待字幕正文';
  return '已识别视频，CID 待刷新';
}

function transcriptEvidenceLabel(context: CurrentVideoContext): string {
  const evidence = context.transcriptEvidence;
  if (evidence?.active) return `已缓存 ${evidence.segmentCount} 条`;
  if (evidence && evidence.status !== 'missing') return evidenceStatusLabel(evidence.status);
  return availabilityLabel(context.sources.contentText);
}

function evidenceStatusLabel(status: CurrentVideoTranscriptEvidenceState['status']): string {
  switch (status) {
    case 'cached':
      return '已缓存';
    case 'stale':
      return '证据不匹配';
    case 'empty':
      return '正文为空';
    case 'malformed':
      return '正文异常';
    case 'track_unavailable':
      return '轨道不可读';
    case 'language_mismatch':
      return '语言不匹配';
    case 'login_required':
      return '需要登录权限';
    case 'endpoint_failed':
      return '读取失败';
    case 'unsupported':
      return '暂不支持';
    default:
      return '未缓存';
  }
}

function summarySubtitleMessage(
  context: CurrentVideoContext,
  diagnostics: CurrentVideoSubtitleDiagnostics,
): string {
  if (assistantState.subtitleRefreshing || diagnostics.status === 'reading_body') {
    return '正在刷新当前视频上下文、检测字幕来源，并尝试读取字幕正文。';
  }
  if (context.transcriptEvidence?.active) {
    return `已缓存当前视频字幕正文证据 ${context.transcriptEvidence.segmentCount} 条，页内摘要可使用这些本地字幕片段。`;
  }

  switch (diagnostics.status) {
    case 'missing_cid':
      return '还没有拿到当前分 P 的 CID，暂时不能安全检测字幕正文。';
    case 'track_found':
      return '已发现字幕轨道，还需要读取并缓存正文后才能用于当前视频摘要。';
    case 'enable_ai_subtitle':
      return '当前还没有可用字幕正文。通常需要先在播放器里手动开启中文 AI 字幕。';
    case 'login_required':
      return '字幕需要当前浏览器会话具备访问权限；Bili-Bill 不会读取本地敏感文件。';
    case 'no_track':
      return 'B 站播放器接口没有返回可用字幕轨道，当前摘要仍会使用元数据或简介兜底。';
    case 'fetch_failed':
      return '字幕正文读取失败，当前仍只能使用元数据或简介作为本地证据。';
    case 'malformed':
      return '字幕正文结构暂时无法稳定解析，因此不会作为摘要证据。';
    case 'empty':
      return '已找到字幕来源，但没有返回有效正文片段。';
    case 'language_mismatch':
      return '当前可读字幕不是中文 AI 字幕，因此不会作为当前视频正文证据。';
    case 'unsupported_host':
      return '字幕来源不在受限的 B 站字幕域名范围内，已拒绝读取。';
    case 'stale':
      return '本地字幕证据与当前视频不匹配，当前摘要会回退到元数据或简介。';
    default:
      return '当前没有可引用的字幕正文；页内摘要不会当作完整视频总结。';
  }
}

function summarySubtitleAction(
  context: CurrentVideoContext,
  diagnostics: CurrentVideoSubtitleDiagnostics,
): string {
  if (assistantState.subtitleRefreshing || diagnostics.status === 'reading_body') {
    return '请保持当前视频页打开，检测完成后摘要会自动刷新。';
  }
  if (context.transcriptEvidence?.active) {
    return coverageText(context.transcriptEvidence) || '如果刚切换分 P，可以再次重新检测字幕。';
  }
  return diagnostics.action;
}

function subtitleRefreshResultText(context: CurrentVideoContextResult): string {
  const diagnostics = buildCurrentVideoSubtitleDiagnostics(context);
  if (context.kind === 'video' && context.transcriptEvidence?.active) {
    return `已刷新：字幕正文已缓存 ${context.transcriptEvidence.segmentCount} 条，摘要正在更新。`;
  }
  return `已刷新：${diagnostics.title}。`;
}

function coverageText(evidence: CurrentVideoTranscriptEvidenceState): string {
  if (typeof evidence.coverageStartSeconds !== 'number' || typeof evidence.coverageEndSeconds !== 'number') {
    return '';
  }
  return `可引用范围：${formatDuration(evidence.coverageStartSeconds)}-${formatDuration(evidence.coverageEndSeconds)}。`;
}

function safeVisibleText(value: string): string {
  return value
    .replace(/transcript:[A-Za-z0-9:._-]+/g, '字幕片段')
    .replace(/https?:\/\/\S+/g, '链接已隐藏')
    .replace(/\/x\/player(?:\/wbi)?\/v2/gi, '接口路径已隐藏')
    .replace(RAW_FIELD_PATTERN, '内部字段');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function subtitleDiagnosticsColor(state: CurrentVideoSubtitleDiagnostics): string {
  if (state.tone === 'ready') return '#a0e7a0';
  if (state.tone === 'info') return '#c8e6ff';
  if (state.tone === 'blocked') return '#ff8a8a';
  return '#ffcf8a';
}

function subtitleDiagnosticsBorder(state: CurrentVideoSubtitleDiagnostics): string {
  if (state.tone === 'ready') return 'rgba(160,231,160,0.28)';
  if (state.tone === 'info') return 'rgba(127,219,255,0.28)';
  if (state.tone === 'blocked') return 'rgba(255,138,138,0.28)';
  return 'rgba(255,179,71,0.24)';
}

function subtitleDiagnosticsBackground(state: CurrentVideoSubtitleDiagnostics): string {
  if (state.tone === 'ready') return 'rgba(160,231,160,0.08)';
  if (state.tone === 'info') return 'rgba(127,219,255,0.08)';
  if (state.tone === 'blocked') return 'rgba(255,138,138,0.08)';
  return 'rgba(255,179,71,0.08)';
}

function summaryStatusLabel(status: CurrentVideoSummaryResult['status']): string {
  switch (status) {
    case 'ready':
      return '摘要可用';
    case 'no_context':
      return '无上下文';
    case 'loading':
      return '加载中';
    case 'cancelled':
      return '已取消';
    default:
      return '未知状态';
  }
}

function summaryConfidenceLabel(value: 'low' | 'medium' | 'high'): string {
  if (value === 'high') return '高';
  if (value === 'medium') return '中';
  return '低';
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '0:00';
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
