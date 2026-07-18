import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
} from '../../shared/types/current-video-context';
import type { BiliVizResponse, RequestAction } from '../../shared/types/messages';
import type { CurrentVideoSummaryResult } from '../../shared/types/current-video-summary';
import type { CurrentVideoTranscriptEvidenceState } from '../../shared/types/current-video-transcript';
import type {
  CurrentVideoSegmentRetrievalCandidate,
  CurrentVideoSegmentRetrievalResult,
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from '../../shared/types/current-video-segment-retrieval';
import type { CurrentVideoRelatedFavoritesResponse } from '../../shared/types/current-video-related-favorites';
import type {
  SmartFavoriteQaCitedVideo,
  SmartFavoriteQaResponse,
  SmartFavoriteQaSynthesisStatus,
} from '../../shared/types/favorite';
import type {
  VideoKnowledgeEvidenceSourceStatus,
  VideoKnowledgeNode,
  VideoKnowledgeResult,
} from '../../shared/types/video-knowledge';
import {
  buildCurrentVideoSubtitleDiagnostics,
  type CurrentVideoSubtitleDiagnostics,
} from '../../shared/current-video-subtitle-diagnostics';
import {
  buildCurrentVideoPrimaryTextState,
  type CurrentVideoPrimaryTextSourceOption,
} from '../../shared/current-video-primary-text';

const CARD_ID = 'bdc-current-video-assistant';
const STYLE_ID = 'bdc-current-video-assistant-style';
const PRIMARY_TEXT_SELECTION_STORAGE_KEY = 'currentVideoPrimaryTextSelections';

const RAW_FIELD_PATTERN = new RegExp(
  `\\b(?:${[
    ['subtitle', '_', 'url'],
    ['source', 'Hash'],
    ['segment', 'Id'],
    ['segment', 'Ids'],
    ['candidate', 'Id'],
    ['candidate', ' id'],
    ['node', 'Id'],
    ['node', ' id'],
    ['source', 'Id'],
    ['to', 'ken'],
    ['endpoint', ' path'],
    ['Coo', 'kie'],
    ['pro', 'file'],
    ['Key', '.', 'txt'],
    ['Chrome', '\\\\', 'User Data'],
  ].map(parts => escapeRegExp(parts.join(''))).join('|')})\\b`,
  'gi',
);
const CANDIDATE_ID_PATTERN = new RegExp(
  `${escapeRegExp(['candidate', ':'].join(''))}[A-Za-z0-9:._-]+`,
  'g',
);
const TRANSCRIPT_ID_PATTERN = new RegExp(
  `${escapeRegExp(['transcript', ':'].join(''))}[A-Za-z0-9:._-]+`,
  'g',
);
const NODE_ID_PATTERN = new RegExp(
  `${escapeRegExp(['node', ':'].join(''))}[A-Za-z0-9:._-]+`,
  'g',
);
const PLAYER_ENDPOINT_PATTERN = new RegExp(
  `${escapeRegExp(['/x', '/player'].join(''))}(?:${escapeRegExp('/wbi')})?${escapeRegExp('/v2')}`,
  'gi',
);
const ENGINEERING_VISIBLE_TERM_PATTERN = /\b(?:fallback|transcript|confidence)\b/gi;
const PAGE_BODY_TEXT_PATTERN = new RegExp(['正文', '文本'].join(''), 'g');

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
  width: min(440px, calc(100vw - 36px));
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
#${CARD_ID} .bdc-assistant-section-primary {
  border-color: rgba(251, 114, 153, 0.32);
  background: rgba(251, 114, 153, 0.075);
}
#${CARD_ID} .bdc-assistant-section-auxiliary {
  background: rgba(255, 255, 255, 0.040);
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
#${CARD_ID} .bdc-assistant-source-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
#${CARD_ID} .bdc-assistant-source-card {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(10, 12, 21, 0.46);
  padding: 9px;
}
#${CARD_ID} .bdc-assistant-source-card-active {
  border-color: rgba(160, 231, 160, 0.32);
  background: rgba(160, 231, 160, 0.075);
}
#${CARD_ID} .bdc-assistant-source-card-viewing {
  border-color: rgba(127, 219, 255, 0.34);
}
#${CARD_ID} .bdc-assistant-source-title {
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-source-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
#${CARD_ID} .bdc-assistant-status {
  color: #c8e6ff;
  font-size: 11px;
  line-height: 1.45;
  margin-top: 7px;
}
#${CARD_ID} .bdc-assistant-search-form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
}
#${CARD_ID} .bdc-assistant-search-input {
  min-width: 0;
  width: 100%;
  min-height: 56px;
  flex: 1 1 auto;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(10, 12, 21, 0.72);
  color: #f4f7fb;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  padding: 9px 10px;
  resize: vertical;
}
#${CARD_ID} .bdc-assistant-search-input::placeholder {
  color: #747d90;
}
#${CARD_ID} .bdc-assistant-search-input:focus {
  border-color: rgba(251, 114, 153, 0.55);
  outline: none;
}
#${CARD_ID} .bdc-assistant-retrieval-status {
  font-size: 11px;
  line-height: 1.5;
  margin-top: 8px;
  overflow-wrap: anywhere;
}
#${CARD_ID} .bdc-assistant-answer-card {
  margin-top: 8px;
  border: 1px solid rgba(160, 231, 160, 0.20);
  border-radius: 8px;
  background: rgba(160, 231, 160, 0.07);
  padding: 9px;
}
#${CARD_ID} .bdc-assistant-answer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #a0e7a0;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-answer-text {
  margin-top: 6px;
  color: #f1f5ff;
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
#${CARD_ID} .bdc-assistant-citation-title {
  margin-top: 10px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
#${CARD_ID} .bdc-assistant-candidate-card {
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 8px;
  background: rgba(10, 12, 21, 0.50);
  padding: 9px;
}
#${CARD_ID} .bdc-assistant-candidate-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
#${CARD_ID} .bdc-assistant-candidate-title {
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-candidate-strength {
  flex: 0 0 auto;
  color: #a0e7a0;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.35;
  text-align: right;
}
#${CARD_ID} .bdc-assistant-candidate-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}
#${CARD_ID} .bdc-assistant-candidate-evidence {
  margin-top: 7px;
  color: #dbe2ef;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
#${CARD_ID} .bdc-assistant-candidate-reasons {
  margin: 7px 0 0;
  padding-left: 16px;
  color: #c8e6ff;
  font-size: 11px;
  line-height: 1.45;
}
#${CARD_ID} .bdc-assistant-candidate-reasons li {
  margin-top: 3px;
}
#${CARD_ID} .bdc-assistant-jump-status {
  margin-top: 8px;
  border: 1px solid rgba(127, 219, 255, 0.22);
  border-radius: 8px;
  background: rgba(127, 219, 255, 0.07);
  color: #c8e6ff;
  font-size: 11px;
  line-height: 1.5;
  padding: 8px;
  overflow-wrap: anywhere;
}
#${CARD_ID} .bdc-assistant-jump-preview {
  margin-top: 8px;
  border: 1px solid rgba(255, 179, 71, 0.30);
  border-radius: 8px;
  background: rgba(255, 179, 71, 0.08);
  padding: 8px;
}
#${CARD_ID} .bdc-assistant-jump-preview-title {
  color: #ffcf8a;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.35;
}
#${CARD_ID} .bdc-assistant-jump-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
#${CARD_ID} .bdc-assistant-button-warn {
  border-color: rgba(255, 179, 71, 0.42);
  background: #ffb347;
  color: #1f2433;
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
    right: 18px;
    bottom: 76px;
  }
  #${CARD_ID}.bdc-assistant-collapsed {
    width: calc(100vw - 36px);
  }
  #${CARD_ID}.bdc-assistant-expanded {
    top: 52px;
    bottom: 88px;
    width: calc(100vw - 36px);
  }
  #${CARD_ID} .bdc-assistant-body {
    padding: 9px;
  }
  #${CARD_ID} .bdc-assistant-header {
    padding: 9px 10px;
  }
  #${CARD_ID} .bdc-assistant-answer-head,
  #${CARD_ID} .bdc-assistant-candidate-head,
  #${CARD_ID} .bdc-assistant-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  #${CARD_ID} .bdc-assistant-row span:last-child {
    text-align: left;
  }
  #${CARD_ID} .bdc-assistant-search-form .bdc-assistant-button {
    width: 100%;
  }
}
@media (max-height: 520px) {
  #${CARD_ID}.bdc-assistant-expanded {
    top: 44px;
    bottom: 64px;
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
  knowledge: VideoKnowledgeResult | null;
  knowledgeContextKey: string;
  knowledgeLoading: boolean;
  knowledgeError: string | null;
  knowledgeRequestId: number;
  segmentQuery: string;
  segmentResult: CurrentVideoSegmentRetrievalResult | null;
  segmentContextKey: string;
  segmentLoading: boolean;
  segmentError: string | null;
  segmentRequestId: number;
  segmentPreviewCandidateId: string | null;
  segmentJumpStatus: string | null;
  segmentJumpLoading: boolean;
  segmentReturnAvailable: boolean;
  segmentReturnLoading: boolean;
  relatedFavorites: CurrentVideoRelatedFavoritesResponse | null;
  relatedFavoritesContextKey: string;
  relatedFavoritesLoading: boolean;
  relatedFavoritesError: string | null;
  relatedFavoritesRequestId: number;
  primaryTextViewingSourceIdentityKey: string | null;
  primaryTextStatus: string | null;
  primaryTextSaving: boolean;
  subtitleRefreshing: boolean;
  subtitleStatus: string | null;
  subtitleRequestId: number;
}

