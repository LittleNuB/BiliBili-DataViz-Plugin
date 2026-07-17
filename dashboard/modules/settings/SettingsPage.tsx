import { useEffect, useMemo, useState } from 'preact/hooks';
import { requestSW } from '../../utils/messaging';
import {
  buildLocalDataOperationMessage,
  buildLocalDataSummaryCards,
  buildSmartFavoriteRebuildMessage,
  dangerousLocalDataClearScope,
  formatLocalDataError,
  LOCAL_DATA_CLEAR_CONFIRMATION,
} from '../../../src/shared/local-data-privacy';
import {
  DEFAULT_CONFIG,
  type AiConfig,
  type AiConnectionTestResult,
  type AssistantConfig,
  type DynamicBillConfig,
  type UserConfig,
} from '../../../src/shared/types/config';
import type {
  LocalDataOperationResult,
  LocalDataPrivacySummary,
  SmartFavoriteIndexRebuildResult,
} from '../../../src/shared/types/local-data-privacy';
import type { DynamicBillCreatorPauseView } from '../../../src/shared/types/dynamic-bill';
import {
  formatSettingsError,
  normalizeSettingsUserConfig,
  saveSettingsDraft,
} from './settings-save-state';

type BusyState =
  | ''
  | 'save'
  | 'test'
  | 'local-refresh'
  | 'subtitle-clear'
  | 'index-rebuild'
  | 'pause-restore'
  | 'clear-all';

interface AiFormState {
  baseURL: string;
  chatModel: string;
  apiKeyInput: string;
}

const DEFAULT_AI_FORM: AiFormState = {
  baseURL: DEFAULT_CONFIG.ai.baseURL,
  chatModel: DEFAULT_CONFIG.ai.chatModel,
  apiKeyInput: '',
};

const DEFAULT_ASSISTANT: AssistantConfig = DEFAULT_CONFIG.assistant;

const DEFAULT_DYNAMIC_BILL: DynamicBillConfig = DEFAULT_CONFIG.dynamicBill;

