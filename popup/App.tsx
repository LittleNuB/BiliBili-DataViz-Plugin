import { useEffect, useRef, useState } from 'preact/hooks';
import { quickStats, loading, error, lastSyncResult, syncInProgress, syncProgress, syncPageLimit } from './signals';
import { requestSW } from './utils/messaging';
import type { QuickStats } from '../src/shared/types/analytics';
import type { SyncNowResult } from '../src/shared/types/messages';
import type { HistoryTailProbeReport } from '../src/shared/types/history-tail-probe';
import type { HistorySyncProgress, HistorySyncStatus } from '../src/shared/types/history-sync';
import type {
  CurrentVideoContextResult,
  CurrentVideoSubtitleSourceState,
} from '../src/shared/types/current-video-context';
import type { CurrentVideoTranscriptEvidenceState } from '../src/shared/types/current-video-transcript';
import type { CurrentVideoSummaryResult } from '../src/shared/types/current-video-summary';
import type { VideoKnowledgeJumpResponse, VideoKnowledgeNode, VideoKnowledgeResult } from '../src/shared/types/video-knowledge';
import { cancelledCurrentVideoSummary, loadingCurrentVideoSummary } from '../src/shared/current-video-summary';
import { ProgressRing } from './components/ProgressRing';
import { QuickStats as QuickStatsPanel } from './components/QuickStats';
import { OpenDashboard } from './components/OpenDashboard';