const primaryTextSelections = new Map<string, string>();
let primaryTextSelectionsLoaded = false;
let primaryTextSelectionsLoading = false;

const assistantState: AssistantState = {
  expanded: false,
  context: null,
  contextKey: '',
  summary: null,
  summaryContextKey: '',
  summaryLoading: false,
  summaryError: null,
  summaryRequestId: 0,
  knowledge: null,
  knowledgeContextKey: '',
  knowledgeLoading: false,
  knowledgeError: null,
  knowledgeRequestId: 0,
  segmentQuery: '',
  segmentResult: null,
  segmentContextKey: '',
  segmentLoading: false,
  segmentError: null,
  segmentRequestId: 0,
  segmentPreviewCandidateId: null,
  segmentJumpStatus: null,
  segmentJumpLoading: false,
  segmentReturnAvailable: false,
  segmentReturnLoading: false,
  relatedFavorites: null,
  relatedFavoritesContextKey: '',
  relatedFavoritesLoading: false,
  relatedFavoritesError: null,
  relatedFavoritesRequestId: 0,
  primaryTextViewingSourceIdentityKey: null,
  primaryTextStatus: null,
  primaryTextSaving: false,
  subtitleRefreshing: false,
  subtitleStatus: null,
  subtitleRequestId: 0,
};

export function renderCurrentVideoAssistant(context: CurrentVideoContextResult): void {
  injectStyle();
  ensurePrimaryTextSelectionsLoaded();
  updateAssistantContext(context);
  renderAssistantShell();
}

function updateAssistantContext(context: CurrentVideoContextResult): void {
  const nextKey = contextStateKey(context);
  if (assistantState.contextKey !== nextKey) {
    assistantState.summary = null;
    assistantState.summaryContextKey = '';
    assistantState.summaryError = null;
    assistantState.knowledge = null;
    assistantState.knowledgeContextKey = '';
    assistantState.knowledgeError = null;
    assistantState.knowledgeLoading = false;
    assistantState.segmentResult = null;
    assistantState.segmentContextKey = '';
    assistantState.segmentError = null;
    assistantState.segmentPreviewCandidateId = null;
    assistantState.segmentJumpStatus = null;
    assistantState.segmentJumpLoading = false;
    assistantState.segmentReturnAvailable = false;
    assistantState.segmentReturnLoading = false;
    assistantState.relatedFavorites = null;
    assistantState.relatedFavoritesContextKey = '';
    assistantState.relatedFavoritesError = null;
    assistantState.relatedFavoritesLoading = false;
    assistantState.primaryTextViewingSourceIdentityKey = null;
    assistantState.primaryTextStatus = null;
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
  });
  actions.appendChild(expand);
  header.appendChild(actions);
  card.appendChild(header);

  const status = document.createElement('div');
  status.className = 'bdc-assistant-compact-status';
  if (assistantState.context?.kind === 'video') {
    appendText(status, 'div', 'bdc-assistant-video-title', assistantState.context.title ?? '当前视频');
  }
  appendText(status, 'div', 'bdc-assistant-muted', '先确认当前分 P 的可用文本来源；没有正文时请手动开启中文 AI 字幕后重新检测。');
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
  appendText(brand, 'div', 'bdc-assistant-subtitle', '确认当前分 P 的主要文本来源');
  header.appendChild(brand);

  const actions = document.createElement('div');
  actions.className = 'bdc-assistant-actions';
  actions.appendChild(button('重新检测字幕', 'bdc-assistant-button bdc-assistant-button-quiet', () => {
    void refreshSubtitleEvidenceFromPage();
  }, assistantState.subtitleRefreshing || assistantState.context?.kind !== 'video'));
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
    appendSubtitleDiagnostics(body, context);
    appendVideoIdentity(body, context);
    appendPrimaryTextSourceSwitcher(body, context);
    appendSegmentSearch(body, context);
  } else {
    const empty = section('当前视频');
    appendText(empty, 'div', 'bdc-assistant-video-title', '没有当前视频上下文');
    appendText(empty, 'div', 'bdc-assistant-muted', '请在 B 站视频页使用当前视频助手。');
    body.appendChild(empty);
  }

  const footer = section('全局入口', 'bdc-assistant-section-auxiliary');
  appendText(footer, 'div', 'bdc-assistant-muted', '全局总览用于长期视图；当前切片只确认视频文本来源，不会自动发送完整文本请求。');
  footer.appendChild(dashboardLink('打开全局总览'));
  body.appendChild(footer);

  panel.appendChild(body);
  root.appendChild(panel);
}

function appendVideoIdentity(parent: HTMLElement, context: CurrentVideoContext): void {
  const block = section('视频与文字来源', 'bdc-assistant-section-auxiliary');
  appendText(block, 'div', 'bdc-assistant-video-title', context.title ?? context.bvid);

  const pills = document.createElement('div');
  pills.className = 'bdc-assistant-pills';
  pills.appendChild(pill('视频页已识别', Boolean(context.bvid)));
  pills.appendChild(pill(context.cid ? '当前分 P 已识别' : '等待分 P 信息', Boolean(context.cid)));
  pills.appendChild(pill(`字幕正文 ${availabilityLabel(context.transcriptEvidence?.active ? 'available' : 'unavailable')}`, Boolean(context.transcriptEvidence?.active)));
  block.appendChild(pills);

  appendRow(block, '当前分 P', `第 ${context.currentPart.page}${context.currentPart.total ? ` / ${context.currentPart.total} P` : ' P'}`);
  appendRow(block, '主要文本来源', primaryTextSourceLabel(context));
  appendRow(block, '字幕轨道', availabilityLabel(context.sources.transcript));
  appendRow(block, '字幕正文', transcriptEvidenceLabel(context));
  parent.appendChild(block);
}

function appendPrimaryTextSourceSwitcher(parent: HTMLElement, context: CurrentVideoContext): void {
  const block = section('主要文本来源', 'bdc-assistant-section-auxiliary');
  const sourceState = buildPrimaryTextStateForContext(context);
  appendText(block, 'div', 'bdc-assistant-subtitle-text', sourceState.state.userMessage);
  appendText(block, 'div', 'bdc-assistant-subtitle-detail', sourceState.state.action);

  if (!primaryTextSelectionsLoaded) {
    appendText(block, 'div', 'bdc-assistant-status', '正在读取本页已保存的来源选择...');
  }
  if (assistantState.primaryTextStatus) {
    appendText(block, 'div', 'bdc-assistant-status', assistantState.primaryTextStatus);
  }

  const list = document.createElement('div');
  list.className = 'bdc-assistant-source-list';
  if (sourceState.sources.length === 0) {
    appendText(list, 'div', 'bdc-assistant-muted', '当前还没有可查看的正文来源。');
  }
  for (const source of sourceState.sources) {
    list.appendChild(primaryTextSourceCard(context, source, sourceState.activeSourceIdentityKey));
  }
  list.appendChild(localTranscriptPreparationCard());
  block.appendChild(list);
  parent.appendChild(block);
}

function buildPrimaryTextStateForContext(context: CurrentVideoContext): {
  sources: CurrentVideoPrimaryTextSourceOption[];
  state: ReturnType<typeof buildCurrentVideoPrimaryTextState>;
  selectedSourceIdentityKey: string | null;
  activeSourceIdentityKey: string | null;
} {
  const sources = availablePrimaryTextSources(context);
  const selectedSourceIdentityKey = selectedPrimaryTextSourceIdentityKey(context);
  const state = buildCurrentVideoPrimaryTextState({
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
    sources,
    selectedSourceIdentityKey,
  });
  return {
    sources: state.sources,
    state,
    selectedSourceIdentityKey,
    activeSourceIdentityKey: state.primarySource?.identity.sourceIdentityKey ?? null,
  };
}

function availablePrimaryTextSources(context: CurrentVideoContext): CurrentVideoPrimaryTextSourceOption[] {
  const evidence = context.transcriptEvidence;
  if (
    context.cid
    && evidence?.active
    && evidence.source === 'bilibili_subtitle'
    && evidence.sourceIdentityKey
    && evidence.sourceHash
    && evidence.bodyHash
    && evidence.timelineHash
  ) {
    return [{
      identity: {
        bvid: context.bvid,
        cid: context.cid,
        page: context.currentPart.page,
        source: 'bilibili_subtitle',
        sourceType: evidence.sourceType,
        language: evidence.language,
        bodyHash: evidence.bodyHash,
        timelineHash: evidence.timelineHash,
        sourceHash: evidence.sourceHash,
        sourceIdentityKey: evidence.sourceIdentityKey,
        lineCount: evidence.segmentCount,
      },
      label: 'B站字幕',
      status: evidence.temporary ? 'temporary' : 'available',
      lineCount: evidence.segmentCount,
      byteSize: evidence.serializedBytes ?? 0,
      temporary: evidence.temporary === true,
      selectedByUser: selectedPrimaryTextSourceIdentityKey(context) === evidence.sourceIdentityKey,
    }];
  }
  return [];
}

