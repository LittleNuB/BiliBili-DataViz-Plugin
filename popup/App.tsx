import { useEffect } from 'preact/hooks';
import { quickStats, loading, error } from './signals';
import { requestSW } from './utils/messaging';
import type { QuickStats } from '../src/shared/types/analytics';
import { ProgressRing } from './components/ProgressRing';
import { QuickStats as QuickStatsPanel } from './components/QuickStats';
import { OpenDashboard } from './components/OpenDashboard';

export function App() {
  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    loading.value = true;
    error.value = null;
    try {
      const data = await requestSW<QuickStats>('GET_QUICK_STATS');
      quickStats.value = data;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <h1 style={{
        fontSize: '16px',
        fontWeight: 700,
        color: '#FB7299',
        textAlign: 'center',
        margin: '0 0 4px 0',
        padding: '0 12px',
      }}>
        B站消费数据中心
      </h1>

      {loading.value && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9090A0' }}>
          加载中...
        </div>
      )}

      {error.value && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#FF6B6B' }}>
          <p>{error.value}</p>
          <button
            onClick={fetchStats}
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
