import { useEffect } from 'preact/hooks';
import { quickStats, loading, error, lastSyncResult, syncInProgress, syncProgress, syncPageLimit } from './signals';
import { requestSW } from './utils/messaging';
import type { QuickStats } from '../src/shared/types/analytics';
import type { SyncNowResult, SyncProgress } from '../src/shared/types/messages';
import { ProgressRing } from './components/ProgressRing';
import { QuickStats as QuickStatsPanel } from './components/QuickStats';
import { OpenDashboard } from './components/OpenDashboard';

interface SyncStatus {
  lastSyncTime: number;
  totalRecords: number;
  syncProgress: SyncProgress | null;
}

export function App() {
  useEffect(() => {
    fetchStats(false);
    const timer = window.setInterval(refreshSyncStatus, 1500);
    return () => window.clearInterval(timer);
  }, []);

  async function refreshSyncStatus() {
    try {
      const status = await requestSW<SyncStatus>('GET_SYNC_STATUS');
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

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', gap: '8px' }}>
        <h1 style={{
          fontSize: '16px',
          fontWeight: 700,
          color: '#FB7299',
          textAlign: 'center',
          margin: 0,
        }}>
          B站消费数据中心
        </h1>
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
          <OpenDashboard />
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