function primaryTextSourceCard(
  context: CurrentVideoContext,
  source: CurrentVideoPrimaryTextSourceOption,
  activeSourceIdentityKey: string | null,
): HTMLElement {
  const viewingKey = assistantState.primaryTextViewingSourceIdentityKey;
  const isActive = activeSourceIdentityKey === source.identity.sourceIdentityKey;
  const isSelectedByUser = selectedPrimaryTextSourceIdentityKey(context) === source.identity.sourceIdentityKey;
  const isViewing = viewingKey === source.identity.sourceIdentityKey;
  const card = document.createElement('article');
  card.className = [
    'bdc-assistant-source-card',
    isActive ? 'bdc-assistant-source-card-active' : '',
    isViewing ? 'bdc-assistant-source-card-viewing' : '',
  ].filter(Boolean).join(' ');

  appendText(card, 'div', 'bdc-assistant-source-title', source.label);
  appendText(card, 'div', 'bdc-assistant-subtitle-detail', primaryTextSourceDescription(source));
  appendText(card, 'div', 'bdc-assistant-muted', isSelectedByUser
    ? '已由你明确设为当前视频助手来源。'
    : isActive
      ? '当前可用于助手；点击“用于视频助手”后会记住这个选择。'
      : '查看这个来源不会改变主要文本来源。');

  const actions = document.createElement('div');
  actions.className = 'bdc-assistant-source-actions';
  actions.appendChild(button(
    isViewing ? '正在查看' : '查看来源',
    'bdc-assistant-button bdc-assistant-button-quiet',
    () => {
      assistantState.primaryTextViewingSourceIdentityKey = source.identity.sourceIdentityKey;
      assistantState.primaryTextStatus = '已切换查看的来源；主要文本来源没有改变。';
      renderAssistantShell();
    },
    isViewing,
  ));
  actions.appendChild(button(
    assistantState.primaryTextSaving && isActive ? '保存中...' : isSelectedByUser ? '已用于助手' : '用于视频助手',
    isSelectedByUser
      ? 'bdc-assistant-button bdc-assistant-button-quiet'
      : 'bdc-assistant-button bdc-assistant-button-primary',
    () => {
      void selectPrimaryTextSourceForAssistant(context, source.identity.sourceIdentityKey, source.label);
    },
    assistantState.primaryTextSaving || isSelectedByUser,
  ));
  card.appendChild(actions);
  return card;
}

function localTranscriptPreparationCard(): HTMLElement {
  const card = document.createElement('article');
  card.className = 'bdc-assistant-source-card';
  appendText(card, 'div', 'bdc-assistant-source-title', '本地转录');
  appendText(
    card,
    'div',
    'bdc-assistant-subtitle-detail',
    '转录模型尚未接入，当前只保留准备态；不会把未生成的转录稿当作可用正文。',
  );
  const actions = document.createElement('div');
  actions.className = 'bdc-assistant-source-actions';
  actions.appendChild(button('暂不可用', 'bdc-assistant-button bdc-assistant-button-quiet', () => {}, true));
  card.appendChild(actions);
  return card;
}

function primaryTextSourceDescription(source: CurrentVideoPrimaryTextSourceOption): string {
  const size = source.byteSize > 0 ? `，约 ${formatByteSize(source.byteSize)}` : '';
  if (source.temporary) {
    return `本次临时使用的字幕正文，${source.lineCount} 条${size}；离开页面或服务重载后可能需要重新检测。`;
  }
  return `当前分 P 可用字幕正文，${source.lineCount} 条${size}。`;
}

async function selectPrimaryTextSourceForAssistant(
  context: CurrentVideoContext,
  sourceIdentityKey: string,
  label: string,
): Promise<void> {
  const partKey = primaryTextPartKey(context);
  if (!partKey) return;
  primaryTextSelections.set(partKey, sourceIdentityKey);
  updateAssistantContext(context);
  assistantState.primaryTextSaving = true;
  assistantState.primaryTextViewingSourceIdentityKey = sourceIdentityKey;
  assistantState.primaryTextStatus = `${label}已用于当前视频助手。`;
  renderAssistantShell();

  try {
    await savePrimaryTextSelections();
    assistantState.primaryTextStatus = `${label}已用于当前视频助手。`;
  } catch {
    assistantState.primaryTextStatus = `${label}已在本页用于当前视频助手；保存选择失败，刷新页面后可能需要重新选择。`;
  } finally {
    assistantState.primaryTextSaving = false;
    renderAssistantShell();
  }
}

function appendSubtitleDiagnostics(parent: HTMLElement, context: CurrentVideoContext): void {
  const diagnostics = buildCurrentVideoSubtitleDiagnostics(context, {
    refreshing: assistantState.subtitleRefreshing,
  });
  const block = section('辅助：字幕正文状态', 'bdc-assistant-section-auxiliary');
  const box = document.createElement('div');
  box.className = 'bdc-assistant-subtitle-box';
  box.style.border = `1px solid ${subtitleDiagnosticsBorder(diagnostics)}`;
  box.style.background = subtitleDiagnosticsBackground(diagnostics);

  const title = document.createElement('div');
  title.className = 'bdc-assistant-subtitle-title';
  title.style.color = subtitleDiagnosticsColor(diagnostics);
  title.textContent = safeVisibleText(diagnostics.title);
  box.appendChild(title);

  appendText(box, 'div', 'bdc-assistant-subtitle-text', safeVisibleText(summarySubtitleMessage(context, diagnostics)));
  appendText(box, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(summarySubtitleAction(context, diagnostics)));

  appendText(
    box,
    'div',
    'bdc-assistant-subtitle-detail',
    safeVisibleText(context.transcriptEvidence?.active
      ? '主要文本：B站字幕正文已可用；后续完整文本请求仍需用户主动触发。'
      : '主要文本：尚未取得正文；不会把可能存在的字幕或轨道当作正文。'),
  );

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
    appendText(box, 'div', 'bdc-assistant-status', safeVisibleText(assistantState.subtitleStatus));
  }

  block.appendChild(box);
  parent.appendChild(block);
}

function appendSegmentSearch(parent: HTMLElement, context: CurrentVideoContext): void {
  const block = section('问这个视频', 'bdc-assistant-section-primary');
  appendText(block, 'div', 'bdc-assistant-video-title', context.title ?? '当前视频');
  appendText(
    block,
    'div',
    'bdc-assistant-muted',
    '问这个视频，或描述想跳到的片段。助手会先回答，再列出引用片段和手动跳转操作。',
  );

  const form = document.createElement('div');
  form.className = 'bdc-assistant-search-form';

  const input = document.createElement('textarea');
  input.className = 'bdc-assistant-search-input';
  input.rows = 2;
  input.maxLength = 120;
  input.placeholder = '问这个视频，或描述想跳到的片段';
  input.value = assistantState.segmentQuery;
  input.setAttribute('aria-label', '问这个视频，或描述想跳到的片段');
  input.addEventListener('input', () => {
    assistantState.segmentQuery = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void searchCurrentVideoSegmentsFromPage();
    }
  });
  form.appendChild(input);

  form.appendChild(button(
    assistantState.segmentLoading ? '回答中...' : '提问',
    'bdc-assistant-button bdc-assistant-button-primary',
    () => {
      void searchCurrentVideoSegmentsFromPage();
    },
    assistantState.segmentLoading || !context.bvid,
  ));
  block.appendChild(form);

  if (!context.transcriptEvidence?.active) {
    appendText(
      block,
      'div',
      'bdc-assistant-subtitle-detail',
      '提示：完整回答通常需要字幕正文；没有当前视频本地证据时，不会猜答案或时间点。',
    );
  }

  if (assistantState.segmentError) {
    const error = appendText(block, 'div', 'bdc-assistant-retrieval-status', assistantState.segmentError);
    error.style.color = '#ffcf8a';
  }

  if (assistantState.segmentLoading) {
    const loading = appendText(block, 'div', 'bdc-assistant-retrieval-status', '正在基于当前视频证据回答...');
    loading.style.color = '#c8e6ff';
  }

  if (
    assistantState.segmentResult
    && assistantState.segmentContextKey === assistantState.contextKey
  ) {
    appendSegmentRetrievalResult(block, assistantState.segmentResult, context);
  }

  parent.appendChild(block);
}

function appendRelatedFavorites(parent: HTMLElement, context: CurrentVideoContext): void {
  const block = section('相关收藏');
  const head = block.querySelector('.bdc-assistant-section-head');
  const hasFreshResult = Boolean(
    assistantState.relatedFavorites
    && assistantState.relatedFavoritesContextKey === assistantState.contextKey,
  );
  head?.appendChild(button(
    assistantState.relatedFavoritesLoading
      ? '查找中...'
      : hasFreshResult
        ? '刷新相关收藏'
        : '查找相关收藏',
    hasFreshResult
      ? 'bdc-assistant-button bdc-assistant-button-quiet'
      : 'bdc-assistant-button bdc-assistant-button-primary',
    () => {
      void loadCurrentVideoRelatedFavoritesFromPage(true);
    },
    assistantState.relatedFavoritesLoading || !context.bvid,
  ));

  appendText(
    block,
    'div',
    'bdc-assistant-muted',
    '来自当前已同步收藏，只作为延伸阅读；上方当前视频回答仍只引用当前视频字幕或本地节点证据。',
  );

  if (assistantState.relatedFavoritesError) {
    const error = appendText(block, 'div', 'bdc-assistant-retrieval-status', assistantState.relatedFavoritesError);
    error.style.color = '#ffcf8a';
  }

  if (assistantState.relatedFavoritesLoading) {
    const loading = appendText(block, 'div', 'bdc-assistant-retrieval-status', '正在用当前视频线索查找已同步收藏...');
    loading.style.color = '#c8e6ff';
  }

  if (!hasFreshResult) {
    appendText(
      block,
      'div',
      'bdc-assistant-subtitle-detail',
      '会使用当前视频标题、UP、简介摘要，以及你在上方输入的问题作为线索；不会读取完整收藏库、历史、关注或本地敏感文件。',
    );
    parent.appendChild(block);
    return;
  }

  appendRelatedFavoritesResult(block, assistantState.relatedFavorites as CurrentVideoRelatedFavoritesResponse);
  parent.appendChild(block);
}

