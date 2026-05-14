import { useEffect } from 'preact/hooks';
import { overviewData, overviewLoading, overviewError } from '../../signals';
import { requestSW } from '../../utils/messaging';
import type { DashboardOverview } from '../../../src/shared/types/analytics';
import { ChartContainer } from '../../components/ChartContainer';
import { StatCard } from '../../components/StatCard';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { formatTimeHHMM, formatPercent } from '../../../src/shared/utils/format';
import { HOUR_LABELS, WEEKDAY_LABELS, BILI_PINK } from '../../../src/shared/constants';

export function OverviewPage() {
  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    overviewLoading.value = true;
    overviewError.value = null;
    try {
      overviewData.value = await requestSW<DashboardOverview>('GET_DASHBOARD_DATA');
    } catch (e) {
      overviewError.value = (e as Error).message;
    } finally {
      overviewLoading.value = false;
    }
  }

  if (overviewLoading.value) return <div style={{ padding: '16px' }}><LoadingSkeleton height={400} /></div>;
  if (overviewError.value) return <div style={{ padding: '16px', color: '#FF6B6B' }}>{overviewError.value}</div>;
  const d = overviewData.value;
  if (!d) return <EmptyState />;

  const heatmapOption = {
    tooltip: { position: 'top' },
    grid: { top: 30, right: 20, bottom: 20, left: 50 },
    xAxis: { type: 'category', data: HOUR_LABELS, splitArea: { show: true } },
    yAxis: { type: 'category', data: WEEKDAY_LABELS, splitArea: { show: true } },
    visualMap: { min: 0, max: Math.max(...d.hourlyHeatmap.flat(), 1), calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#1A1A2E', '#00A1D6', '#FB7299'] } },
    series: [{
      type: 'heatmap',
      data: d.hourlyHeatmap.flatMap((row, hour) => row.map((val, day) => [hour, day, val])),
      label: { show: false },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
    }],
  };

  return (
    <ErrorBoundary>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <StatCard label="本周观看" value={formatTimeHHMM(d.weeklyWatchTime)} change={d.weeklyChange} accent={BILI_PINK} />
          <StatCard label="本月观看" value={formatTimeHHMM(d.monthlyWatchTime)} change={d.monthlyChange} accent="#00A1D6" />
          <StatCard label="平均完播率" value={formatPercent(d.avgCompletion)} accent="#00D4AA" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <StatCard label="连续天数" value={`${d.streakDays}天`} />
          <StatCard label="效率评分" value={`${d.efficiencyScore}分`} />
        </div>
        <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 8px 12px' }}>活跃时段热力图</h3>
          <ChartContainer option={heatmapOption} height={280} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
