import { useEffect } from 'preact/hooks';
import { quickStats, loading, error } from './signals';
import { requestSW } from './utils/messaging';
import type { QuickStats } from '../src/shared/types/analytics';
import { ProgressRing } from './components/ProgressRing';
import { QuickStats as QuickStatsPanel } from './components/QuickStats';
import { OpenDashboard } from './components/OpenDashboard';

export function App() {
  useEffect(() => {
    fetchStats(false);
  }, []);

  async function fetchStats(forceSync = true) {
    loading.value = true;
    error.value = null;
    try {
      if (forceSync) {
        await requestSW('SYNC_NOW').catch(() => {});
      }
      const data = await requestSW<QuickStats>('GET_QUICK_STATS');
      quickStats.value = data;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  const isNotLoggedIn = error.value?.includes('NOT_LOGGED_IN') || error.value?.includes('-101');

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
          title="同步并刷新数据"
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