function appendRelatedFavoritesResult(
  parent: HTMLElement,
  result: CurrentVideoRelatedFavoritesResponse,
): void {
  const qa = result.favorites;
  if (result.status !== 'ready' || !qa) {
    const status = appendText(parent, 'div', 'bdc-assistant-retrieval-status', safeVisibleText(result.limitations[0] ?? '当前没有可用的相关收藏线索。'));
    status.style.color = '#ffcf8a';
    return;
  }

  const status = appendText(
    parent,
    'div',
    'bdc-assistant-retrieval-status',
    safeVisibleText(relatedFavoritesNotice(qa)),
  );
  status.style.color = relatedFavoritesStatusColor(qa);

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-candidate-meta';
  appendBadge(meta, '来源：当前已同步收藏');
  appendBadge(meta, `引用收藏 ${qa.citedVideos.length} 条`);
  if (result.hintSourceLabels.length > 0) {
    appendBadge(meta, `线索：${result.hintSourceLabels.slice(0, 3).join('、')}`);
  }
  appendBadge(meta, `AI ${relatedFavoritesAiStatusLabel(qa.synthesis?.status)}`);
  parent.appendChild(meta);

  const coverage = relatedFavoritesCoverageNotice(qa);
  if (coverage) {
    appendText(parent, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(coverage));
  }

  if (qa.citedVideos.length === 0) {
    appendText(parent, 'div', 'bdc-assistant-answer-text', safeVisibleText(qa.answer));
    appendRelatedFavoritesLimitations(parent, result, qa);
    appendRelatedFavoritesSettingsLink(parent, qa);
    return;
  }

  const list = document.createElement('div');
  list.className = 'bdc-assistant-candidate-list';
  for (const [index, video] of qa.citedVideos.slice(0, 5).entries()) {
    list.appendChild(relatedFavoriteCard(video, index));
  }
  parent.appendChild(list);
  appendRelatedFavoritesLimitations(parent, result, qa);
  appendRelatedFavoritesSettingsLink(parent, qa);
}

function relatedFavoriteCard(video: SmartFavoriteQaCitedVideo, index: number): HTMLElement {
  const card = document.createElement('article');
  card.className = 'bdc-assistant-candidate-card';

  const head = document.createElement('div');
  head.className = 'bdc-assistant-candidate-head';
  appendText(head, 'div', 'bdc-assistant-candidate-title', `收藏 ${index + 1} · ${safeVisibleText(video.title)}`);
  appendText(
    head,
    'div',
    'bdc-assistant-candidate-strength',
    `证据强度 ${relatedFavoriteConfidenceLabel(video.confidence)}`,
  );
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-candidate-meta';
  if (video.authorName) appendBadge(meta, `UP ${safeVisibleText(video.authorName)}`);
  if (video.folderTitle) appendBadge(meta, `收藏夹 ${safeVisibleText(video.folderTitle)}`);
  if (video.smartPath.length > 0) appendBadge(meta, `智能路径 ${safeVisibleText(video.smartPath.slice(0, 3).join(' / '))}`);
  card.appendChild(meta);

  appendText(card, 'div', 'bdc-assistant-candidate-evidence', safeVisibleText(video.evidence));

  if (video.matchReasons.length > 0) {
    const reasons = document.createElement('ul');
    reasons.className = 'bdc-assistant-candidate-reasons';
    for (const reason of video.matchReasons.slice(0, 3)) {
      const item = document.createElement('li');
      item.textContent = safeVisibleText(reason);
      reasons.appendChild(item);
    }
    card.appendChild(reasons);
  }

  if (video.link) {
    const link = document.createElement('a');
    link.className = 'bdc-assistant-link bdc-assistant-button-quiet';
    link.href = video.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '打开收藏视频';
    card.appendChild(link);
  }

  return card;
}

function appendRelatedFavoritesLimitations(
  parent: HTMLElement,
  result: CurrentVideoRelatedFavoritesResponse,
  qa: SmartFavoriteQaResponse,
): void {
  const notes = [
    ...result.limitations,
    ...qa.status.notes.slice(0, 2),
  ].map(safeVisibleText);
  if (notes.length > 0) {
    appendText(parent, 'div', 'bdc-assistant-subtitle-detail', notes.join(' '));
  }
}

function appendRelatedFavoritesSettingsLink(parent: HTMLElement, qa: SmartFavoriteQaResponse): void {
  if (needsAiSettingsLink(qa.synthesis?.status ?? '')) {
    parent.appendChild(dashboardLink('前往设置', '#settings'));
  }
}

function appendSegmentRetrievalResult(
  parent: HTMLElement,
  result: CurrentVideoSegmentRetrievalResult,
  context: CurrentVideoContext,
): void {
  const queryRewrite = result.queryRewrite ?? {
    expanded: false,
    visibleExpandedTerms: [],
  };
  const status = appendText(
    parent,
    'div',
    'bdc-assistant-retrieval-status',
    safeVisibleText(segmentRetrievalStatusMessage(result, context)),
  );
  status.style.color = segmentRetrievalStatusColor(result);

  appendCurrentVideoQaAnswer(parent, result);
  appendSegmentJumpStatus(parent);

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-candidate-meta';
  appendBadge(meta, result.evidenceState.transcriptSegmentCount > 0
    ? `字幕证据 ${result.evidenceState.transcriptSegmentCount} 条`
    : '字幕证据未就绪');
  if (result.evidenceState.timedKnowledgeNodeCount > 0) {
    appendBadge(meta, `本地节点 ${result.evidenceState.timedKnowledgeNodeCount} 条`);
  }
  appendBadge(meta, result.evidenceState.contextFresh ? '当前视频上下文有效' : '上下文需刷新');
  if (queryRewrite.expanded) {
    appendBadge(meta, '已扩展相关表达');
  }
  parent.appendChild(meta);

  if (queryRewrite.expanded && queryRewrite.visibleExpandedTerms.length > 0) {
    appendText(
      parent,
      'div',
      'bdc-assistant-muted',
      safeVisibleText(`已扩展相关表达：${queryRewrite.visibleExpandedTerms.slice(0, 6).join('、')}`),
    );
  }

  if (result.candidates.length === 0) {
    appendSegmentLimitations(parent, result);
    return;
  }

  const citedCandidateIds = new Set(result.qa.citedSegments.map(segment => segment.candidateId));
  const displayCandidates = citedCandidateIds.size > 0
    ? result.candidates.filter(candidate => citedCandidateIds.has(candidate.id))
    : result.candidates;
  appendText(
    parent,
    'div',
    'bdc-assistant-citation-title',
    citedCandidateIds.size > 0 ? '引用片段' : '候选片段',
  );
  const list = document.createElement('div');
  list.className = 'bdc-assistant-candidate-list';
  for (const [index, candidate] of displayCandidates.slice(0, 5).entries()) {
    list.appendChild(segmentCandidateCard(
      candidate,
      index,
      result,
      citedCandidateIds.size > 0 ? '引用' : '候选',
    ));
  }
  parent.appendChild(list);
  appendSegmentLimitations(parent, result);
}

function appendCurrentVideoQaAnswer(
  parent: HTMLElement,
  result: CurrentVideoSegmentRetrievalResult,
): void {
  const card = document.createElement('div');
  card.className = 'bdc-assistant-answer-card';
  card.style.borderColor = qaStatusColor(result.qa.status);

  const head = document.createElement('div');
  head.className = 'bdc-assistant-answer-head';
  head.style.color = qaStatusColor(result.qa.status);
  appendText(head, 'span', '', `回答：${qaStatusLabel(result.qa.status)}`);
  appendText(head, 'span', '', `引用 ${result.qa.citedSegments.length} 条`);
  card.appendChild(head);

  appendText(card, 'div', 'bdc-assistant-answer-text', safeVisibleText(result.qa.answer));

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-candidate-meta';
  appendBadge(meta, qaSourceStateLabel(result));
  appendBadge(meta, `引用片段 ${result.qa.citedSegments.length} 条`);
  appendBadge(meta, result.qa.aiState.status === 'generated' ? '已整理回答' : '本地证据回答');
  card.appendChild(meta);

  if (result.qa.citedSegments.length === 0 && result.qa.limitations.length > 0) {
    appendText(card, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(result.qa.limitations[0]));
  }
  if (needsAiSettingsLink(result.qa.aiState.status)) {
    appendText(card, 'div', 'bdc-assistant-subtitle-detail', '当前答案来自本地证据；需要额外整理时，可先完成设置。');
    card.appendChild(dashboardLink('打开设置', '#settings'));
  }

  parent.appendChild(card);
}

function segmentCandidateCard(
  candidate: CurrentVideoSegmentRetrievalCandidate,
  index: number,
  result: CurrentVideoSegmentRetrievalResult,
  titlePrefix = '候选',
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'bdc-assistant-candidate-card';

  const head = document.createElement('div');
  head.className = 'bdc-assistant-candidate-head';
  appendText(head, 'div', 'bdc-assistant-candidate-title', `${titlePrefix} ${index + 1} · ${safeVisibleText(candidate.timeRangeLabel)}`);
  appendText(
    head,
    'div',
    'bdc-assistant-candidate-strength',
    `匹配 ${candidate.confidenceLabel} ${formatPercent(candidate.confidence)}`,
  );
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-candidate-meta';
  appendBadge(meta, safeVisibleText(candidate.sourceLabel));
  appendBadge(meta, segmentCandidateSourceStatus(candidate, result));
  card.appendChild(meta);

  appendText(card, 'div', 'bdc-assistant-candidate-evidence', safeVisibleText(candidate.evidenceText));

  if (candidate.matchReasons.length > 0) {
    const reasons = document.createElement('ul');
    reasons.className = 'bdc-assistant-candidate-reasons';
    for (const reason of candidate.matchReasons.slice(0, 3)) {
      const item = document.createElement('li');
      item.textContent = safeVisibleText(reason);
      reasons.appendChild(item);
    }
    card.appendChild(reasons);
  }

  if (candidate.note) {
    appendText(card, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(candidate.note));
  }

  appendSegmentJumpControls(card, candidate, result);

  return card;
}