export function SettingsPage() {
  const [form, setForm] = useState<AiFormState>(DEFAULT_AI_FORM);
  const [savedApiKey, setSavedApiKey] = useState('');
  const [assistant, setAssistant] = useState<AssistantConfig>(DEFAULT_ASSISTANT);
  const [dynamicBill, setDynamicBill] = useState<DynamicBillConfig>(DEFAULT_DYNAMIC_BILL);
  const [loadedConfig, setLoadedConfig] = useState<UserConfig | null>(null);
  const [busy, setBusy] = useState<BusyState>('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [lastTest, setLastTest] = useState<AiConnectionTestResult | null>(null);
  const [localData, setLocalData] = useState<LocalDataPrivacySummary | null>(null);
  const [localDataError, setLocalDataError] = useState('');
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');

  useEffect(() => {
    void refreshConfig();
    void refreshLocalData();
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return undefined;

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const change = changes.userConfig;
      if (!change?.newValue) return;
      applyConfig(change.newValue as Partial<UserConfig>);
      setNotice('');
      setLastTest(null);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const effectiveAiConfig = useMemo<AiConfig>(() => ({
    baseURL: form.baseURL.trim(),
    chatModel: form.chatModel.trim(),
    apiKey: form.apiKeyInput.trim() || savedApiKey,
  }), [form, savedApiKey]);

  const hasSavedApiKey = savedApiKey.trim().length > 0;
  const hasPendingChanges = useMemo(() => {
    if (!loadedConfig) return false;
    return form.baseURL.trim() !== loadedConfig.ai.baseURL
      || form.chatModel.trim() !== loadedConfig.ai.chatModel
      || form.apiKeyInput.trim().length > 0
      || assistant.currentVideoAiAssistantEnabled !== loadedConfig.assistant.currentVideoAiAssistantEnabled
      || assistant.smartFavoritesQaAiEnabled !== loadedConfig.assistant.smartFavoritesQaAiEnabled
      || dynamicBill.aiExplanationsEnabled !== loadedConfig.dynamicBill.aiExplanationsEnabled;
  }, [assistant, dynamicBill, form, loadedConfig]);
  const localDataCards = localData ? buildLocalDataSummaryCards(localData) : [];
  const canConfirmClear = clearConfirmText.trim() === LOCAL_DATA_CLEAR_CONFIRMATION;

  async function refreshConfig() {
    setLoading(true);
    setError('');
    try {
      const config = await requestSW<UserConfig>('GET_CONFIG');
      applyConfig(config);
      setNotice('');
      setLastTest(null);
    } catch (err) {
      setError(formatSettingsError(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshLocalData() {
    setLocalDataError('');
    try {
      const summary = await requestSW<LocalDataPrivacySummary>('GET_LOCAL_DATA_PRIVACY_SUMMARY');
      setLocalData(summary);
    } catch (err) {
      setLocalDataError(formatLocalDataError(err));
    }
  }

  async function saveSettings() {
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const baseConfig = normalizeSettingsUserConfig(loadedConfig ?? await requestSW<UserConfig>('GET_CONFIG'));
      const result = await saveSettingsDraft(
        {
          persistedConfig: baseConfig,
          draft: {
            ai: {
              ...form,
              savedApiKey,
            },
            assistant,
            dynamicBill,
          },
        },
        {
          persist: async nextConfig => {
            await ensureAiHostPermission(nextConfig.ai.baseURL);
            await requestSW('UPDATE_CONFIG', {
              ai: nextConfig.ai,
              assistant: nextConfig.assistant,
              dynamicBill: nextConfig.dynamicBill,
            });
          },
          applyPersistedConfig: applyConfig,
        },
      );
      if (result.status === 'failure') {
        setError(result.error);
        return;
      }
      setNotice('设置已保存。后续 AI 功能会从这里读取同一套服务配置和开关。');
    } catch (err) {
      setError(formatSettingsError(err));
    } finally {
      setBusy('');
    }
  }

  async function testConnection() {
    setBusy('test');
    setError('');
    setNotice('');
    setLastTest(null);
    try {
      await ensureAiHostPermission(effectiveAiConfig.baseURL);
      const result = await requestSW<AiConnectionTestResult>('TEST_AI_CONNECTION', {
        ai: effectiveAiConfig,
      });
      setLastTest(result);
      setNotice(`连接测试通过：模型 ${result.model} 已响应，用时 ${result.latencyMs} 毫秒。`);
    } catch (err) {
      setError(formatConnectionError(err));
    } finally {
      setBusy('');
    }
  }

  async function refreshLocalDataFromButton() {
    setBusy('local-refresh');
    setNotice('');
    setError('');
    await refreshLocalData();
    setBusy('');
  }

  async function clearSubtitleCache() {
    setBusy('subtitle-clear');
    setNotice('');
    setError('');
    try {
      const result = await requestSW<LocalDataOperationResult>('CLEAR_CURRENT_VIDEO_SUBTITLE_CACHE');
      setNotice(buildLocalDataOperationMessage(result));
      await refreshLocalData();
    } catch (err) {
      setLocalDataError(formatLocalDataError(err));
    } finally {
      setBusy('');
    }
  }

  async function rebuildSmartFavoriteIndex() {
    setBusy('index-rebuild');
    setNotice('');
    setError('');
    try {
      const result = await requestSW<SmartFavoriteIndexRebuildResult>('REBUILD_SMART_FAVORITE_INDEX');
      setNotice(buildSmartFavoriteRebuildMessage(result));
      await refreshLocalData();
    } catch (err) {
      setLocalDataError(formatLocalDataError(err));
    } finally {
      setBusy('');
    }
  }

  async function restoreDynamicBillCreatorReminder(creatorMid: number, creatorName: string) {
    setBusy('pause-restore');
    setNotice('');
    setError('');
    try {
      await requestSW('RESTORE_DYNAMIC_BILL_CREATOR_REMINDER', { creatorMid });
      await refreshLocalData();
      setNotice(`已恢复「${creatorName}」的动态账单提醒；这不会修改 B 站关注关系。`);
    } catch (err) {
      setLocalDataError(formatLocalDataError(err));
    } finally {
      setBusy('');
    }
  }

  async function clearAllLocalData() {
    setBusy('clear-all');
    setNotice('');
    setError('');
    try {
      const result = await requestSW<LocalDataOperationResult>('CLEAR_ALL_LOCAL_DATA', {
        confirmation: clearConfirmText.trim(),
      });
      const message = buildLocalDataOperationMessage(result);
      setClearConfirmVisible(false);
      setClearConfirmText('');
      await refreshConfig();
      await refreshLocalData();
      setNotice(message);
    } catch (err) {
      setLocalDataError(formatLocalDataError(err));
    } finally {
      setBusy('');
    }
  }

  function applyConfig(config: Partial<UserConfig>) {
    const normalized = normalizeSettingsUserConfig(config);
    setLoadedConfig(normalized);
    setForm({
      baseURL: normalized.ai.baseURL,
      chatModel: normalized.ai.chatModel,
      apiKeyInput: '',
    });
    setSavedApiKey(normalized.ai.apiKey);
    setAssistant(normalized.assistant);
    setDynamicBill(normalized.dynamicBill);
  }

  if (loading) {
    return (
      <div className="settings-page">
        <section className="settings-panel settings-panel-muted">正在读取设置...</section>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-hero">
        <div>
          <span className="settings-kicker">全局配置</span>
          <h2>设置</h2>
          <p>
            在这里统一管理 AI 服务、功能开关和隐私边界。当前视频、智能收藏和动态账单会共用这套配置；未启用或未配置时继续展示本地证据结果。
          </p>
        </div>
        <div className="settings-save-state">
          <strong>{hasPendingChanges ? '有未保存更改' : '设置已同步'}</strong>
          <span>{hasSavedApiKey ? 'API Key 已保存在本地，不会在输入框中回显完整值。' : '尚未保存 API Key。'}</span>
        </div>
      </header>

      {error && <div className="settings-alert settings-alert-error">{error}</div>}
      {notice && <div className="settings-alert settings-alert-success">{notice}</div>}

      <section className="settings-panel">
        <div className="settings-section-head">
          <div>
            <h3>AI 服务</h3>
            <p>支持 OpenAI 兼容服务。测试连接只发送一条最小健康检查消息，不包含本地历史、收藏、关注或反馈记录。</p>
          </div>
          <span className={hasSavedApiKey ? 'settings-pill settings-pill-ok' : 'settings-pill'}>
            {hasSavedApiKey ? 'Key 已保存' : 'Key 未保存'}
          </span>
        </div>

        <div className="settings-form-grid">
          <label className="settings-field">
            <span>服务地址</span>
            <input
              value={form.baseURL}
              onInput={(event) => setForm({ ...form, baseURL: event.currentTarget.value })}
              placeholder="https://api.deepseek.com"
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span>模型名</span>
            <input
              value={form.chatModel}
              onInput={(event) => setForm({ ...form, chatModel: event.currentTarget.value })}
              placeholder="deepseek-v4-flash"
              autoComplete="off"
            />
          </label>
          <label className="settings-field settings-field-wide">
            <span>API Key</span>
            <input
              value={form.apiKeyInput}
              onInput={(event) => setForm({ ...form, apiKeyInput: event.currentTarget.value })}
              placeholder={hasSavedApiKey ? '留空则沿用已保存在本地的 Key' : '输入服务提供方的 API Key'}
              type="password"
              autoComplete="new-password"
            />
            <small>
              {form.apiKeyInput.trim()
                ? '保存后会替换本地已保存的 Key。'
                : hasSavedApiKey
                  ? '完整 Key 不会重复展示；需要更换时直接输入新 Key 后保存。'
                  : 'Key 只写入本地浏览器扩展存储。'}
            </small>
          </label>
        </div>

        <div className="settings-actions">
          <button type="button" className="settings-action" onClick={testConnection} disabled={!!busy}>
            {busy === 'test' ? '测试中...' : '测试连接'}
          </button>
          <button type="button" className="settings-action settings-action-primary" onClick={saveSettings} disabled={!!busy}>
            {busy === 'save' ? '保存中...' : '保存设置'}
          </button>
          {lastTest && (
            <span className="settings-action-note">
              最近测试：{new Date(lastTest.checkedAt).toLocaleString('zh-CN')}，{lastTest.latencyMs} 毫秒
            </span>
          )}
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-section-head">
          <div>
            <h3>AI 功能开关</h3>
            <p>关闭某个功能后，对应页面继续使用本地证据结果，不会把关闭状态当作错误。</p>
          </div>
        </div>

        <div className="settings-toggle-grid">
          <FeatureToggle
            title="当前视频 AI 助手"
            detail="允许用户主动触发摘要、亮点和问答时，把当前分 P 的主要文本发送给已配置的聊天服务；开启开关本身不会发送请求。"
            checked={assistant.currentVideoAiAssistantEnabled}
            onChange={(checked) => setAssistant(current => ({ ...current, currentVideoAiAssistantEnabled: checked }))}
          />
          <FeatureToggle
            title="智能收藏问答"
            detail="允许 AI 基于已同步收藏的前置引用视频整理综合回答。"
            checked={assistant.smartFavoritesQaAiEnabled}
            onChange={(checked) => setAssistant(current => ({ ...current, smartFavoritesQaAiEnabled: checked }))}
          />
          <FeatureToggle
            title="动态账单解释"
            detail="允许 AI 为已入选的账单项生成解释；入选、排序和状态推进仍由本地规则决定。"
            checked={dynamicBill.aiExplanationsEnabled}
            onChange={(checked) => setDynamicBill(current => ({ ...current, aiExplanationsEnabled: checked }))}
          />
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-section-head">
          <div>
            <h3>本地数据与隐私管理</h3>
            <p>这里只展示本地数据的数量、覆盖范围和最近时间，不展示完整记录、敏感标识或本地文件路径。</p>
          </div>
          <span className="settings-pill">
            {localData ? '状态已读取' : '等待读取'}
          </span>
        </div>

        {localDataError && <div className="settings-alert settings-alert-error">{localDataError}</div>}

        <div className="settings-data-grid">
          {localDataCards.length > 0
            ? localDataCards.map(card => (
              <article className="settings-data-card" key={card.id}>
                <span>{card.title}</span>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
                <small>{card.meta}</small>
              </article>
            ))
            : (
              <div className="settings-data-empty">
                正在读取本地数据摘要...
              </div>
            )}
        </div>

        {localData && (
          <div className="settings-data-subgrid">
            <DataStat label="待索引收藏" value={localData.favorites.pendingIndexItems} />
            <DataStat label="索引失败" value={localData.favorites.failedIndexItems} />
            <DataStat label="过期字幕片段" value={localData.currentVideoSubtitles.staleSegmentCount} />
          </div>
        )}

        {localData && (
          <DynamicBillPauseList
            pauses={localData.dynamicBill.activeCreatorPauses}
            busy={busy === 'pause-restore'}
            onRestore={restoreDynamicBillCreatorReminder}
          />
        )}

        <div className="settings-actions">
          <button type="button" className="settings-action" onClick={refreshLocalDataFromButton} disabled={!!busy}>
            {busy === 'local-refresh' ? '刷新中...' : '刷新状态'}
          </button>
          <button
            type="button"
            className="settings-action"
            onClick={clearSubtitleCache}
            disabled={!!busy || !localData || localData.currentVideoSubtitles.segmentCount === 0}
          >
            {busy === 'subtitle-clear' ? '清理中...' : '清理字幕缓存'}
          </button>
          <button
            type="button"
            className="settings-action"
            onClick={rebuildSmartFavoriteIndex}
            disabled={!!busy || !localData || localData.favorites.storedItems === 0}
          >
            {busy === 'index-rebuild' ? '重建中...' : '重建智能收藏索引'}
          </button>
          <button
            type="button"
            className="settings-action settings-action-danger"
            onClick={() => setClearConfirmVisible(true)}
            disabled={!!busy}
          >
            清理本地数据
          </button>
        </div>

        {clearConfirmVisible && (
          <div className="settings-danger-box">
            <div>
              <strong>确认清理本地数据</strong>
              <p>这会删除 Bili-Bill 保存在浏览器扩展里的本地内容数据和本地设置，不会修改 B 站账号、关注关系、收藏夹或视频数据。</p>
            </div>
            <ul>
              {dangerousLocalDataClearScope().map(item => <li key={item}>{item}</li>)}
            </ul>
            <label className="settings-field">
              <span>输入“{LOCAL_DATA_CLEAR_CONFIRMATION}”确认</span>
              <input
                value={clearConfirmText}
                onInput={(event) => setClearConfirmText(event.currentTarget.value)}
                autoComplete="off"
              />
            </label>
            <div className="settings-actions">
              <button
                type="button"
                className="settings-action settings-action-danger"
                onClick={clearAllLocalData}
                disabled={!!busy || !canConfirmClear}
              >
                {busy === 'clear-all' ? '清理中...' : '确认清理'}
              </button>
              <button
                type="button"
                className="settings-action"
                onClick={() => {
                  setClearConfirmVisible(false);
                  setClearConfirmText('');
                }}
                disabled={!!busy}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-panel">
        <div className="settings-section-head">
          <div>
            <h3>隐私边界</h3>
            <p>这里记录 Bili-Bill 的本地数据和 AI 请求边界。</p>
          </div>
        </div>
        <ul className="settings-privacy-list">
          <li>API Key 只保存在本地浏览器扩展存储中，不会提交到 Bili-Bill 服务端。</li>
          <li>AI 请求只发送当前功能需要的最小证据片段，不上传完整观看历史、完整收藏、完整关注或反馈记录。</li>
          <li>Bili-Bill 不读取本地登录凭据文件、浏览器用户资料目录、B 站登录状态文件或本地密钥文件。</li>
          <li>动态账单、收藏和当前视频功能不会写回 B 站关注关系、收藏夹或视频数据。</li>
        </ul>
      </section>
    </div>
  );
}

function DataStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="settings-data-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DynamicBillPauseList({
  busy,
  onRestore,
  pauses,
}: {
  busy: boolean;
  onRestore: (creatorMid: number, creatorName: string) => void;
  pauses: DynamicBillCreatorPauseView[];
}) {
  return (
    <div className="settings-pause-list" data-testid="settings-dynamic-bill-pauses">
      <div className="settings-section-head">
        <div>
          <h4>动态账单暂停提醒</h4>
          <p>这里只恢复 Bili-Bill 本地提醒资格，不修改 B 站关注关系，也不重置少提醒次数。</p>
        </div>
      </div>
      {pauses.length === 0 ? (
        <div className="settings-data-empty">当前没有暂停提醒的 UP。</div>
      ) : (
        <div className="settings-pause-items">
          {pauses.map(pause => (
            <article className="settings-pause-item" key={pause.creatorMid}>
              <div>
                <strong>{pause.creatorName || `UP ${pause.creatorMid}`}</strong>
                <span>
                  {pause.remainingDays > 0
                    ? `约 ${pause.remainingDays} 天后自动恢复`
                    : '即将自动恢复'}；到期时间 {formatSettingsDate(pause.expiresAt)}
                </span>
              </div>
              <button
                type="button"
                className="settings-action"
                disabled={busy}
                onClick={() => onRestore(pause.creatorMid, pause.creatorName || `UP ${pause.creatorMid}`)}
              >
                恢复提醒
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function FeatureToggle({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const stateText = checked ? '已启用' : '已关闭';
  return (
    <label
      className={`settings-toggle ${checked ? 'is-on' : 'is-off'}`}
      data-state={checked ? 'on' : 'off'}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="settings-toggle-control" aria-hidden="true" />
      <span className="settings-toggle-copy">
        <span className="settings-toggle-title-row">
          <strong>{title}</strong>
          <span className="settings-toggle-state">{stateText}</span>
        </span>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function formatSettingsDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function ensureAiHostPermission(baseURL: string): Promise<void> {
  const pattern = getOriginPattern(baseURL);
  const granted = await new Promise<boolean>(resolve => {
    chrome.permissions.contains({ origins: [pattern] }, resolve);
  });
  if (granted) return;

  const approved = await new Promise<boolean>(resolve => {
    chrome.permissions.request({ origins: [pattern] }, resolve);
  });
  if (!approved) {
    throw new Error('AI_PERMISSION_DENIED');
  }
}

function getOriginPattern(baseURL: string): string {
  let url: URL;
  try {
    url = new URL(baseURL.trim());
  } catch {
    throw new Error('AI_BASE_URL_INVALID');
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('AI_BASE_URL_UNSUPPORTED');
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol === 'http:' && !isLocalHttpHost(hostname)) {
    throw new Error('AI_HTTP_HOST_UNSUPPORTED');
  }

  return `${url.protocol}//${hostname}/*`;
}

function isLocalHttpHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function formatConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AI_BASE_URL_INVALID' || message === 'AI_BASE_URL_MISSING') return '请填写有效的 AI 服务地址。';
  if (message === 'AI_MODEL_MISSING') return '请填写模型名后再测试连接。';
  if (message === 'AI_API_KEY_MISSING') return '请先输入 API Key，或保存并沿用本地已有 Key。';
  if (message === 'AI_BASE_URL_UNSUPPORTED') return 'AI 服务地址只支持 http 或 https。';
  if (message === 'AI_HTTP_HOST_UNSUPPORTED') return 'HTTP 服务地址仅限本机调试地址。';
  if (message === 'AI_PERMISSION_DENIED') return '没有获得该 AI 服务地址的访问权限，无法测试连接。';
  if (message === 'AI_REQUEST_TIMEOUT') return '连接测试超时，请稍后重试或检查服务地址。';
  if (message.startsWith('AI_REQUEST_FAILED_')) return 'AI 服务拒绝了本次测试，请检查服务地址、模型名和 API Key。';
  if (message === 'AI_RESPONSE_INVALID_JSON') return '服务已有响应，但返回格式无法确认，请检查模型是否支持兼容接口。';
  return '连接测试失败，请检查服务地址、模型名和 API Key。';
}