export function App() {
  const [currentVideoContext, setCurrentVideoContext] = useState<CurrentVideoContextResult | null>(null);
  const [currentVideoSummary, setCurrentVideoSummary] = useState<CurrentVideoSummaryResult | null>(null);
  const [videoKnowledge, setVideoKnowledge] = useState<VideoKnowledgeResult | null>(null);
  const [jumpPreviewNodeId, setJumpPreviewNodeId] = useState<string | null>(null);
  const [jumpStatus, setJumpStatus] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [tailProbeReport, setTailProbeReport] = useState<HistoryTailProbeReport | null>(null);
  const [tailProbeLoading, setTailProbeLoading] = useState(false);
  const [tailProbeError, setTailProbeError] = useState<string | null>(null);
  const summaryRequestRef = useRef(0);

  useEffect(() => {
    fetchStats(false);
    fetchCurrentVideoContext();
    fetchCurrentVideoSummary();
    fetchVideoKnowledge();
    const timer = window.setInterval(refreshSyncStatus, 1500);
    return () => window.clearInterval(timer);
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
    try {
      const context = await requestSW<CurrentVideoContextResult>('GET_CURRENT_VIDEO_CONTEXT');
      setCurrentVideoContext(context);
    } catch {
      setCurrentVideoContext(null);
    }
  }

  async function fetchCurrentVideoSummary() {
    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    setSummaryLoading(true);
    setCurrentVideoSummary(loadingCurrentVideoSummary());
    try {
      const summary = await requestSW<CurrentVideoSummaryResult>('GET_CURRENT_VIDEO_SUMMARY');
      if (summaryRequestRef.current !== requestId) return;
      setCurrentVideoSummary(summary);
    } catch (e) {
      if (summaryRequestRef.current !== requestId) return;
      setCurrentVideoSummary({
        ...loadingCurrentVideoSummary(),
        status: 'cancelled',
        title: '当前视频摘要不可用',
        summary: (e as Error).message,
        limitations: ['在采用 AI 结果前，本地摘要请求已经失败。'],
      });
    } finally {
      if (summaryRequestRef.current === requestId) setSummaryLoading(false);
    }
  }

  async function fetchVideoKnowledge() {
    try {
      const result = await requestSW<VideoKnowledgeResult>('GET_VIDEO_KNOWLEDGE');
      setVideoKnowledge(result);
      setJumpPreviewNodeId(null);
      setJumpStatus(null);
    } catch (e) {
      setVideoKnowledge({
        status: 'no_context',
        title: '视频知识节点不可用',
        generatedAt: Date.now(),
        sourceState: {
          metadata: false,
          description: false,
          pages: false,
          chapters: false,
          transcript: false,
          transcriptEvidence: false,
          contentText: false,
        },
        transcriptEvidence: null,
        nodes: [],
        warnings: ['video_knowledge_request_failed'],
        limitations: [(e as Error).message],
      });
    }
  }

  async function confirmVideoKnowledgeJump(node: VideoKnowledgeNode) {
    if (!node.jumpAction) return;
    setJumpStatus('正在确认手动跳转...');
    try {
      const result = await requestSW<VideoKnowledgeJumpResponse>('REQUEST_VIDEO_KNOWLEDGE_JUMP', {
        nodeId: node.id,
        confirmed: true,
      });
      setJumpStatus(result.message);
    } catch (e) {
      setJumpStatus((e as Error).message);
    }
  }

  function cancelCurrentVideoSummary() {
    summaryRequestRef.current += 1;
    setSummaryLoading(false);
    setCurrentVideoSummary(cancelledCurrentVideoSummary(currentVideoContext));
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
        previewNodeId={jumpPreviewNodeId}
        jumpStatus={jumpStatus}
        loading={summaryLoading}
        onRefresh={fetchCurrentVideoSummary}
        onCancel={cancelCurrentVideoSummary}
        onRefreshKnowledge={fetchVideoKnowledge}
        onPreviewNode={setJumpPreviewNodeId}
        onConfirmJump={confirmVideoKnowledgeJump}
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
  previewNodeId,
  jumpStatus,
  loading,
  onRefresh,
  onCancel,
  onRefreshKnowledge,
  onPreviewNode,
  onConfirmJump,
}: {
  context: CurrentVideoContextResult | null;
  summary: CurrentVideoSummaryResult | null;
  knowledge: VideoKnowledgeResult | null;
  previewNodeId: string | null;
  jumpStatus: string | null;
  loading: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onRefreshKnowledge: () => void;
  onPreviewNode: (nodeId: string | null) => void;
  onConfirmJump: (node: VideoKnowledgeNode) => void;
}) {
  const isVideo = context?.kind === 'video';
  const previewNode = knowledge?.nodes.find(node => node.id === previewNodeId) ?? null;

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
            {context.title ?? context.bvid}
          </div>
          <div style={{ color: '#A0A0B0', fontSize: '10px', lineHeight: 1.5, marginTop: '4px' }}>
            BVID {context.bvid} / CID {context.cid ?? '未知'}
            <br />
            简介 {availabilityLabel(context.sources.description)}；字幕 {availabilityLabel(context.sources.transcript)}；正文文本 {availabilityLabel(context.sources.contentText)}
            {context.subtitleProbe && (
              <>
                <br />
                {subtitleProbeDetail(context.subtitleProbe)}
              </>
            )}
            {context.transcriptEvidence && context.transcriptEvidence.status !== 'missing' && (
              <>
                <br />
                {transcriptEvidenceDetail(context.transcriptEvidence)}
              </>
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
            previewNode={previewNode}
            jumpStatus={jumpStatus}
            onRefresh={onRefreshKnowledge}
            onPreview={onPreviewNode}
            onConfirm={onConfirmJump}
          />
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            <button
              onClick={onRefresh}
              disabled={loading}
              style={{
                flex: 1,
                background: '#FB7299',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: loading ? 'default' : 'pointer',
                fontSize: '11px',
                padding: '6px 8px',
                opacity: loading ? 0.7 : 1,
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
            previewNode={previewNode}
            jumpStatus={jumpStatus}
            onRefresh={onRefreshKnowledge}
            onPreview={onPreviewNode}
            onConfirm={onConfirmJump}
          />
        </div>
      )}
    </section>
  );
}

function VideoKnowledgePanel({
  knowledge,
  previewNode,
  jumpStatus,
  onRefresh,
  onPreview,
  onConfirm,
}: {
  knowledge: VideoKnowledgeResult | null;
  previewNode: VideoKnowledgeNode | null;
  jumpStatus: string | null;
  onRefresh: () => void;
  onPreview: (nodeId: string | null) => void;
  onConfirm: (node: VideoKnowledgeNode) => void;
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
          style={{
            background: 'transparent',
            color: '#A0A0B0',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '10px',
            padding: '3px 6px',
          }}
        >
          刷新
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
            {node.source === 'transcript' && node.evidence?.segmentId && (
              <div style={{ color: '#9090A0', fontSize: '9px', lineHeight: 1.4, marginTop: '2px', wordBreak: 'break-all' }}>
                字幕证据编号：{compactEvidenceId(node.evidence.segmentId)}；暂不提供跳转。
              </div>
            )}
            {node.jumpAction && (
              <button
                onClick={() => onPreview(node.id)}
                style={{
                  marginTop: '5px',
                  background: 'rgba(251, 114, 153, 0.18)',
                  color: '#FFD6E2',
                  border: '1px solid rgba(251, 114, 153, 0.32)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '4px 7px',
                }}
              >
                预览跳转
              </button>
            )}
          </div>
        ))
      )}
      {previewNode?.jumpAction && (
        <div style={{
          marginTop: '8px',
          padding: '8px',
          border: '1px solid rgba(255,179,71,0.28)',
          borderRadius: '6px',
          background: 'rgba(255,179,71,0.08)',
        }}>
          <div style={{ color: '#FFCF8A', fontSize: '10px', lineHeight: 1.45, fontWeight: 700 }}>
            手动跳转预览
          </div>
          <div style={{ color: '#E8E8F2', fontSize: '10px', lineHeight: 1.45, marginTop: '4px' }}>
            {previewNode.jumpAction.previewLabel}
          </div>
          <div style={{ color: '#A0A0B0', fontSize: '9px', lineHeight: 1.45, marginTop: '2px' }}>
            来源：{previewNode.sourceLabel}。必须确认后才会跳转；自动跳转默认关闭。
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <button
              onClick={() => onConfirm(previewNode)}
              style={{
                flex: 1,
                background: '#FFB347',
                color: '#1A1A2E',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 700,
                padding: '5px 7px',
              }}
            >
              确认跳转
            </button>
            <button
              onClick={() => onPreview(null)}
              style={{
                background: 'transparent',
                color: '#C8C8D8',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '10px',
                padding: '5px 7px',
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {jumpStatus && (
        <div style={{ color: '#A0E7A0', fontSize: '10px', lineHeight: 1.45, marginTop: '6px' }}>
          {jumpStatus}
        </div>
      )}
    </div>
  );
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

function subtitleProbeDetail(probe: CurrentVideoSubtitleSourceState): string {
  if (!probe.available) return probe.message;
  const languages = probe.languages.length > 0 ? `；语言 ${probe.languages.join(', ')}` : '';
  const coverage = typeof probe.coverageEndSeconds === 'number'
    ? `；覆盖至 ${formatSeconds(probe.coverageEndSeconds)}`
    : '';
  return `${probe.message}（字幕轨道 ${probe.trackCount}${languages}${coverage}）`;
}

function transcriptEvidenceDetail(evidence: CurrentVideoTranscriptEvidenceState): string {
  if (!evidence.active) return evidence.message;
  return `${evidence.message} 已缓存片段=${evidence.segmentCount}`;
}

function videoKnowledgeNotice(knowledge: VideoKnowledgeResult | null, transcriptNodeCount: number): string {
  if (!knowledge) return '正在读取当前视频的知识节点。';
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

function formatNodeTimeRange(node: VideoKnowledgeNode): string {
  if (node.timestamp === null) return '无时间点';
  if (typeof node.endTimestamp === 'number' && node.endTimestamp > node.timestamp) {
    return `${formatPopupDuration(node.timestamp)}-${formatPopupDuration(node.endTimestamp)}`;
  }
  return formatPopupDuration(node.timestamp);
}

function compactEvidenceId(segmentId: string): string {
  if (segmentId.length <= 40) return segmentId;
  return `${segmentId.slice(0, 24)}...${segmentId.slice(-12)}`;
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