function appendSegmentJumpStatus(parent: HTMLElement): void {
  if (!assistantState.segmentJumpStatus && !assistantState.segmentReturnAvailable) return;

  const status = document.createElement('div');
  status.className = 'bdc-assistant-jump-status';
  appendText(
    status,
    'div',
    'bdc-assistant-jump-preview-title',
    '跳转状态',
  );
  appendText(
    status,
    'div',
    '',
    safeVisibleText(assistantState.segmentJumpStatus ?? '已记录跳转前位置，可返回原位置。'),
  );

  if (assistantState.segmentReturnAvailable) {
    const actions = document.createElement('div');
    actions.className = 'bdc-assistant-jump-actions';
    actions.appendChild(button(
      assistantState.segmentReturnLoading ? '返回中...' : '返回原位置',
      'bdc-assistant-button bdc-assistant-button-warn',
      () => {
        void returnCurrentVideoSegmentJumpFromPage();
      },
      assistantState.segmentReturnLoading,
    ));
    status.appendChild(actions);
  }

  parent.appendChild(status);
}

function appendSegmentJumpControls(
  parent: HTMLElement,
  candidate: CurrentVideoSegmentRetrievalCandidate,
  result: CurrentVideoSegmentRetrievalResult,
): void {
  const preview = candidate.jumpPreview;
  const selected = assistantState.segmentPreviewCandidateId === candidate.id;
  const controls = document.createElement('div');
  controls.className = 'bdc-assistant-jump-actions';

  controls.appendChild(button(
    preview.canJump ? (selected ? '收起预览' : '预览跳转') : '不可跳转',
    preview.canJump
      ? 'bdc-assistant-button bdc-assistant-button-quiet'
      : 'bdc-assistant-button bdc-assistant-button-quiet',
    () => {
      if (!preview.canJump) return;
      assistantState.segmentPreviewCandidateId = selected ? null : candidate.id;
      assistantState.segmentJumpStatus = selected ? assistantState.segmentJumpStatus : null;
      renderAssistantShell();
    },
    !preview.canJump,
  ));
  parent.appendChild(controls);

  if (!preview.canJump) {
    appendText(parent, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(preview.message));
    return;
  }

  appendText(
    parent,
    'div',
    'bdc-assistant-subtitle-detail',
    `可预览目标时间 ${safeVisibleText(preview.targetTimeLabel ?? candidate.timeRangeLabel)}；预览不会改变播放位置。`,
  );

  if (selected) {
    parent.appendChild(segmentJumpPreviewPanel(candidate, result));
  }
}

function segmentJumpPreviewPanel(
  candidate: CurrentVideoSegmentRetrievalCandidate,
  result: CurrentVideoSegmentRetrievalResult,
): HTMLElement {
  const preview = candidate.jumpPreview;
  const panel = document.createElement('div');
  panel.className = 'bdc-assistant-jump-preview';
  appendText(panel, 'div', 'bdc-assistant-jump-preview-title', '确认跳转前预览');
  appendText(
    panel,
    'div',
    'bdc-assistant-candidate-evidence',
    `目标时间：${safeVisibleText(preview.targetTimeLabel ?? candidate.timeRangeLabel)}`,
  );
  appendText(
    panel,
    'div',
    'bdc-assistant-subtitle-detail',
    `依据：${safeVisibleText(preview.sourceLabel)}；匹配 ${preview.confidenceLabel} ${formatPercent(preview.confidence)}`,
  );
  appendText(
    panel,
    'div',
    'bdc-assistant-candidate-evidence',
    `证据预览：${safeVisibleText(preview.evidencePreview || candidate.evidenceText)}`,
  );
  appendText(panel, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(preview.message));

  const actions = document.createElement('div');
  actions.className = 'bdc-assistant-jump-actions';
  actions.appendChild(button(
    assistantState.segmentJumpLoading ? '确认中...' : '确认跳转',
    'bdc-assistant-button bdc-assistant-button-warn',
    () => {
      void confirmCurrentVideoSegmentJumpFromPage(candidate, result);
    },
    assistantState.segmentJumpLoading || !preview.canJump,
  ));
  actions.appendChild(button(
    '取消',
    'bdc-assistant-button bdc-assistant-button-quiet',
    () => {
      assistantState.segmentPreviewCandidateId = null;
      renderAssistantShell();
    },
  ));
  panel.appendChild(actions);
  return panel;
}

function appendSegmentLimitations(
  parent: HTMLElement,
  result: CurrentVideoSegmentRetrievalResult,
): void {
  const limitations = segmentVisibleLimitations(result);
  if (limitations.length === 0) return;
  appendText(parent, 'div', 'bdc-assistant-subtitle-detail', limitations.join(' '));
}

function appendSummary(parent: HTMLElement): void {
  const block = section('辅助摘要', 'bdc-assistant-section-auxiliary');

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
  appendBadge(meta, summary.generationMode === 'ai' ? '已整理摘要' : '本地证据摘要');
  appendBadge(meta, `依据${summaryConfidenceLabel(summary.confidence)}`);
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

  if (needsAiSettingsLink(summary.ai.status)) {
    appendText(block, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(summary.ai.note));
    block.appendChild(dashboardLink('打开设置', '#settings'));
  }

  parent.appendChild(block);
}

function appendVideoKnowledge(parent: HTMLElement, context: CurrentVideoContext): void {
  const block = section('辅助知识节点', 'bdc-assistant-section-auxiliary');
  const head = block.querySelector('.bdc-assistant-section-head');
  head?.appendChild(button(
    assistantState.knowledgeLoading ? '刷新中...' : '刷新节点',
    'bdc-assistant-button bdc-assistant-button-quiet',
    () => {
      void loadCurrentVideoKnowledge(true);
    },
    assistantState.knowledgeLoading || !context.bvid,
  ));

  if (assistantState.knowledgeLoading) {
    appendText(block, 'div', 'bdc-assistant-muted', '正在读取当前视频知识节点...');
    parent.appendChild(block);
    return;
  }

  if (assistantState.knowledgeError) {
    appendText(block, 'div', 'bdc-assistant-subtitle-text', assistantState.knowledgeError);
    parent.appendChild(block);
    return;
  }

  const knowledge = assistantState.knowledge;
  if (!knowledge || assistantState.knowledgeContextKey !== assistantState.contextKey) {
    appendText(block, 'div', 'bdc-assistant-muted', '展开后会读取当前视频知识节点。');
    parent.appendChild(block);
    return;
  }

  const transcriptNodeCount = knowledge.nodes.filter(node => node.source === 'transcript').length;
  const status = appendText(
    block,
    'div',
    'bdc-assistant-retrieval-status',
    safeVisibleText(videoKnowledgeNotice(knowledge, transcriptNodeCount)),
  );
  status.style.color = transcriptNodeCount > 0 ? '#a0e7a0' : '#ffcf8a';

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-candidate-meta';
  appendBadge(meta, transcriptNodeCount > 0 ? `字幕节点 ${transcriptNodeCount} 条` : '暂无字幕节点');
  appendBadge(meta, knowledge.sourceState.transcriptEvidence ? '字幕正文已缓存' : '字幕正文未缓存');
  if (knowledge.sourceState.description) appendBadge(meta, '简介辅助');
  if (knowledge.sourceState.pages || knowledge.sourceState.chapters) appendBadge(meta, '分 P / 章节辅助');
  block.appendChild(meta);

  const nodes = knowledge.nodes.slice(0, 5);
  if (nodes.length === 0) {
    appendText(block, 'div', 'bdc-assistant-subtitle-detail', '当前没有足够安全的当前视频知识节点候选。');
    appendVideoKnowledgeLimitations(block, knowledge);
    parent.appendChild(block);
    return;
  }

  const list = document.createElement('div');
  list.className = 'bdc-assistant-candidate-list';
  for (const [index, node] of nodes.entries()) {
    list.appendChild(videoKnowledgeNodeCard(node, index));
  }
  block.appendChild(list);
  appendVideoKnowledgeLimitations(block, knowledge);
  parent.appendChild(block);
}

function videoKnowledgeNodeCard(node: VideoKnowledgeNode, index: number): HTMLElement {
  const card = document.createElement('article');
  card.className = 'bdc-assistant-candidate-card';

  const head = document.createElement('div');
  head.className = 'bdc-assistant-candidate-head';
  appendText(head, 'div', 'bdc-assistant-candidate-title', `节点 ${index + 1} · ${videoKnowledgeTimeRange(node)}`);
  appendText(
    head,
    'div',
    'bdc-assistant-candidate-strength',
    `依据 ${formatPercent(node.confidence)}`,
  );
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'bdc-assistant-candidate-meta';
  appendBadge(meta, safeVisibleText(node.sourceLabel));
  appendBadge(meta, videoKnowledgeSourceStatus(node));
  if (node.evidence?.sourceStatus) {
    appendBadge(meta, videoKnowledgeEvidenceStatusLabel(node.evidence.sourceStatus));
  }
  card.appendChild(meta);

  appendText(card, 'div', 'bdc-assistant-candidate-evidence', safeVisibleText(node.title));
  appendText(card, 'div', 'bdc-assistant-subtitle-detail', safeVisibleText(node.reason));

  if (node.evidence?.textSpan) {
    const label = node.source === 'transcript'
      ? `字幕证据 ${videoKnowledgeTimeRange(node)}：`
      : '证据片段：';
    appendText(
      card,
      'div',
      'bdc-assistant-evidence',
      `${label}${safeVisibleText(node.evidence.textSpan)}`,
    );
  }

  appendText(
    card,
    'div',
    'bdc-assistant-subtitle-detail',
    videoKnowledgeNodePositionHint(node),
  );

  return card;
}

