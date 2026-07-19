import { useEffect, useRef, useState } from 'preact/hooks';
import { quickStats, loading, error, lastSyncResult, syncInProgress, syncProgress, syncPageLimit } from './signals';
import { requestSW } from './utils/messaging';
import type { QuickStats } from '../src/shared/types/analytics';
import type { SyncNowResult } from '../src/shared/types/messages';
import type { HistoryTailProbeReport } from '../src/shared/types/history-tail-probe';
import type { HistorySyncProgress, HistorySyncStatus } from '../src/shared/types/history-sync';
import type {
  CurrentVideoContextResult,
} from '../src/shared/types/current-video-context';
import type { CurrentVideoTranscriptEvidenceState } from '../src/shared/types/current-video-transcript';
import type {
  CurrentVideoSegmentRerankExplanation,
  CurrentVideoSegmentRetrievalCandidate,
  CurrentVideoSegmentRetrievalResult,
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from '../src/shared/types/current-video-segment-retrieval';
import type { CurrentVideoSummaryResult } from '../src/shared/types/current-video-summary';
import type { VideoKnowledgeNode, VideoKnowledgeResult } from '../src/shared/types/video-knowledge';
import { cancelledCurrentVideoSummary, loadingCurrentVideoSummary } from '../src/shared/current-video-summary';
import {
  buildCurrentVideoSubtitleDiagnostics,
  type CurrentVideoSubtitleDiagnostics,
} from '../src/shared/current-video-subtitle-diagnostics';
import {
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
  readCurrentVideoPrimaryTextSelections,
  resolveCurrentVideoPrimaryTextAuthorization,
  type CurrentVideoPrimaryTextAuthorization,
} from '../src/shared/current-video-primary-text-selection.ts';
import { ProgressRing } from './components/ProgressRing';
import { QuickStats as QuickStatsPanel } from './components/QuickStats';
import { OpenDashboard } from './components/OpenDashboard';

interface PopupCurrentVideoScopeSnapshot {
  contextKey: string;
  selectionRevision: number;
  operationRevision: number;
}

interface PopupCurrentVideoActionSnapshot extends PopupCurrentVideoScopeSnapshot {
  requestId: number;
}

function popupCurrentVideoContextKey(context: CurrentVideoContextResult | null): string {
  if (!context) return 'no_context:pending';
  if (context.kind !== 'video') return `no_context:${context.pageType}:${context.reason}`;
  return `video:${context.bvid}:${context.cid ?? 'missing'}:${context.currentPart.page}`;
}

function popupCurrentVideoExactIdentityMatches(
  left: CurrentVideoContextResult | null,
  right: CurrentVideoContextResult | null,
): boolean {
  return left?.kind === 'video'
    && right?.kind === 'video'
    && left.bvid === right.bvid
    && left.cid !== null
    && left.cid === right.cid
    && left.currentPart.page === right.currentPart.page;
}

function popupTranscriptEvidenceMatchesContext(
  evidence: CurrentVideoTranscriptEvidenceState,
  context: CurrentVideoContextResult,
): boolean {
  return context.kind === 'video'
    && context.cid !== null
    && evidence.bvid === context.bvid
    && evidence.cid === context.cid
    && evidence.page === context.currentPart.page;
}

export function App() {
  const [currentVideoContext, setCurrentVideoContext] = useState<CurrentVideoContextResult | null>(null);
  const [currentVideoSummary, setCurrentVideoSummary] = useState<CurrentVideoSummaryResult | null>(null);
  const [videoKnowledge, setVideoKnowledge] = useState<VideoKnowledgeResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [subtitleProbeLoading, setSubtitleProbeLoading] = useState(false);
  const [subtitleProbeStatus, setSubtitleProbeStatus] = useState<string | null>(null);
  const [currentVideoActionError, setCurrentVideoActionError] = useState<string | null>(null);
  const [primaryTextSelectionRevision, setPrimaryTextSelectionRevision] = useState(0);
  const [currentVideoOperationRevision, setCurrentVideoOperationRevision] = useState(0);
  const [tailProbeReport, setTailProbeReport] = useState<HistoryTailProbeReport | null>(null);
  const [tailProbeLoading, setTailProbeLoading] = useState(false);
  const [tailProbeError, setTailProbeError] = useState<string | null>(null);
  const currentVideoContextRef = useRef<CurrentVideoContextResult | null>(null);
  const currentVideoContextKeyRef = useRef(popupCurrentVideoContextKey(null));
  const primaryTextSelectionRevisionRef = useRef(0);
  const currentVideoOperationRevisionRef = useRef(0);
  const currentVideoContextRequestRef = useRef(0);
  const subtitleReprobeRequestRef = useRef(0);
  const summaryRequestRef = useRef(0);
  const knowledgeRequestRef = useRef(0);
  const subtitleReprobeActiveRef = useRef(false);

  currentVideoContextRef.current = currentVideoContext;
  currentVideoContextKeyRef.current = popupCurrentVideoContextKey(currentVideoContext);

  useEffect(() => {
    fetchStats(false);
    fetchCurrentVideoContext();
    const timer = window.setInterval(refreshSyncStatus, 1500);
    const storageChanges = chrome.storage?.onChanged;
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (
        areaName !== 'local'
        || !Object.prototype.hasOwnProperty.call(
          changes,
          CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
        )
      ) {
        return;
      }
      invalidateCurrentVideoOperations({ selectionChanged: true });
    };
    storageChanges?.addListener?.(handleStorageChange);
    return () => {
      window.clearInterval(timer);
      storageChanges?.removeListener?.(handleStorageChange);
    };
  }, []);

  async function refreshSyncStatus() {
    try {
      const status = await requestSW<HistorySyncStatus>('GET_SYNC_STATUS');
      syncProgress.value = status.syncProgress;
      syncInProgress.value = status.syncProgress?.syncing ?? false;

      if (status.syncProgress?.syncing) {
        const data = await requestSW<QuickStats>('GET_QUICK_STATS');
        quickStats.value = data;
      }
    } catch {
      // The floating window can outlive a restarting service worker.
    }
  }

  async function fetchCurrentVideoContext() {
    const requestId = currentVideoContextRequestRef.current + 1;
    currentVideoContextRequestRef.current = requestId;
    try {
      const context = await requestSW<CurrentVideoContextResult>('GET_CURRENT_VIDEO_CONTEXT');
      if (currentVideoContextRequestRef.current !== requestId) return;
      commitCurrentVideoContext(context);
    } catch {
      if (currentVideoContextRequestRef.current !== requestId) return;
      commitCurrentVideoContext(null);
    }
  }

  async function fetchCurrentVideoSummary() {
    if (subtitleReprobeActiveRef.current) {
      setCurrentVideoActionError('正在重新检测字幕，请等待检测完成后再试。');
      return;
    }
    const action = beginCurrentVideoAction(summaryRequestRef);
    const context = currentVideoContextRef.current;
    setCurrentVideoActionError(null);
    setSummaryLoading(true);
    setCurrentVideoSummary(loadingCurrentVideoSummary());
    try {
      const authorization = await popupCurrentVideoPrimaryTextAuthorization(context);
      if (!currentVideoActionIsCurrent(action, summaryRequestRef)) return;
      if (!authorization.ready) {
        setCurrentVideoSummary(null);
        setCurrentVideoActionError(authorization.message);
        return;
      }
      if (!currentVideoActionIsCurrent(action, summaryRequestRef)) return;
      const summary = await requestSW<CurrentVideoSummaryResult>(
        'GET_CURRENT_VIDEO_SUMMARY',
        authorization.params,
      );
      if (!currentVideoActionIsCurrent(action, summaryRequestRef)) return;
      setCurrentVideoSummary(summary);
    } catch {
      if (!currentVideoActionIsCurrent(action, summaryRequestRef)) return;
      setCurrentVideoSummary(null);
      setCurrentVideoActionError('摘要读取失败，请确认当前 B 站视频页仍然打开后重试。');
    } finally {
      if (currentVideoActionIsCurrent(action, summaryRequestRef)) setSummaryLoading(false);
    }
  }

  async function fetchVideoKnowledge() {
    if (subtitleReprobeActiveRef.current) {
      setCurrentVideoActionError('正在重新检测字幕，请等待检测完成后再试。');
      return;
    }
    const action = beginCurrentVideoAction(knowledgeRequestRef);
    const context = currentVideoContextRef.current;
    setCurrentVideoActionError(null);
    setKnowledgeLoading(true);
    try {
      const authorization = await popupCurrentVideoPrimaryTextAuthorization(context);
      if (!currentVideoActionIsCurrent(action, knowledgeRequestRef)) return;
      if (!authorization.ready) {
        setVideoKnowledge(null);
        setCurrentVideoActionError(authorization.message);
        return;
      }
      if (!currentVideoActionIsCurrent(action, knowledgeRequestRef)) return;
      const result = await requestSW<VideoKnowledgeResult>(
        'GET_VIDEO_KNOWLEDGE',
        authorization.params,
      );
      if (!currentVideoActionIsCurrent(action, knowledgeRequestRef)) return;
      setVideoKnowledge(result);
    } catch {
      if (!currentVideoActionIsCurrent(action, knowledgeRequestRef)) return;
      setVideoKnowledge(null);
      setCurrentVideoActionError('知识节点读取失败，请确认当前 B 站视频页仍然打开后重试。');
    } finally {
      if (currentVideoActionIsCurrent(action, knowledgeRequestRef)) setKnowledgeLoading(false);
    }
  }

  async function reprobeCurrentVideoSubtitle() {
    invalidateCurrentVideoOperations();
    currentVideoContextRequestRef.current += 1;
    const requestId = subtitleReprobeRequestRef.current + 1;
    subtitleReprobeRequestRef.current = requestId;
    const operationRevision = currentVideoOperationRevisionRef.current;
    subtitleReprobeActiveRef.current = true;
    setSubtitleProbeLoading(true);
    setSubtitleProbeStatus(null);
    setCurrentVideoActionError(null);
    try {
      const firstContext = await requestSW<CurrentVideoContextResult>('GET_CURRENT_VIDEO_CONTEXT', {
        forceContextRefresh: true,
        forceSubtitleProbe: true,
      });
      if (!subtitleReprobeIsCurrent(requestId, operationRevision)) return;
      commitCurrentVideoContext(firstContext, true);
      if (firstContext.kind !== 'video' || firstContext.cid === null) {
        const diagnostics = buildCurrentVideoSubtitleDiagnostics(firstContext);
        setSubtitleProbeStatus(`${diagnostics.title}：${diagnostics.message}`);
        return;
      }

      const transcriptEvidence = await requestSW<CurrentVideoTranscriptEvidenceState>('GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE', {
        forceContextRefresh: true,
        forceSubtitleProbe: true,
      });
      if (!subtitleReprobeIsCurrent(requestId, operationRevision)) return;
      const refreshedContext = await requestSW<CurrentVideoContextResult>('GET_CURRENT_VIDEO_CONTEXT');
      if (!subtitleReprobeIsCurrent(requestId, operationRevision)) return;
      if (!popupCurrentVideoExactIdentityMatches(firstContext, refreshedContext)) {
        commitCurrentVideoContext(refreshedContext, true);
        setSubtitleProbeStatus('检测期间当前视频已变化，请在新页面重新操作。');
        return;
      }
      if (!popupTranscriptEvidenceMatchesContext(transcriptEvidence, firstContext)) {
        commitCurrentVideoContext(refreshedContext, true);
        setSubtitleProbeStatus('字幕检测结果与当前页面不一致，请重新检测。');
        return;
      }
      const contextWithEvidence = { ...refreshedContext, transcriptEvidence };
      commitCurrentVideoContext(contextWithEvidence, true);
      const diagnostics = buildCurrentVideoSubtitleDiagnostics(contextWithEvidence);
      setSubtitleProbeStatus(`${diagnostics.title}：${diagnostics.message}`);
    } catch {
      if (!subtitleReprobeIsCurrent(requestId, operationRevision)) return;
      setSubtitleProbeStatus('重新检测失败：请确认当前 B 站视频页仍然打开，并在播放器里开启中文 AI 字幕后重试。');
    } finally {
      if (subtitleReprobeIsCurrent(requestId, operationRevision)) {
        subtitleReprobeActiveRef.current = false;
        setSubtitleProbeLoading(false);
      }
    }
  }

  function cancelCurrentVideoSummary() {
    summaryRequestRef.current += 1;
    setSummaryLoading(false);
    setCurrentVideoSummary(cancelledCurrentVideoSummary(currentVideoContextRef.current));
  }

  function currentVideoScopeSnapshot(): PopupCurrentVideoScopeSnapshot {
    return {
      contextKey: currentVideoContextKeyRef.current,
      selectionRevision: primaryTextSelectionRevisionRef.current,
      operationRevision: currentVideoOperationRevisionRef.current,
    };
  }

  function beginCurrentVideoAction(requestRef: { current: number }): PopupCurrentVideoActionSnapshot {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    return { ...currentVideoScopeSnapshot(), requestId };
  }

  function currentVideoActionIsCurrent(
    action: PopupCurrentVideoActionSnapshot,
    requestRef: { current: number },
  ): boolean {
    const scope = currentVideoScopeSnapshot();
    return requestRef.current === action.requestId
      && scope.contextKey === action.contextKey
      && scope.selectionRevision === action.selectionRevision
      && scope.operationRevision === action.operationRevision;
  }

  function subtitleReprobeIsCurrent(requestId: number, operationRevision: number): boolean {
    return subtitleReprobeActiveRef.current
      && subtitleReprobeRequestRef.current === requestId
      && currentVideoOperationRevisionRef.current === operationRevision;
  }

  function invalidateCurrentVideoOperations({
    selectionChanged = false,
  }: { selectionChanged?: boolean } = {}): void {
    if (selectionChanged) {
      primaryTextSelectionRevisionRef.current += 1;
      setPrimaryTextSelectionRevision(primaryTextSelectionRevisionRef.current);
    }
    currentVideoOperationRevisionRef.current += 1;
    setCurrentVideoOperationRevision(currentVideoOperationRevisionRef.current);
    summaryRequestRef.current += 1;
    knowledgeRequestRef.current += 1;
    subtitleReprobeRequestRef.current += 1;
    subtitleReprobeActiveRef.current = false;
    setSummaryLoading(false);
    setKnowledgeLoading(false);
    setSubtitleProbeLoading(false);
    setCurrentVideoSummary(null);
    setVideoKnowledge(null);
    setSubtitleProbeStatus(null);
    setCurrentVideoActionError(null);
  }

  function commitCurrentVideoContext(
    context: CurrentVideoContextResult | null,
    scopeAlreadyInvalidated = false,
  ): void {
    const nextContextKey = popupCurrentVideoContextKey(context);
    if (!scopeAlreadyInvalidated && nextContextKey !== currentVideoContextKeyRef.current) {
      invalidateCurrentVideoOperations();
    }
    currentVideoContextRef.current = context;
    currentVideoContextKeyRef.current = nextContextKey;
    setCurrentVideoContext(context);
  }

  function openSettings() {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html#settings') });
  }

  async function fetchStats(forceSync = true) {
    loading.value = quickStats.value === null;
    error.value = null;
    syncInProgress.value = false;
    try {
      if (forceSync) {
        lastSyncResult.value = await requestSW<SyncNowResult>('SYNC_NOW', {
          mode: 'full',
          maxPages: syncPageLimit.value,
        });
        await refreshSyncStatus();
      }
      const data = await requestSW<QuickStats>('GET_QUICK_STATS');
      quickStats.value = data;
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('HISTORY_SYNC_IN_PROGRESS')) {
        await refreshSyncStatus();
        syncInProgress.value = true;
        const data = await requestSW<QuickStats>('GET_QUICK_STATS');
        quickStats.value = data;
        return;
      }
      error.value = message;
    } finally {
      loading.value = false;
    }
  }

  const isNotLoggedIn = error.value?.includes('NOT_LOGGED_IN') || error.value?.includes('-101');
  const progress = syncProgress.value;
  const progressPercent = progress
    ? progress.reachedEnd
      ? 100
      : progress.fetchedPages > 0
        ? Math.max(1, Math.min(99, Math.round((progress.fetchedPages / Math.max(progress.pageLimit, 1)) * 100)))
        : 0
    : 0;
  const elapsedSeconds = progress?.startedAt ? Math.max(0, Math.round((Date.now() - progress.startedAt) / 1000)) : 0;

  async function stopSync() {
    if (syncProgress.value) {
      syncProgress.value = {
        ...syncProgress.value,
        currentTask: '正在停止同步...',
      };
    }
    await requestSW('CANCEL_SYNC');
    await refreshSyncStatus();
  }

  async function runTailProbe() {
    setTailProbeLoading(true);
    setTailProbeError(null);
    try {
      const report = await requestSW<HistoryTailProbeReport>('PROBE_HISTORY_TAIL', {
        maxPages: syncPageLimit.value,
      });
      setTailProbeReport(report);
    } catch (e) {
      setTailProbeError((e as Error).message);
    } finally {
      setTailProbeLoading(false);
    }
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', gap: '8px' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#FB7299',
            margin: 0,
          }}>
            Bili-Bill
          </h1>
          <p style={{ margin: '2px 0 0', color: '#9090A0', fontSize: '10px' }}>
            个人内容账单
          </p>
        </div>
        <button
          onClick={() => fetchStats(true)}
          disabled={loading.value}
          title="全量同步并刷新数据"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#A0A0B0',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 4px',
            opacity: loading.value ? 0.5 : 1,
          }}
        >
          🔄
        </button>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '8px',
        marginTop: '8px',
      }}>
        <select
          value={syncPageLimit.value}
          onChange={(e) => {
            syncPageLimit.value = Number((e.currentTarget as HTMLSelectElement).value);
          }}
          title={syncInProgress.value ? '当前同步不受影响，修改会应用到下一次同步' : '限制本次最多同步的历史页数，每页约 30 条'}
          style={{
            background: '#242448',
            color: '#C8C8D8',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '6px',
            fontSize: '11px',
            padding: '4px 6px',
          }}
        >
          <option value={10}>最多 300 条</option>
          <option value={50}>最多 1500 条</option>
          <option value={100}>最多 3000 条</option>
          <option value={300}>最多 9000 条</option>
        </select>
        {syncInProgress.value && (
          <button
            onClick={stopSync}
            style={{
              background: '#3A2A38',
              color: '#FFB347',
              border: '1px solid rgba(255, 179, 71, 0.35)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '4px 8px',
            }}
          >
            停止同步
          </button>
        )}
      </div>
      <section style={{
        margin: '8px 18px 12px',
        padding: '10px 12px',
        border: '1px solid rgba(0, 161, 214, 0.25)',
        borderRadius: '8px',
        background: 'rgba(0, 161, 214, 0.08)',
      }}>
        <div style={{
          color: '#7FDBFF',
          fontSize: '12px',
          fontWeight: 700,
          marginBottom: '4px',
        }}>
          历史接口尾页诊断
        </div>
        <div style={{ color: '#A0A0B0', fontSize: '10px', lineHeight: 1.5 }}>
          仅用于诊断。使用当前运行时登录状态，有限拉取历史页，不保存历史明细。
        </div>
        <button
          onClick={runTailProbe}
          disabled={tailProbeLoading || syncInProgress.value}
          style={{
            marginTop: '8px',
            background: 'rgba(0, 161, 214, 0.16)',
            color: '#7FDBFF',
            border: '1px solid rgba(0, 161, 214, 0.32)',
            borderRadius: '6px',
            cursor: tailProbeLoading || syncInProgress.value ? 'default' : 'pointer',
            fontSize: '11px',
            padding: '6px 8px',
            opacity: tailProbeLoading || syncInProgress.value ? 0.7 : 1,
          }}
        >
          {tailProbeLoading ? '诊断中...' : '诊断历史尾页'}
        </button>
        {tailProbeError && (
          <div style={{ color: '#FFB347', fontSize: '10px', lineHeight: 1.45, marginTop: '8px' }}>
            {tailProbeError}
          </div>
        )}
        {tailProbeReport && (
          <div style={{ color: '#C8EFFF', fontSize: '10px', lineHeight: 1.55, marginTop: '8px', whiteSpace: 'pre-wrap' }}>
            {formatTailProbeReport(tailProbeReport)}
          </div>
        )}
      </section>
      <OpenDashboard />
      <CurrentVideoAssistantStatus
        context={currentVideoContext}
        summary={currentVideoSummary}
        knowledge={videoKnowledge}
        loading={summaryLoading}
        knowledgeLoading={knowledgeLoading}
        subtitleProbeLoading={subtitleProbeLoading}
        subtitleProbeStatus={subtitleProbeStatus}
        currentVideoActionError={currentVideoActionError}
        onRefresh={fetchCurrentVideoSummary}
        onCancel={cancelCurrentVideoSummary}
        onReprobeSubtitle={reprobeCurrentVideoSubtitle}
        onRefreshKnowledge={fetchVideoKnowledge}
        onOpenSettings={openSettings}
        operationScopeKey={popupCurrentVideoContextKey(currentVideoContext)}
        primaryTextSelectionRevision={primaryTextSelectionRevision}
        currentVideoOperationRevision={currentVideoOperationRevision}
      />

      {loading.value && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9090A0' }}>
          加载中...
        </div>
      )}

      {error.value && isNotLoggedIn && (
        <div style={{ textAlign: 'center', padding: '30px 20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔐</div>
          <p style={{ color: '#A0A0B0', fontSize: '14px', marginBottom: '16px' }}>
            请先登录B站账号
          </p>
          <button
            onClick={() => chrome.tabs.create({ url: 'https://www.bilibili.com' })}
            style={{
              padding: '8px 24px',
              background: '#FB7299',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            打开B站登录 →
          </button>
        </div>
      )}

      {error.value && !isNotLoggedIn && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#FF6B6B' }}>
          <p>{error.value}</p>
          <button
            onClick={() => fetchStats(true)}
            style={{
              marginTop: '8px',
              padding: '6px 16px',
              background: '#FB7299',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            重试
          </button>
        </div>
      )}

      {!loading.value && !error.value && quickStats.value && (
        <>
          <div style={{ marginBottom: '4px' }}>
            <p style={{
              textAlign: 'center',
              fontSize: '12px',
              color: '#9090A0',
              marginBottom: '4px',
            }}>
              今日进度：{Math.round(quickStats.value.todayWatchTime / 60)} / {Math.round(quickStats.value.dailyGoal / 60)} 分钟
            </p>
            <ProgressRing />
          </div>
          {lastSyncResult.value && (
            <p style={{
              textAlign: 'center',
              fontSize: '11px',
              color: '#707080',
              margin: '0 12px 8px',
            }}>
              {lastSyncResult.value.mode === 'full' ? '全量' : '增量'}同步：扫描 {lastSyncResult.value.fetchedPages} 页 / {lastSyncResult.value.fetchedCount} 条，新增 {lastSyncResult.value.insertedCount} 条，更新 {lastSyncResult.value.updatedCount} 条，停止原因：{lastSyncResult.value.stoppedReason}
            </p>
          )}
          {syncInProgress.value && (
            <div style={{
              margin: '0 18px 12px',
              padding: '10px 12px',
              border: '1px solid rgba(255, 179, 71, 0.28)',
              borderRadius: '8px',
              background: 'rgba(255, 179, 71, 0.08)',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                color: '#FFB347',
                fontSize: '11px',
                fontWeight: 700,
                marginBottom: '8px',
              }}>
                <span>历史全量同步进行中</span>
                <span>{progressPercent}%</span>
              </div>
              <div style={{
                height: '6px',
                background: 'rgba(255,255,255,0.12)',
                borderRadius: '999px',
                overflow: 'hidden',
                marginBottom: '8px',
              }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: '#FFB347',
                  borderRadius: '999px',
                  transition: 'width 180ms ease',
                }} />
              </div>
              <p style={{
                color: '#A0A0B0',
                fontSize: '10px',
                lineHeight: 1.5,
                margin: 0,
              }}>
                已扫描 {progress?.fetchedPages ?? 0} / {progress?.pageLimit ?? 0} 页，获取 {progress?.fetchedCount ?? 0} 条，新增 {progress?.insertedCount ?? 0} 条，更新 {progress?.updatedCount ?? 0} 条，已运行 {elapsedSeconds}s。当前显示本地已有数据。
                <br />
                {progress?.currentTask ?? '正在准备同步'}
              </p>
              <button
                onClick={stopSync}
                style={{
                  marginTop: '8px',
                  width: '100%',
                  background: 'rgba(255, 179, 71, 0.12)',
                  color: '#FFB347',
                  border: '1px solid rgba(255, 179, 71, 0.32)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '6px 8px',
                }}
              >
                停止本次同步
              </button>
            </div>
          )}
          <p style={{
            textAlign: 'center',
            fontSize: '11px',
            color: '#707080',
            margin: '0 12px 4px',
          }}>
            本周已计入 PC {Math.round(quickStats.value.weeklyLocalPcWatchTime / 60)} 分钟，覆盖 {quickStats.value.weeklyLocalPcDays} 天
          </p>
          <p style={{
            textAlign: 'center',
            fontSize: '10px',
            color: '#606070',
            margin: '0 12px 8px',
          }}>
            B站历史进度为跨设备估算，本机 PC 播放为实测增强
          </p>
          <QuickStatsPanel />
        </>
      )}

      {!loading.value && !error.value && !quickStats.value && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9090A0' }}>
          暂无数据
          <br />
          <span style={{ fontSize: '12px' }}>去B站看几个视频后回来查看</span>
        </div>
      )}
    </div>
  );
}

function CurrentVideoAssistantStatus({
  context,
  summary,
  knowledge,
  loading,
  knowledgeLoading,
  subtitleProbeLoading,
  subtitleProbeStatus,
  currentVideoActionError,
  onRefresh,
  onCancel,
  onReprobeSubtitle,
  onRefreshKnowledge,
  onOpenSettings,
  operationScopeKey,
  primaryTextSelectionRevision,
  currentVideoOperationRevision,
}: {
  context: CurrentVideoContextResult | null;
  summary: CurrentVideoSummaryResult | null;
  knowledge: VideoKnowledgeResult | null;
  loading: boolean;
  knowledgeLoading: boolean;
  subtitleProbeLoading: boolean;
  subtitleProbeStatus: string | null;
  currentVideoActionError: string | null;
  onRefresh: () => void;
  onCancel: () => void;
  onReprobeSubtitle: () => void;
  onRefreshKnowledge: () => void;
  onOpenSettings: () => void;
  operationScopeKey: string;
  primaryTextSelectionRevision: number;
  currentVideoOperationRevision: number;
}) {
  const isVideo = context?.kind === 'video';
  const [segmentQuery, setSegmentQuery] = useState('');
  const [segmentResult, setSegmentResult] = useState<CurrentVideoSegmentRetrievalResult | null>(null);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [segmentPreviewCandidateId, setSegmentPreviewCandidateId] = useState<string | null>(null);
  const [segmentJumpStatus, setSegmentJumpStatus] = useState<string | null>(null);
  const [segmentReturnAvailable, setSegmentReturnAvailable] = useState(false);
  const [segmentJumpLoading, setSegmentJumpLoading] = useState(false);
  const [segmentReturnLoading, setSegmentReturnLoading] = useState(false);
  const segmentSearchRequestRef = useRef(0);
  const timestampRequestRef = useRef(0);
  const segmentSearchBusyRef = useRef(false);
  const timestampBusyRef = useRef(false);
  const renderedScopeRef = useRef<PopupCurrentVideoScopeSnapshot>({
    contextKey: operationScopeKey,
    selectionRevision: primaryTextSelectionRevision,
    operationRevision: currentVideoOperationRevision,
  });
  renderedScopeRef.current = {
    contextKey: operationScopeKey,
    selectionRevision: primaryTextSelectionRevision,
    operationRevision: currentVideoOperationRevision,
  };
  const subtitleDiagnostics = buildCurrentVideoSubtitleDiagnostics(context, {
    refreshing: subtitleProbeLoading,
  });

  useEffect(() => {
    segmentSearchRequestRef.current += 1;
    timestampRequestRef.current += 1;
    segmentSearchBusyRef.current = false;
    timestampBusyRef.current = false;
    setSegmentLoading(false);
    setSegmentJumpLoading(false);
    setSegmentReturnLoading(false);
    setSegmentResult(null);
    setSegmentError(null);
    setSegmentPreviewCandidateId(null);
    setSegmentJumpStatus(null);
    setSegmentReturnAvailable(false);
  }, [operationScopeKey, primaryTextSelectionRevision, currentVideoOperationRevision]);

  async function searchCurrentVideoSegments() {
    const query = segmentQuery.trim();
    if (!query) {
      setSegmentError('请输入想查找的片段内容。');
      setSegmentResult(null);
      setSegmentPreviewCandidateId(null);
      setSegmentJumpStatus(null);
      setSegmentReturnAvailable(false);
      return;
    }
    if (subtitleProbeLoading || segmentSearchBusyRef.current || timestampBusyRef.current) {
      return;
    }
    const action = beginScopedAction(segmentSearchRequestRef);
    segmentSearchBusyRef.current = true;
    setSegmentLoading(true);
    setSegmentError(null);
    setSegmentResult(null);
    setSegmentPreviewCandidateId(null);
    setSegmentJumpStatus(null);
    setSegmentReturnAvailable(false);
    try {
      const authorization = await popupCurrentVideoPrimaryTextAuthorization(context);
      if (!scopedActionIsCurrent(action, segmentSearchRequestRef)) return;
      if (!authorization.ready) {
        setSegmentError(authorization.message);
        return;
      }
      if (!scopedActionIsCurrent(action, segmentSearchRequestRef)) return;
      const result = await requestSW<CurrentVideoSegmentRetrievalResult>('SEARCH_CURRENT_VIDEO_SEGMENTS', {
        query,
        ...authorization.params,
      });
      if (!scopedActionIsCurrent(action, segmentSearchRequestRef)) return;
      setSegmentResult(result);
    } catch {
      if (!scopedActionIsCurrent(action, segmentSearchRequestRef)) return;
      setSegmentError('片段检索失败，请确认当前 B 站视频页仍然打开后重试。');
      setSegmentResult(null);
    } finally {
      if (scopedActionIsCurrent(action, segmentSearchRequestRef)) {
        segmentSearchBusyRef.current = false;
        setSegmentLoading(false);
      }
    }
  }

  async function confirmSegmentJump(candidate: CurrentVideoSegmentRetrievalCandidate) {
    if (
      !segmentResult
      || subtitleProbeLoading
      || segmentSearchBusyRef.current
      || timestampBusyRef.current
    ) return;
    if (!candidate.jumpPreview.canJump) {
      setSegmentJumpStatus('当前候选暂不可跳转，请重新检索后再试。');
      return;
    }
    const action = beginScopedAction(timestampRequestRef);
    timestampBusyRef.current = true;
    setSegmentJumpLoading(true);
    setSegmentReturnLoading(false);
    setSegmentJumpStatus('正在确认跳转...');
    setSegmentReturnAvailable(false);
    try {
      const authorization = await popupCurrentVideoPrimaryTextAuthorization(context);
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      if (!authorization.ready) {
        setSegmentJumpStatus(authorization.message);
        return;
      }
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      const result = await requestSW<CurrentVideoTimestampJumpResponse>('REQUEST_CURRENT_VIDEO_SEGMENT_JUMP', {
        query: segmentResult.query,
        candidateId: candidate.id,
        confirmed: true,
        ...authorization.params,
      });
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      setSegmentJumpStatus(result.ok
        ? '跳转已完成，可返回原位置。'
        : '未能完成跳转，请回到当前视频页确认页面和播放器状态后重试。');
      setSegmentReturnAvailable(result.ok && result.returnPointSeconds !== null);
    } catch {
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      setSegmentJumpStatus('跳转确认失败，请确认当前 B 站视频页仍然打开后重试。');
      setSegmentReturnAvailable(false);
    } finally {
      if (scopedActionIsCurrent(action, timestampRequestRef)) {
        timestampBusyRef.current = false;
        setSegmentJumpLoading(false);
      }
    }
  }

  async function returnSegmentJump() {
    if (
      !segmentReturnAvailable
      || subtitleProbeLoading
      || segmentSearchBusyRef.current
      || timestampBusyRef.current
    ) return;
    const action = beginScopedAction(timestampRequestRef);
    timestampBusyRef.current = true;
    setSegmentJumpLoading(false);
    setSegmentReturnLoading(true);
    setSegmentJumpStatus('正在返回原位置...');
    try {
      const authorization = await popupCurrentVideoPrimaryTextAuthorization(context);
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      if (!authorization.ready) {
        setSegmentJumpStatus(authorization.message);
        setSegmentReturnAvailable(false);
        return;
      }
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      const result = await requestSW<CurrentVideoTimestampReturnResponse>(
        'RETURN_CURRENT_VIDEO_SEGMENT_JUMP',
        authorization.params,
      );
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      setSegmentJumpStatus(result.ok
        ? '已返回原位置。'
        : '未能返回原位置，请回到当前视频页确认页面和播放器状态后重试。');
      if (result.ok) setSegmentReturnAvailable(false);
    } catch {
      if (!scopedActionIsCurrent(action, timestampRequestRef)) return;
      setSegmentJumpStatus('返回原位置失败，请确认当前 B 站视频页仍然打开后重试。');
    } finally {
      if (scopedActionIsCurrent(action, timestampRequestRef)) {
        timestampBusyRef.current = false;
        setSegmentReturnLoading(false);
      }
    }
  }

  function beginScopedAction(requestRef: { current: number }): PopupCurrentVideoActionSnapshot {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    return { ...renderedScopeRef.current, requestId };
  }

  function scopedActionIsCurrent(
    action: PopupCurrentVideoActionSnapshot,
    requestRef: { current: number },
  ): boolean {
    const scope = renderedScopeRef.current;
    return requestRef.current === action.requestId
      && scope.contextKey === action.contextKey
      && scope.selectionRevision === action.selectionRevision
      && scope.operationRevision === action.operationRevision;
  }

  return (
    <section style={{
      margin: '10px 18px 12px',
      padding: '10px 12px',
      border: '1px solid rgba(251, 114, 153, 0.25)',
      borderRadius: '8px',
      background: 'rgba(251, 114, 153, 0.08)',
    }}>
      <div style={{
        color: '#FB7299',
        fontSize: '12px',
        fontWeight: 700,
        marginBottom: '6px',
      }}>
        当前视频助手
      </div>
      {isVideo ? (
        <>
          <div style={{ color: '#E8E8F2', fontSize: '12px', lineHeight: 1.45, fontWeight: 600 }}>
            {context.title?.trim() || '当前视频'}
          </div>
          <div style={{ color: '#A0A0B0', fontSize: '10px', lineHeight: 1.5, marginTop: '4px' }}>
            当前分 P：{context.currentPart.title?.trim() || `第 ${context.currentPart.page} 段`}
            {context.currentPart.total ? `（第 ${context.currentPart.page}/${context.currentPart.total} 段）` : ''}
            <br />
            简介 {availabilityLabel(context.sources.description)}；字幕 {availabilityLabel(context.sources.transcript)}；正文文本 {availabilityLabel(context.sources.contentText)}
            <br />
            字幕状态：{subtitleDiagnostics.title}
          </div>
          <div style={{
            marginTop: '6px',
            padding: '7px 8px',
            border: `1px solid ${subtitleDiagnosticsBorder(subtitleDiagnostics)}`,
            borderRadius: '6px',
            background: subtitleDiagnosticsBackground(subtitleDiagnostics),
          }}>
            <div style={{ color: subtitleDiagnosticsColor(subtitleDiagnostics), fontSize: '10px', lineHeight: 1.45, fontWeight: 700 }}>
              {subtitleDiagnostics.title}
            </div>
            <div style={{ color: '#E8E8F2', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
              {subtitleDiagnostics.message}
            </div>
            <div style={{ color: '#FFCF8A', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
              {subtitleDiagnostics.action}
            </div>
            {subtitleDiagnostics.detailLines.slice(0, 2).map(line => (
              <div key={line} style={{ color: '#A0A0B0', fontSize: '9px', lineHeight: 1.45, marginTop: '3px' }}>
                {line}
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '6px' }}>
              {subtitleDiagnostics.featureGates.map(item => (
                <div
                  key={item.label}
                  style={{
                    border: `1px solid ${item.available ? 'rgba(160,231,160,0.25)' : 'rgba(255,179,71,0.22)'}`,
                    borderRadius: '6px',
                    padding: '4px 5px',
                    color: item.available ? '#A0E7A0' : '#FFCF8A',
                    fontSize: '9px',
                    lineHeight: 1.35,
                  }}
                >
                  <strong>{item.label}</strong> {item.message}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onReprobeSubtitle}
              disabled={subtitleProbeLoading || !subtitleDiagnostics.canRetry}
              style={{
                marginTop: '6px',
                background: subtitleProbeLoading || !subtitleDiagnostics.canRetry ? 'rgba(255,255,255,0.08)' : 'rgba(255,179,71,0.18)',
                color: subtitleProbeLoading || !subtitleDiagnostics.canRetry ? '#9090A0' : '#FFCF8A',
                border: '1px solid rgba(255,179,71,0.32)',
                borderRadius: '6px',
                cursor: subtitleProbeLoading || !subtitleDiagnostics.canRetry ? 'default' : 'pointer',
                fontSize: '10px',
                padding: '4px 7px',
              }}
            >
              {subtitleProbeLoading ? '检测中...' : '重新检测字幕'}
            </button>
            {subtitleProbeStatus && (
              <div style={{ color: '#C8E6FF', fontSize: '9px', lineHeight: 1.45, marginTop: '5px' }}>
                {subtitleProbeStatus}
              </div>
            )}
            {currentVideoActionError && (
              <div style={{ color: '#FFCF8A', fontSize: '10px', lineHeight: 1.45, marginTop: '5px' }}>
                {currentVideoActionError}
              </div>
            )}
          </div>
          {summary && (
            <div style={{
              marginTop: '8px',
              padding: '8px',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.12)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                <span style={{
                  color: '#FFD6E2',
                  background: 'rgba(251, 114, 153, 0.16)',
                  borderRadius: '6px',
                  padding: '3px 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                }}>
                  {summary.sourceTierLabel ?? summaryStatusLabel(summary.status)}
                </span>
                <span style={{ color: '#A0A0B0', fontSize: '10px' }}>
                  {summary.generationMode === 'ai' ? 'AI 生成' : '本地结果'} / 证据强度 {summaryConfidenceLabel(summary.confidence)}
                </span>
              </div>
              <p style={{
                color: '#E8E8F2',
                fontSize: '11px',
                lineHeight: 1.5,
                margin: '8px 0 0',
              }}>
                {summary.summary}
              </p>
              {summary.bullets.slice(0, 2).map((bullet, index) => (
                <div key={index} style={{ color: '#C8C8D8', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
                  - {bullet}
                </div>
              ))}
              {summary.timestampRanges.length > 0 && (
                <div style={{ marginTop: '6px' }}>
                  {summary.timestampRanges.slice(0, 2).map(range => (
                    <div key={`${range.label}:${range.evidenceSnippet}`} style={{ color: '#C8E6FF', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
                      证据片段 {range.label}：{range.evidenceSnippet}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#FFCF8A', fontSize: '10px', lineHeight: 1.45, marginTop: '6px' }}>
                {summary.limitations[0]}
              </div>
              <div style={{ color: '#9090A0', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
                AI 状态：{aiStatusLabel(summary.ai.status)}。{summary.ai.note}
              </div>
              {needsAiSettingsLink(summary.ai.status) && (
                <SettingsInlineButton onClick={onOpenSettings} />
              )}
            </div>
          )}
          <div style={{
            marginTop: '6px',
            color: '#FFCF8A',
            fontSize: '10px',
            lineHeight: 1.45,
          }}>
            {summary?.sourceTier === 'transcript_summary'
              ? '当前摘要使用本地字幕正文证据；时间范围只来自已缓存字幕片段。'
              : '当前没有可引用的字幕正文；本助手不会声称这是完整视频总结。'}
          </div>
          <VideoKnowledgePanel
            knowledge={knowledge}
            loading={knowledgeLoading || subtitleProbeLoading}
            onRefresh={onRefreshKnowledge}
          />
          <CurrentVideoSegmentRetrievalPanel
            subtitleDiagnostics={subtitleDiagnostics}
            query={segmentQuery}
            result={segmentResult}
            loading={segmentLoading}
            error={segmentError}
            previewCandidateId={segmentPreviewCandidateId}
            jumpStatus={segmentJumpStatus}
            returnAvailable={segmentReturnAvailable}
            jumpLoading={segmentJumpLoading}
            returnLoading={segmentReturnLoading}
            operationBlocked={subtitleProbeLoading}
            onQueryChange={setSegmentQuery}
            onSearch={searchCurrentVideoSegments}
            onPreviewCandidate={setSegmentPreviewCandidateId}
            onConfirmJump={confirmSegmentJump}
            onReturn={returnSegmentJump}
            onOpenSettings={onOpenSettings}
          />
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            <button
              onClick={onRefresh}
              disabled={loading || subtitleProbeLoading}
              style={{
                flex: 1,
                background: '#FB7299',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: loading || subtitleProbeLoading ? 'default' : 'pointer',
                fontSize: '11px',
                padding: '6px 8px',
                opacity: loading || subtitleProbeLoading ? 0.7 : 1,
              }}
            >
              {loading ? '加载中...' : '刷新摘要'}
            </button>
            {loading && (
              <button
                onClick={onCancel}
                style={{
                  background: 'rgba(255, 179, 71, 0.12)',
                  color: '#FFB347',
                  border: '1px solid rgba(255, 179, 71, 0.32)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '6px 8px',
                }}
              >
                取消
              </button>
            )}
          </div>
        </>
      ) : (
        <div style={{ color: '#A0A0B0', fontSize: '11px', lineHeight: 1.45 }}>
          没有当前视频上下文。请打开 B 站视频页后再查看元数据和来源可用性。
          <VideoKnowledgePanel
            knowledge={knowledge}
            loading={knowledgeLoading || subtitleProbeLoading}
            onRefresh={onRefreshKnowledge}
          />
        </div>
      )}
    </section>
  );
}

function CurrentVideoSegmentRetrievalPanel({
  subtitleDiagnostics,
  query,
  result,
  loading,
  error,
  previewCandidateId,
  jumpStatus,
  returnAvailable,
  jumpLoading,
  returnLoading,
  operationBlocked,
  onQueryChange,
  onSearch,
  onPreviewCandidate,
  onConfirmJump,
  onReturn,
  onOpenSettings,
}: {
  subtitleDiagnostics: CurrentVideoSubtitleDiagnostics;
  query: string;
  result: CurrentVideoSegmentRetrievalResult | null;
  loading: boolean;
  error: string | null;
  previewCandidateId: string | null;
  jumpStatus: string | null;
  returnAvailable: boolean;
  jumpLoading: boolean;
  returnLoading: boolean;
  operationBlocked: boolean;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onPreviewCandidate: (candidateId: string | null) => void;
  onConfirmJump: (candidate: CurrentVideoSegmentRetrievalCandidate) => void;
  onReturn: () => void;
  onOpenSettings: () => void;
}) {
  const previewCandidate = result?.candidates.find(candidate => candidate.id === previewCandidateId) ?? null;
  const aiExplanations = new Map(
    (result?.aiRerank.explanations ?? []).map(explanation => [explanation.candidateId, explanation]),
  );
  const searchGate = subtitleDiagnostics.featureGates.find(item => item.label === '片段检索');
  const jumpGate = subtitleDiagnostics.featureGates.find(item => item.label === '手动跳转');
  const timestampLoading = jumpLoading || returnLoading;
  const controlsDisabled = loading || timestampLoading || operationBlocked;
  return (
    <div style={{
      marginTop: '8px',
      padding: '8px',
      border: '1px solid rgba(127, 219, 255, 0.18)',
      borderRadius: '6px',
      background: 'rgba(0, 161, 214, 0.08)',
    }}>
      <div style={{ color: '#C8E6FF', fontSize: '10px', fontWeight: 700 }}>
        本地片段检索
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
        style={{ display: 'flex', gap: '6px', marginTop: '6px' }}
      >
        <input
          value={query}
          onInput={(event) => onQueryChange((event.currentTarget as HTMLInputElement).value)}
          placeholder="例如：模型架构那段"
          style={{
            minWidth: 0,
            flex: 1,
            background: 'rgba(255,255,255,0.08)',
            color: '#E8E8F2',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '6px',
            fontSize: '11px',
            padding: '6px 8px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={controlsDisabled}
          style={{
            width: '54px',
            background: controlsDisabled ? 'rgba(0, 161, 214, 0.12)' : 'rgba(0, 161, 214, 0.28)',
            color: '#C8E6FF',
            border: '1px solid rgba(127, 219, 255, 0.32)',
            borderRadius: '6px',
            cursor: controlsDisabled ? 'default' : 'pointer',
            fontSize: '10px',
            padding: '6px 8px',
          }}
        >
          {loading ? '检索中' : '检索'}
        </button>
      </form>
      <div style={{ color: '#A0A0B0', fontSize: '9px', lineHeight: 1.45, marginTop: '5px' }}>
        {searchGate?.message} {jumpGate?.message}
      </div>
      {error && (
        <div style={{ color: '#FFB347', fontSize: '10px', lineHeight: 1.45, marginTop: '6px' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ marginTop: '7px' }}>
          <div style={{ color: retrievalStatusColor(result), fontSize: '10px', lineHeight: 1.45 }}>
            {retrievalStatusMessage(result)}
          </div>
          {result.queryRewrite.expanded && result.queryRewrite.visibleExpandedTerms.length > 0 && (
            <div style={{ color: '#C8E6FF', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
              已扩展相关表达：{result.queryRewrite.visibleExpandedTerms.slice(0, 6).join('、')}
            </div>
          )}
          <div style={{ color: segmentAiRerankColor(result.aiRerank.status), fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
            AI 重排：{segmentAiRerankStatusLabel(result.aiRerank.status)}。{result.aiRerank.note}
          </div>
          {needsAiSettingsLink(result.aiRerank.status) && (
            <SettingsInlineButton onClick={onOpenSettings} />
          )}
          {result.candidates.length === 0 ? (
            <div style={{ color: '#A0A0B0', fontSize: '10px', lineHeight: 1.45, marginTop: '5px' }}>
              {result.limitations[0]}
            </div>
          ) : (
            result.candidates.map((candidate, index) => (
              <SegmentCandidateCard
                key={candidate.id}
                candidate={candidate}
                index={index}
                selected={candidate.id === previewCandidateId}
                aiExplanation={aiExplanations.get(candidate.id) ?? null}
                onPreview={onPreviewCandidate}
                disabled={controlsDisabled}
              />
            ))
          )}
          {previewCandidate && (
            <SegmentJumpPreview
              candidate={previewCandidate}
              onConfirm={onConfirmJump}
              onCancel={() => onPreviewCandidate(null)}
              disabled={controlsDisabled}
              loading={jumpLoading}
            />
          )}
          {jumpStatus && (
            <div style={{ color: jumpStatus.includes('不能') || jumpStatus.includes('不可') || jumpStatus.includes('过期') ? '#FFCF8A' : '#A0E7A0', fontSize: '10px', lineHeight: 1.45, marginTop: '6px' }}>
              {jumpStatus}
            </div>
          )}
          {returnAvailable && (
            <button
              type="button"
              onClick={onReturn}
              disabled={controlsDisabled}
              style={{
                marginTop: '6px',
                width: '100%',
                background: 'rgba(255, 179, 71, 0.18)',
                color: '#FFCF8A',
                border: '1px solid rgba(255, 179, 71, 0.34)',
                borderRadius: '6px',
                cursor: controlsDisabled ? 'default' : 'pointer',
                fontSize: '10px',
                fontWeight: 700,
                padding: '5px 7px',
              }}
            >
              {returnLoading ? '返回中...' : '返回原位置'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SegmentCandidateCard({
  candidate,
  index,
  selected,
  aiExplanation,
  onPreview,
  disabled,
}: {
  candidate: CurrentVideoSegmentRetrievalCandidate;
  index: number;
  selected: boolean;
  aiExplanation: CurrentVideoSegmentRerankExplanation | null;
  onPreview: (candidateId: string | null) => void;
  disabled: boolean;
}) {
  const canJump = candidate.jumpPreview.canJump;
  return (
    <div style={{
      marginTop: '6px',
      paddingTop: '6px',
      borderTop: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, color: '#E8E8F2', fontSize: '10px', lineHeight: 1.35, fontWeight: 650 }}>
          候选 {index + 1} · {candidate.timeRangeLabel}
        </div>
        <div style={{
          flex: '0 0 auto',
          color: candidate.confidenceLabel === '低' ? '#FFCF8A' : '#A0E7A0',
          fontSize: '9px',
          lineHeight: 1.35,
        }}>
          {candidate.confidenceLabel} {Math.round(candidate.confidence * 100)}%
        </div>
      </div>
      <div style={{ color: '#A0A0B0', fontSize: '9px', lineHeight: 1.4, marginTop: '2px' }}>
        来源 {candidate.sourceLabel}
      </div>
      <div style={{ color: '#C8E6FF', fontSize: '9px', lineHeight: 1.4, marginTop: '3px' }}>
        证据片段：{candidate.evidenceText || '暂无可展示文本'}
      </div>
      <div style={{ color: '#C8C8D8', fontSize: '9px', lineHeight: 1.4, marginTop: '3px' }}>
        匹配原因：{candidate.matchReasons.join('；')}
      </div>
      {candidate.note && (
        <div style={{ color: '#FFCF8A', fontSize: '9px', lineHeight: 1.4, marginTop: '3px' }}>
          {candidate.note}
        </div>
      )}
      {aiExplanation && (
        <div style={{ color: '#D8F5FF', fontSize: '9px', lineHeight: 1.45, marginTop: '3px' }}>
          AI 解释：{aiExplanation.explanation}（{Math.round(aiExplanation.confidence * 100)}%）
          <br />
          排序理由：{aiExplanation.reason}
        </div>
      )}
      <div style={{ color: canJump ? '#A0E7A0' : '#FFCF8A', fontSize: '9px', lineHeight: 1.4, marginTop: '3px' }}>
        {candidate.jumpPreview.message}
      </div>
      <button
        type="button"
        disabled={!canJump || disabled}
        onClick={() => onPreview(selected ? null : candidate.id)}
        style={{
          marginTop: '5px',
          background: canJump ? 'rgba(0, 161, 214, 0.20)' : 'rgba(255, 255, 255, 0.06)',
          color: canJump ? '#C8E6FF' : '#9090A0',
          border: canJump ? '1px solid rgba(127, 219, 255, 0.32)' : '1px solid rgba(255,255,255,0.10)',
          borderRadius: '6px',
          cursor: canJump && !disabled ? 'pointer' : 'default',
          fontSize: '10px',
          padding: '4px 7px',
          opacity: canJump && !disabled ? 1 : 0.75,
        }}
      >
        {canJump ? (selected ? '收起预览' : '预览跳转') : '不可跳转'}
      </button>
    </div>
  );
}

function SegmentJumpPreview({
  candidate,
  onConfirm,
  onCancel,
  disabled,
  loading,
}: {
  candidate: CurrentVideoSegmentRetrievalCandidate;
  onConfirm: (candidate: CurrentVideoSegmentRetrievalCandidate) => void;
  onCancel: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  const preview = candidate.jumpPreview;
  return (
    <div style={{
      marginTop: '8px',
      padding: '8px',
      border: '1px solid rgba(255,179,71,0.28)',
      borderRadius: '6px',
      background: 'rgba(255,179,71,0.08)',
    }}>
      <div style={{ color: '#FFCF8A', fontSize: '10px', lineHeight: 1.45, fontWeight: 700 }}>
        确认跳转前预览
      </div>
      <div style={{ color: '#E8E8F2', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
        目标时间：{preview.targetTimeLabel ?? candidate.timeRangeLabel}
      </div>
      <div style={{ color: '#A0A0B0', fontSize: '9px', lineHeight: 1.45, marginTop: '2px' }}>
        来源：{preview.sourceLabel}；置信度：{preview.confidenceLabel} {Math.round(preview.confidence * 100)}%
      </div>
      <div style={{ color: '#C8E6FF', fontSize: '9px', lineHeight: 1.45, marginTop: '3px' }}>
        证据预览：{preview.evidencePreview || '暂无可展示文本'}
      </div>
      <div style={{ color: preview.canJump ? '#A0E7A0' : '#FFCF8A', fontSize: '9px', lineHeight: 1.45, marginTop: '3px' }}>
        {preview.message}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        <button
          type="button"
          disabled={!preview.canJump || disabled}
          onClick={() => onConfirm(candidate)}
          style={{
            flex: 1,
            background: preview.canJump ? '#FFB347' : 'rgba(255,255,255,0.08)',
            color: preview.canJump ? '#1A1A2E' : '#9090A0',
            border: 'none',
            borderRadius: '6px',
            cursor: preview.canJump && !disabled ? 'pointer' : 'default',
            fontSize: '10px',
            fontWeight: 700,
            padding: '5px 7px',
          }}
        >
          {loading ? '确认中...' : '确认跳转'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          style={{
            background: 'transparent',
            color: '#C8C8D8',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '6px',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: '10px',
            padding: '5px 7px',
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}

function VideoKnowledgePanel({
  knowledge,
  loading,
  onRefresh,
}: {
  knowledge: VideoKnowledgeResult | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const nodes = knowledge?.nodes ?? [];
  const transcriptNodeCount = nodes.filter(node => node.source === 'transcript').length;
  return (
    <div style={{
      marginTop: '8px',
      padding: '8px',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px',
      background: 'rgba(0,0,0,0.10)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
        <span style={{ color: '#FFD6E2', fontSize: '10px', fontWeight: 700 }}>
          视频知识节点
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: 'transparent',
            color: '#A0A0B0',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '6px',
            cursor: loading ? 'default' : 'pointer',
            fontSize: '10px',
            padding: '3px 6px',
          }}
        >
          {loading ? '读取中...' : '刷新'}
        </button>
      </div>
      <div style={{ color: '#FFCF8A', fontSize: '10px', lineHeight: 1.45, marginTop: '6px' }}>
        {videoKnowledgeNotice(knowledge, transcriptNodeCount)}
      </div>
      {nodes.length === 0 ? (
        <div style={{ color: '#A0A0B0', fontSize: '10px', lineHeight: 1.45, marginTop: '6px' }}>
          {knowledge?.status === 'no_context'
            ? '当前没有可用于知识节点的视频上下文。'
            : '当前没有足够安全的关键节点候选。'}
        </div>
      ) : (
        nodes.slice(0, 5).map(node => (
          <div key={node.id} style={{
            marginTop: '6px',
            paddingTop: '6px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ color: '#E8E8F2', fontSize: '10px', lineHeight: 1.35, fontWeight: 650 }}>
              {node.title}
            </div>
            <div style={{ color: '#A0A0B0', fontSize: '9px', lineHeight: 1.45, marginTop: '2px' }}>
              来源 {node.sourceLabel} / 证据强度 {Math.round(node.confidence * 100)}%
              {node.timestamp === null ? ' / 无时间点' : ` / ${formatNodeTimeRange(node)}`}
              {node.evidence?.sourceStatus ? ` / 来源状态 ${evidenceSourceStatusLabel(node.evidence.sourceStatus)}` : ''}
            </div>
            <div style={{ color: '#C8C8D8', fontSize: '9px', lineHeight: 1.4, marginTop: '2px' }}>
              {node.reason}
            </div>
            {node.evidence?.textSpan && (
              <div style={{ color: '#C8E6FF', fontSize: '9px', lineHeight: 1.4, marginTop: '2px' }}>
                证据片段：{node.evidence.textSpan}
              </div>
            )}
            {node.source === 'transcript' && node.timestamp !== null && (
              <div style={{ color: '#9090A0', fontSize: '9px', lineHeight: 1.4, marginTop: '2px' }}>
                字幕证据：{formatNodeTimeRange(node)}；来自当前视频字幕片段，暂不提供跳转。
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

async function popupCurrentVideoPrimaryTextAuthorization(
  context: CurrentVideoContextResult | null,
): Promise<CurrentVideoPrimaryTextAuthorization> {
  if (context?.kind !== 'video') {
    return {
      ready: false,
      source: null,
      selectedSourceIdentityKey: null,
      message: '当前没有可用的视频上下文，请保持 B 站视频页打开后重试。',
      params: { primaryTextSelectionsReady: false },
    };
  }

  const readResult = await readCurrentVideoPrimaryTextSelections(chrome.storage.local);
  const evidence = context.transcriptEvidence;
  const availableSourceIdentityKeys = (
    context.cid
    && evidence?.active === true
    && evidence.bvid === context.bvid
    && evidence.cid === context.cid
    && evidence.page === context.currentPart.page
    && evidence.sourceIdentityKey
    && evidence.sourceHash
    && evidence.bodyHash
    && evidence.timelineHash
  )
    ? [evidence.sourceIdentityKey]
    : [];

  return resolveCurrentVideoPrimaryTextAuthorization({
    readStatus: readResult.status,
    identity: {
      bvid: context.bvid,
      cid: context.cid,
      page: context.currentPart.page,
    },
    selections: readResult.selections,
    availableSourceIdentityKeys,
  });
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
  if (state.tone === 'ready') return '#A0E7A0';
  if (state.tone === 'info') return '#C8E6FF';
  if (state.tone === 'blocked') return '#FF8A8A';
  return '#FFCF8A';
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

function videoKnowledgeNotice(knowledge: VideoKnowledgeResult | null, transcriptNodeCount: number): string {
  if (!knowledge) return '尚未读取当前视频知识节点，请手动刷新。';
  if (transcriptNodeCount > 0) {
    return `已用当前视频本地字幕证据生成 ${transcriptNodeCount} 个节点；时间范围只来自字幕片段，暂不提供跳转。`;
  }
  const evidence = knowledge.transcriptEvidence;
  if (!evidence) {
    return '当前没有可引用字幕正文。节点只使用元数据、简介、分 P 或章节；不会生成推测时间戳。';
  }
  if (evidence.status === 'stale') {
    return '本地字幕证据与当前视频或分 P 不匹配，已回退到元数据、简介、分 P 或章节节点。';
  }
  if (evidence.status === 'language_mismatch') {
    return '本地字幕语言与当前请求不匹配，暂不生成字幕节点。';
  }
  if (evidence.status === 'empty') {
    return '已检测到字幕来源，但没有可用正文片段，暂不生成字幕节点。';
  }
  if (evidence.status === 'malformed') {
    return '字幕正文结构异常，暂不作为节点证据。';
  }
  if (evidence.active) {
    return '已检测到本地字幕证据，但没有匹配当前版本的可用片段，已回退到辅助节点。';
  }
  return evidence.message || '当前没有可引用字幕正文；不会生成推测时间戳。';
}

function evidenceSourceStatusLabel(
  status: NonNullable<NonNullable<VideoKnowledgeNode['evidence']>['sourceStatus']>,
): string {
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

function retrievalStatusMessage(result: CurrentVideoSegmentRetrievalResult): string {
  switch (result.status) {
    case 'ready':
      return result.summary;
    case 'low_confidence':
      return result.summary;
    case 'metadata_only':
      return result.summary;
    case 'empty_query':
      return '请输入想查找的片段内容。';
    case 'no_context':
      return '当前没有可用的视频上下文。';
    case 'stale_context':
      return '当前视频上下文已过期，请刷新后再试。';
    case 'no_evidence':
      return '没有找到可用的本地证据。';
    default:
      return result.summary;
  }
}

function retrievalStatusColor(result: CurrentVideoSegmentRetrievalResult): string {
  if (result.status === 'ready') return '#A0E7A0';
  if (result.status === 'metadata_only' || result.status === 'low_confidence') return '#FFCF8A';
  return '#A0A0B0';
}

function segmentAiRerankStatusLabel(status: CurrentVideoSegmentRetrievalResult['aiRerank']['status']): string {
  switch (status) {
    case 'generated':
      return '已采用';
    case 'disabled':
      return '未启用';
    case 'not_configured':
      return '未配置';
    case 'failed':
      return '请求失败已回退';
    case 'rejected':
      return '结果未采用';
    case 'low_confidence':
      return '低置信已回退';
    case 'not_requested':
      return '未请求';
    default:
      return '本地顺序';
  }
}

function segmentAiRerankColor(status: CurrentVideoSegmentRetrievalResult['aiRerank']['status']): string {
  if (status === 'generated') return '#A0E7A0';
  if (status === 'disabled' || status === 'not_requested') return '#A0A0B0';
  return '#FFCF8A';
}

function SettingsInlineButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        marginTop: '6px',
        background: 'rgba(0, 161, 214, 0.18)',
        color: '#C8E6FF',
        border: '1px solid rgba(127, 219, 255, 0.32)',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '10px',
        padding: '4px 7px',
      }}
    >
      前往设置
    </button>
  );
}

function needsAiSettingsLink(status: string): boolean {
  return status === 'disabled' || status === 'not_configured';
}

function formatNodeTimeRange(node: VideoKnowledgeNode): string {
  if (node.timestamp === null) return '无时间点';
  if (typeof node.endTimestamp === 'number' && node.endTimestamp > node.timestamp) {
    return `${formatPopupDuration(node.timestamp)}-${formatPopupDuration(node.endTimestamp)}`;
  }
  return formatPopupDuration(node.timestamp);
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function summaryStatusLabel(status: CurrentVideoSummaryResult['status']): string {
  switch (status) {
    case 'ready':
      return '可用';
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

function summaryConfidenceLabel(confidence: CurrentVideoSummaryResult['confidence']): string {
  if (confidence === 'high') return '高';
  return confidence === 'medium' ? '中' : '低';
}

function aiStatusLabel(status: CurrentVideoSummaryResult['ai']['status']): string {
  switch (status) {
    case 'not_requested':
      return '未请求';
    case 'disabled':
      return '未启用';
    case 'not_configured':
      return '未配置';
    case 'generated':
      return '已生成';
    case 'failed':
      return '失败';
    case 'low_confidence':
      return '低置信';
    case 'invalid_output':
      return '越界已回退';
    default:
      return '未知状态';
  }
}

function formatBoolean(value: boolean): string {
  return value ? '是' : '否';
}

function formatPopupDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatTailProbeReport(report: HistoryTailProbeReport): string {
  const lines = [
    `请求页数=${report.requestedMaxPages ?? '默认'}；规范化页数=${report.normalizedPageLimit}；每页=${report.pageSize}`,
    `已获取页数=${report.fetchedPages}；已获取条目=${report.fetchedItems}；停止原因=${report.stopReason}；到达末页=${formatBoolean(report.reachedDeclaredEnd)}`,
    `时间范围=${formatProbeViewAt(report.oldestFetchedAt)} -> ${formatProbeViewAt(report.newestFetchedAt)}`,
    `重复游标=${formatBoolean(report.repeatedCursorDetected)}；短页=${report.shortPageAnomalyCount}；空页异常=${report.emptyPageAnomalyCount}`,
  ];

  if (report.finalCursor) {
    lines.push(`最终游标=${formatProbeCursor(report.finalCursor)}`);
  }

  for (const page of report.pages) {
    lines.push(
      `第 ${page.pageIndex} 页：条目=${page.itemCount}；范围=${formatProbeViewAt(page.oldestViewAt)} -> ${formatProbeViewAt(page.newestViewAt)}；请求游标=${formatProbeCursor(page.requestedCursor)}；响应游标=${formatProbeCursor(page.responseCursor)}；重复=${formatBoolean(page.repeatedCursor)}；短页=${formatBoolean(page.shortPageAnomaly)}；空页=${formatBoolean(page.emptyPage)}；末页=${formatBoolean(page.declaredEnd)}`,
    );
  }

  return lines.join('\n');
}

function formatProbeCursor(cursor: HistoryTailProbeReport['finalCursor']): string {
  if (!cursor) return '初始';
  return `max=${cursor.max ?? '空'},view_at=${cursor.viewAt ?? '空'},business=${cursor.business ?? '空'},has_more=${cursor.hasMore == null ? '空' : formatBoolean(cursor.hasMore)}`;
}

function formatProbeViewAt(value: number | null): string {
  if (!value) return '无';
  return new Date(value * 1000).toLocaleString('zh-CN');
}