function appendVideoKnowledgeLimitations(parent: HTMLElement, knowledge: VideoKnowledgeResult): void {
  const limitations = knowledge.limitations.slice(0, 2).map(safeVisibleText).join(' ');
  if (limitations) {
    appendText(parent, 'div', 'bdc-assistant-subtitle-detail', limitations);
  }
}

async function loadCurrentVideoRelatedFavoritesFromPage(force: boolean): Promise<void> {
  if (assistantState.context?.kind !== 'video') return;
  if (assistantState.relatedFavoritesLoading) return;
  if (
    !force
    && assistantState.relatedFavorites
    && assistantState.relatedFavoritesContextKey === assistantState.contextKey
  ) {
    return;
  }

  const requestId = assistantState.relatedFavoritesRequestId + 1;
  const contextKey = assistantState.contextKey;
  assistantState.relatedFavoritesRequestId = requestId;
  assistantState.relatedFavoritesLoading = true;
  assistantState.relatedFavoritesError = null;
  renderAssistantShell();

  try {
    const summaryHint = assistantState.summary
      && assistantState.summaryContextKey === contextKey
      && (assistantState.summary.sourceTier === 'description_summary' || assistantState.summary.sourceTier === 'metadata_summary')
      ? assistantState.summary.summary
      : null;
    const result = await sendRuntimeRequest<CurrentVideoRelatedFavoritesResponse>('GET_CURRENT_VIDEO_RELATED_FAVORITES', {
      question: assistantState.segmentQuery,
      summaryHint,
      limit: 5,
    });
    if (assistantState.relatedFavoritesRequestId !== requestId || assistantState.contextKey !== contextKey) return;
    assistantState.relatedFavorites = result;
    assistantState.relatedFavoritesContextKey = contextKey;
  } catch {
    if (assistantState.relatedFavoritesRequestId !== requestId) return;
    assistantState.relatedFavoritesError = '相关收藏查找失败：请确认当前 B 站视频页仍然打开，并稍后重试。';
  } finally {
    if (assistantState.relatedFavoritesRequestId === requestId) {
      assistantState.relatedFavoritesLoading = false;
      renderAssistantShell();
    }
  }
}

async function searchCurrentVideoSegmentsFromPage(): Promise<void> {
  if (assistantState.segmentLoading) return;

  const query = assistantState.segmentQuery.trim();
  if (!query) {
    assistantState.segmentError = '请输入问题或想跳到的片段，例如“有没有关于 subagent 的介绍？”。';
    assistantState.segmentResult = null;
    renderAssistantShell();
    return;
  }
  if (assistantState.context?.kind !== 'video') {
    assistantState.segmentError = '当前没有可用视频上下文，请在 B 站视频页内使用。';
    assistantState.segmentResult = null;
    renderAssistantShell();
    return;
  }
  const primaryTextState = buildPrimaryTextStateForContext(assistantState.context);
  if (
    primaryTextState.sources.length > 1
    && !primaryTextState.selectedSourceIdentityKey
  ) {
    assistantState.segmentError = '请先明确选择一个主要文本来源，再向当前视频提问。';
    assistantState.segmentResult = null;
    renderAssistantShell();
    return;
  }

  const requestId = assistantState.segmentRequestId + 1;
  const contextKey = assistantState.contextKey;
  const returnAvailable = assistantState.segmentReturnAvailable;
  const returnStatus = returnAvailable ? assistantState.segmentJumpStatus : null;
  assistantState.segmentRequestId = requestId;
  assistantState.segmentLoading = true;
  assistantState.segmentError = null;
  assistantState.segmentResult = null;
  assistantState.segmentContextKey = contextKey;
  assistantState.segmentPreviewCandidateId = null;
  assistantState.segmentJumpStatus = returnStatus;
  assistantState.segmentJumpLoading = false;
  assistantState.segmentReturnAvailable = returnAvailable;
  assistantState.segmentReturnLoading = false;
  renderAssistantShell();

  try {
    const result = await sendRuntimeRequest<CurrentVideoSegmentRetrievalResult>('SEARCH_CURRENT_VIDEO_SEGMENTS', {
      query,
      ...currentPrimaryTextRequestParams(),
    });
    if (assistantState.segmentRequestId !== requestId || assistantState.contextKey !== contextKey) return;
    assistantState.segmentResult = result;
    assistantState.segmentContextKey = contextKey;
  } catch {
    if (assistantState.segmentRequestId !== requestId) return;
    assistantState.segmentError = '回答失败：请确认当前 B 站视频页仍然打开，并稍后重试。';
  } finally {
    if (assistantState.segmentRequestId === requestId) {
      assistantState.segmentLoading = false;
      renderAssistantShell();
    }
  }
}

async function confirmCurrentVideoSegmentJumpFromPage(
  candidate: CurrentVideoSegmentRetrievalCandidate,
  result: CurrentVideoSegmentRetrievalResult,
): Promise<void> {
  if (assistantState.segmentJumpLoading) return;

  const preview = candidate.jumpPreview;
  if (!preview.canJump) {
    assistantState.segmentJumpStatus = safeVisibleText(preview.message);
    assistantState.segmentReturnAvailable = false;
    renderAssistantShell();
    return;
  }

  assistantState.segmentJumpLoading = true;
  assistantState.segmentJumpStatus = '正在确认跳转...';
  assistantState.segmentReturnAvailable = false;
  renderAssistantShell();

  try {
    const response = await sendRuntimeRequest<CurrentVideoTimestampJumpResponse>(
      'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP',
      {
        query: result.query,
        candidateId: candidate.id,
        confirmed: true,
        ...currentPrimaryTextRequestParams(),
      },
    );
    assistantState.segmentJumpStatus = timestampJumpStatusText(response);
    assistantState.segmentReturnAvailable = response.ok && response.returnPointSeconds !== null;
    if (response.ok) {
      assistantState.segmentPreviewCandidateId = null;
    }
  } catch {
    assistantState.segmentJumpStatus = '跳转失败：请确认当前 B 站视频页仍然打开，并稍后重试。';
    assistantState.segmentReturnAvailable = false;
  } finally {
    assistantState.segmentJumpLoading = false;
    renderAssistantShell();
  }
}

async function returnCurrentVideoSegmentJumpFromPage(): Promise<void> {
  if (assistantState.segmentReturnLoading) return;

  assistantState.segmentReturnLoading = true;
  assistantState.segmentJumpStatus = '正在返回原位置...';
  renderAssistantShell();

  try {
    const response = await sendRuntimeRequest<CurrentVideoTimestampReturnResponse>(
      'RETURN_CURRENT_VIDEO_SEGMENT_JUMP',
    );
    assistantState.segmentJumpStatus = timestampReturnStatusText(response);
    if (response.ok) {
      assistantState.segmentReturnAvailable = false;
    }
  } catch {
    assistantState.segmentJumpStatus = '返回失败：请确认当前 B 站视频页仍然打开，并稍后重试。';
  } finally {
    assistantState.segmentReturnLoading = false;
    renderAssistantShell();
  }
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
        ...currentPrimaryTextRequestParams(),
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
    const summary = await sendRuntimeRequest<CurrentVideoSummaryResult>(
      'GET_CURRENT_VIDEO_SUMMARY',
      currentPrimaryTextRequestParams(),
    );
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

async function loadCurrentVideoKnowledge(force: boolean): Promise<void> {
  if (assistantState.context?.kind !== 'video') return;
  if (assistantState.knowledgeLoading) return;
  if (
    !force
    && assistantState.knowledge
    && assistantState.knowledgeContextKey === assistantState.contextKey
  ) {
    return;
  }

  const requestId = assistantState.knowledgeRequestId + 1;
  const contextKey = assistantState.contextKey;
  assistantState.knowledgeRequestId = requestId;
  assistantState.knowledgeLoading = true;
  assistantState.knowledgeError = null;
  renderAssistantShell();

  try {
    const knowledge = await sendRuntimeRequest<VideoKnowledgeResult>(
      'GET_VIDEO_KNOWLEDGE',
      currentPrimaryTextRequestParams(),
    );
    if (assistantState.knowledgeRequestId !== requestId || assistantState.contextKey !== contextKey) return;
    assistantState.knowledge = knowledge;
    assistantState.knowledgeContextKey = contextKey;
  } catch {
    if (assistantState.knowledgeRequestId !== requestId) return;
    assistantState.knowledgeError = '知识节点刷新失败：请确认当前 B 站视频页仍然打开，并稍后重试。';
  } finally {
    if (assistantState.knowledgeRequestId === requestId) {
      assistantState.knowledgeLoading = false;
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

function section(title: string, extraClass = ''): HTMLElement {
  const block = document.createElement('section');
  block.className = ['bdc-assistant-section', extraClass].filter(Boolean).join(' ');
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

function dashboardLink(text: string, hash = ''): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'bdc-assistant-link';
  link.href = chrome.runtime.getURL(`dashboard/index.html${hash}`);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}

function needsAiSettingsLink(status: string): boolean {
  return status === 'disabled' || status === 'not_configured';
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
    selectedPrimaryTextSourceIdentityKey(context) ?? 'no-selected-source',
    context.sources.transcript,
    context.sources.contentText,
    evidence?.status ?? 'no-evidence',
    evidence?.active === true ? 'active' : 'inactive',
    evidence?.sourceIdentityKey ?? 'no-source-key',
    evidence?.sourceHash ?? 'no-source-hash',
    evidence?.bodyHash ?? 'no-body-hash',
    evidence?.timelineHash ?? 'no-timeline-hash',
    evidence?.segmentCount ?? 0,
    evidence?.updatedAt ?? 0,
  ].join(':');
}

function ensurePrimaryTextSelectionsLoaded(): void {
  if (primaryTextSelectionsLoaded || primaryTextSelectionsLoading) return;
  primaryTextSelectionsLoading = true;
  chrome.storage?.local?.get(PRIMARY_TEXT_SELECTION_STORAGE_KEY)
    .then((stored) => {
      primaryTextSelections.clear();
      const raw = stored?.[PRIMARY_TEXT_SELECTION_STORAGE_KEY];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [partKey, sourceIdentityKey] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof sourceIdentityKey === 'string' && sourceIdentityKey.trim()) {
            primaryTextSelections.set(partKey, sourceIdentityKey.trim());
          }
        }
      }
      primaryTextSelectionsLoaded = true;
      primaryTextSelectionsLoading = false;
      if (assistantState.context) {
        updateAssistantContext(assistantState.context);
        renderAssistantShell();
      }
    })
    .catch(() => {
      primaryTextSelectionsLoaded = true;
      primaryTextSelectionsLoading = false;
    });
}

async function savePrimaryTextSelections(): Promise<void> {
  await chrome.storage.local.set({
    [PRIMARY_TEXT_SELECTION_STORAGE_KEY]: Object.fromEntries(primaryTextSelections.entries()),
  });
}

function primaryTextPartKey(context: CurrentVideoContext): string | null {
  if (!context.cid) return null;
  return [context.bvid, context.cid, context.currentPart.page].join(':');
}

function selectedPrimaryTextSourceIdentityKey(context: CurrentVideoContext): string | null {
  const partKey = primaryTextPartKey(context);
  if (!partKey) return null;
  return primaryTextSelections.get(partKey) ?? null;
}

function activePrimaryTextSourceIdentityKey(context: CurrentVideoContext): string | null {
  return buildPrimaryTextStateForContext(context).activeSourceIdentityKey;
}

function currentPrimaryTextRequestParams(): Record<string, unknown> {
  const context = assistantState.context;
  if (context?.kind !== 'video') return {};
  const selectedSourceIdentityKey = activePrimaryTextSourceIdentityKey(context);
  return selectedSourceIdentityKey ? { selectedSourceIdentityKey } : {};
}

function compactStatusText(context: CurrentVideoContextResult | null): string {
  if (!context) return '正在读取当前视频状态';
  if (context.kind !== 'video') return '未识别到当前视频';
  if (context.transcriptEvidence?.active) return '已取得当前分 P 字幕正文';
  if (context.cid) return '已识别视频，等待字幕正文';
  return '已识别视频，CID 待刷新';
}

function transcriptEvidenceLabel(context: CurrentVideoContext): string {
  const evidence = context.transcriptEvidence;
  if (evidence?.active) return `已缓存 ${evidence.segmentCount} 条`;
  if (evidence && evidence.status !== 'missing') return evidenceStatusLabel(evidence.status);
  return availabilityLabel(context.sources.contentText);
}

function primaryTextSourceLabel(context: CurrentVideoContext): string {
  const evidence = context.transcriptEvidence;
  if (evidence?.active && evidence.source === 'bilibili_subtitle') {
    return evidence.temporary
      ? 'B站字幕正文（本次临时使用）'
      : 'B站字幕正文';
  }
  if (context.subtitleProbe?.available || context.sources.transcript === 'available') {
    return '已探测到字幕轨道，尚未取得正文';
  }
  return '暂无正文，请开启中文 AI 字幕后重新检测';
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
    return `已取得并缓存当前分 P 匹配的字幕正文 ${context.transcriptEvidence.segmentCount} 条，可作为主要文本来源。`;
  }

  switch (diagnostics.status) {
    case 'missing_cid':
      return '还没有拿到当前分 P 的 CID，暂时不能安全检测字幕正文。';
    case 'track_found':
      return '已发现字幕轨道，但还没有取得可引用的字幕正文。';
    case 'enable_ai_subtitle':
      return '当前还没有可用字幕正文。通常需要先在播放器里手动开启中文 AI 字幕。';
    case 'login_required':
      return '字幕需要当前浏览器会话具备访问权限；Bili-Bill 不会读取本地敏感文件。';
    case 'no_track':
      return 'B 站播放器接口没有返回可用字幕轨道，当前没有可用视频正文。';
    case 'fetch_failed':
      return '字幕正文读取失败，当前没有可用视频正文。';
    case 'malformed':
      return '字幕正文结构暂时无法稳定解析，因此不会作为主要文本来源。';
    case 'empty':
      return '已找到字幕来源，但没有返回有效正文片段。';
    case 'language_mismatch':
      return '当前可读字幕不是中文 AI 字幕，因此不会作为当前视频正文证据。';
    case 'unsupported_host':
      return '字幕来源不在受限的 B 站字幕域名范围内，已拒绝读取。';
    case 'stale':
      return '本地字幕证据与当前视频不匹配，不能作为当前分 P 正文。';
    default:
      return '当前没有可引用的字幕正文。';
  }
}

function summarySubtitleAction(
  context: CurrentVideoContext,
  diagnostics: CurrentVideoSubtitleDiagnostics,
): string {
  if (assistantState.subtitleRefreshing || diagnostics.status === 'reading_body') {
    return '请保持当前视频页打开，检测完成后只更新文本来源状态。';
  }
  if (context.transcriptEvidence?.active) {
    return coverageText(context.transcriptEvidence) || '如果刚切换分 P，可以再次重新检测字幕。';
  }
  return diagnostics.action;
}

function subtitleRefreshResultText(context: CurrentVideoContextResult): string {
  const diagnostics = buildCurrentVideoSubtitleDiagnostics(context);
  if (context.kind === 'video' && context.transcriptEvidence?.active) {
    return `已刷新：已取得字幕正文 ${context.transcriptEvidence.segmentCount} 条。`;
  }
  return `已刷新：${diagnostics.title}。`;
}

function coverageText(evidence: CurrentVideoTranscriptEvidenceState): string {
  if (typeof evidence.coverageStartSeconds !== 'number' || typeof evidence.coverageEndSeconds !== 'number') {
    return '';
  }
  return `可引用范围：${formatDuration(evidence.coverageStartSeconds)}-${formatDuration(evidence.coverageEndSeconds)}。`;
}

function videoKnowledgeNotice(knowledge: VideoKnowledgeResult, transcriptNodeCount: number): string {
  if (knowledge.status === 'no_context') {
    return '当前没有可用于知识节点的视频上下文，请在 B 站视频页内使用。';
  }
  if (transcriptNodeCount > 0) {
    return `已用当前视频本地字幕证据生成 ${transcriptNodeCount} 个知识节点；时间范围只来自字幕片段。`;
  }

  const evidence = knowledge.transcriptEvidence;
  if (!evidence) {
    return '当前没有可引用的字幕正文；知识节点只使用元数据、简介、分 P 或章节辅助提示，不会推测时间点。';
  }
  if (evidence.status === 'stale') {
    return '本地字幕证据与当前视频或分 P 不匹配，已降级为弱证据节点。';
  }
  if (evidence.status === 'language_mismatch') {
    return '本地字幕语言与当前请求不匹配，暂不生成字幕节点。';
  }
  if (evidence.status === 'empty') {
    return '已检测到字幕来源，但没有可用正文片段，暂不生成字幕节点。';
  }
  if (evidence.status === 'malformed') {
    return '字幕正文结构异常，暂不作为知识节点证据。';
  }
  if (evidence.active) {
    return '已检测到本地字幕证据，但当前没有匹配到可展示的字幕节点，已保留辅助节点。';
  }
  return evidence.message || '当前没有可引用的字幕正文；不会生成推测时间点。';
}

function videoKnowledgeTimeRange(node: VideoKnowledgeNode): string {
  if (node.timestamp === null) return '无时间点';
  if (typeof node.endTimestamp === 'number' && node.endTimestamp > node.timestamp) {
    return `${formatDuration(node.timestamp)}-${formatDuration(node.endTimestamp)}`;
  }
  return formatDuration(node.timestamp);
}

function videoKnowledgeSourceStatus(node: VideoKnowledgeNode): string {
  switch (node.source) {
    case 'transcript':
      return '当前视频字幕证据';
    case 'metadata':
    case 'description':
      return '弱证据辅助提示';
    case 'page':
    case 'chapter':
      return '结构化辅助提示';
    default:
      return '当前视频本地节点';
  }
}

function videoKnowledgeEvidenceStatusLabel(status: VideoKnowledgeEvidenceSourceStatus): string {
  switch (status) {
    case 'active':
      return '当前匹配';
    case 'stale':
      return '已过期';
    case 'mismatch':
      return '不匹配';
    case 'unavailable':
      return '不可用';
    default:
      return '未知';
  }
}

function videoKnowledgeNodePositionHint(node: VideoKnowledgeNode): string {
  if (node.source === 'metadata' || node.source === 'description') {
    return '该节点只是弱证据辅助提示，不能说明已经完整理解视频，也不会生成时间点。';
  }
  if (node.timestamp === null) {
    return '该节点没有可定位时间点，不会伪造播放位置。';
  }
  if (node.jumpAction) {
    return '该节点包含定位信息；如需跳转，请在当前视频问答中检索引用片段，并按预览、确认流程操作。';
  }
  return '该节点包含字幕时间范围；如需跳转，请在当前视频问答中检索引用片段，并按预览、确认流程操作。';
}

function timestampJumpStatusText(response: CurrentVideoTimestampJumpResponse): string {
  if (response.ok && response.targetTimeLabel && typeof response.returnPointSeconds === 'number') {
    return `已跳到 ${response.targetTimeLabel}；可返回 ${formatDuration(response.returnPointSeconds)}。`;
  }
  return safeVisibleText(response.message);
}

function timestampReturnStatusText(response: CurrentVideoTimestampReturnResponse): string {
  if (response.ok && typeof response.returnPointSeconds === 'number') {
    return `已返回 ${formatDuration(response.returnPointSeconds)}。`;
  }
  return safeVisibleText(response.message);
}

function safeVisibleText(value: string): string {
  return value
    .replace(CANDIDATE_ID_PATTERN, '候选片段')
    .replace(TRANSCRIPT_ID_PATTERN, '字幕片段')
    .replace(NODE_ID_PATTERN, '知识节点')
    .replace(/https?:\/\/\S+/g, '链接已隐藏')
    .replace(PLAYER_ENDPOINT_PATTERN, '接口路径已隐藏')
    .replace(RAW_FIELD_PATTERN, '内部字段')
    .replace(PAGE_BODY_TEXT_PATTERN, '页面可见文字')
    .replace(/\bBVID\b/g, '视频编号')
    .replace(/\bCID\b/g, '分 P 信息')
    .replace(ENGINEERING_VISIBLE_TERM_PATTERN, (term) => {
      const normalized = term.toLowerCase();
      if (normalized === 'fallback') return '本地兜底';
      if (normalized === 'transcript') return '字幕正文';
      return '匹配度';
    });
}

function qaStatusLabel(status: CurrentVideoSegmentRetrievalResult['qa']['status']): string {
  switch (status) {
    case 'answered':
      return '有证据';
    case 'not_found':
      return '没有找到';
    case 'no_transcript':
      return '证据不足';
    case 'low_confidence':
      return '证据较弱';
    case 'no_context':
      return '没有当前视频';
    case 'insufficient_evidence':
    default:
      return '证据不足';
  }
}

function qaStatusColor(status: CurrentVideoSegmentRetrievalResult['qa']['status']): string {
  switch (status) {
    case 'answered':
      return '#a0e7a0';
    case 'not_found':
      return '#c8e6ff';
    case 'low_confidence':
    case 'no_transcript':
    case 'insufficient_evidence':
      return '#ffcf8a';
    case 'no_context':
    default:
      return '#ff8a8a';
  }
}

function qaAiStatusLabel(status: CurrentVideoSegmentRetrievalResult['qa']['aiState']['status']): string {
  switch (status) {
    case 'generated':
      return '已整理';
    case 'disabled':
      return '未启用';
    case 'not_configured':
      return '未配置';
    case 'failed':
      return '请求失败';
    case 'rejected':
      return '已拒绝';
    case 'low_confidence':
      return '低置信';
    case 'not_requested':
    default:
      return '未请求';
  }
}

function qaSourceStateLabel(result: CurrentVideoSegmentRetrievalResult): string {
  if (result.qa.sourceState.hasCitableEvidence) return '当前视频证据';
  if (result.qa.sourceState.hasOnlyMetadataHints) return '仅弱提示';
  if (!result.qa.sourceState.contextFresh) return '上下文需刷新';
  return '缺少字幕正文';
}

function relatedFavoritesNotice(qa: SmartFavoriteQaResponse): string {
  if (qa.citedVideos.length > 0) {
    return `在当前已同步收藏中找到 ${qa.citedVideos.length} 个相关收藏，可作为延伸阅读。`;
  }
  if (qa.answerType === 'insufficient_evidence') {
    return '当前收藏检索只能使用收藏元数据和智能索引，未找到足够可引用的相关收藏。';
  }
  return '当前已同步收藏中暂未找到匹配收藏。';
}

function relatedFavoritesCoverageNotice(qa: SmartFavoriteQaResponse): string {
  if (!qa.status.syncCoverage.complete) {
    return '收藏同步可能不完整，结果只覆盖当前已同步收藏。';
  }
  if (qa.status.indexCoverage.indexMissing) {
    return '智能索引缺失，本次使用本地元数据结果。';
  }
  if (qa.status.indexCoverage.staleIndex) {
    return '智能索引可能过期或不完整，本次仍保留本地元数据结果。';
  }
  if (qa.synthesis?.status === 'disabled') {
    return 'AI 收藏问答未启用，已保留本地引用结果。';
  }
  if (qa.synthesis?.status === 'not_configured') {
    return 'AI 收藏问答尚未配置，已保留本地引用结果。';
  }
  if (qa.synthesis?.status === 'failed' || qa.synthesis?.status === 'rejected') {
    return 'AI 整理未采用，已保留本地引用结果。';
  }
  return '';
}

function relatedFavoritesStatusColor(qa: SmartFavoriteQaResponse): string {
  switch (qa.status.kind) {
    case 'ok':
      return '#a0e7a0';
    case 'no_result':
      return '#c8e6ff';
    case 'low_confidence':
    case 'stale_index':
    case 'incomplete_sync':
    case 'index_missing':
    case 'insufficient_evidence':
    default:
      return '#ffcf8a';
  }
}

function relatedFavoritesAiStatusLabel(status: SmartFavoriteQaSynthesisStatus | undefined): string {
  switch (status) {
    case 'generated':
      return '已整理';
    case 'disabled':
      return '未启用';
    case 'not_configured':
      return '未配置';
    case 'failed':
      return '请求失败';
    case 'rejected':
      return '未采用';
    case 'local_fallback':
      return '本地引用';
    default:
      return '未请求';
  }
}

function relatedFavoriteConfidenceLabel(value: SmartFavoriteQaCitedVideo['confidence']): string {
  if (value === 'high') return '高';
  if (value === 'medium') return '中';
  return '低';
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

function segmentRetrievalStatusMessage(
  result: CurrentVideoSegmentRetrievalResult,
  context: CurrentVideoContext,
): string {
  switch (result.status) {
    case 'empty_query':
      return '请输入想定位的内容。';
    case 'no_context':
      return '当前没有可用视频上下文，请在 B 站视频页内使用。';
    case 'stale_context':
      return '当前视频上下文已过期，请刷新当前页或重新检测字幕后再检索。';
    case 'no_evidence':
      if (!context.transcriptEvidence?.active && result.evidenceState.transcriptSegmentCount === 0) {
        return '需要先开启或重新检测字幕正文；没有当前视频本地证据时不会伪造时间点。';
      }
      return result.summary;
    case 'metadata_only':
      return '只找到视频信息或简介里的弱提示，当前无法定位到具体时间；需要字幕正文或本地节点证据。';
    case 'low_confidence':
      return `${result.summary} 当前只展示候选，不改变播放位置。`;
    case 'ready':
    default:
      return result.summary;
  }
}

function segmentRetrievalStatusColor(result: CurrentVideoSegmentRetrievalResult): string {
  if (result.status === 'ready') return '#a0e7a0';
  if (result.status === 'metadata_only' || result.status === 'low_confidence') return '#ffcf8a';
  if (result.status === 'stale_context' || result.status === 'no_context') return '#ff8a8a';
  return '#c8e6ff';
}

function segmentCandidateSourceStatus(
  candidate: CurrentVideoSegmentRetrievalCandidate,
  result: CurrentVideoSegmentRetrievalResult,
): string {
  switch (candidate.source) {
    case 'transcript_segment':
      return `当前视频字幕正文 ${result.evidenceState.transcriptSegmentCount} 条可用`;
    case 'transcript_node':
      return '当前视频本地字幕节点';
    case 'chapter_node':
      return '当前视频章节弱提示';
    case 'page_node':
      return '当前分 P 弱提示';
    case 'metadata_hint':
    case 'description_hint':
      return '仅弱提示，不能定位时间';
    default:
      return '当前视频本地证据';
  }
}

function segmentVisibleLimitations(result: CurrentVideoSegmentRetrievalResult): string[] {
  switch (result.status) {
    case 'ready':
    case 'low_confidence':
      return ['候选只来自当前视频字幕正文或本地节点，不会推测新时间点。'];
    case 'metadata_only':
      return ['仅视频信息或简介弱提示不能定位时间，需要字幕正文或本地节点证据。'];
    case 'no_evidence':
      return ['检索只基于当前视频证据；没有字幕正文或本地节点时不会给出时间。'];
    case 'stale_context':
      return ['请先刷新当前视频上下文，再重新检索。'];
    case 'no_context':
      return ['请在 B 站视频页内使用当前视频助手。'];
    case 'empty_query':
      return ['请输入关键词或一句话描述。'];
    default:
      return ['检索只基于当前视频本地证据。'];
  }
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
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

function formatByteSize(bytes: number): string {
  const safe = Math.max(0, Math.floor(bytes));
  if (safe >= 1024 * 1024) return `${(safe / 1024 / 1024).toFixed(1)} MB`;
  if (safe >= 1024) return `${Math.ceil(safe / 1024)} KB`;
  return `${safe} B`;
}
