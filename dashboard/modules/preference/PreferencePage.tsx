import { useEffect } from 'preact/hooks';
import { prefData, prefLoading, prefError } from '../../signals';
import { requestSW } from '../../utils/messaging';
import type { CategoryDistribution, InterestDrift, DurationBucket } from '../../../src/shared/types/analytics';
import { ChartContainer } from '../../components/ChartContainer';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { CHART_COLORS, DURATION_BUCKETS } from '../../../src/shared/constants';

export function PreferencePage() {
  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    prefLoading.value = true;
    prefError.value = null;
    try {
      prefData.value = await requestSW<typeof prefData.value>('GET_PREFERENCE_DATA');
    } catch (e) {
      prefError.value = (e as Error).message;
    } finally {
      prefLoading.value = false;
    }
  }

  if (prefLoading.value) return <div style={{ padding: '16px' }}><LoadingSkeleton height={400} /></div>;
  if (prefError.value) return <div style={{ padding: '16px', color: '#FF6B6B' }}>{prefError.value}</div>;
  const d = prefData.value;
  if (!d) return <EmptyState />;

  const pieOption = {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {d}%' },
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      data: d.categories.slice(0, 8).map((c: CategoryDistribution, i: number) => ({ name: c.name, value: c.watchTime })),
      label: { color: '#A0A0B0' },
    }],
  };

  const driftCategories = [...new Set(d.drift.flatMap((m: InterestDrift) => Object.keys(m.categories)))].slice(0, 5);
  const driftOption = {
    tooltip: { trigger: 'axis' as const },
    legend: { textStyle: { color: '#A0A0B0' }, top: 0 },
    grid: { top: 30, right: 10, bottom: 20, left: 40 },
    xAxis: { type: 'category' as const, data: d.drift.map((m: InterestDrift) => m.month) },
    yAxis: { type: 'value' as const, max: 100, axisLabel: { formatter: '{value}%' } },
    series: driftCategories.map((cat, i) => ({
      name: cat,
      type: 'line' as const,
      data: d.drift.map((m: InterestDrift) => m.categories[cat] ?? 0),
      smooth: true,
    })),
  };

  const barOption = {
    tooltip: { trigger: 'axis' as const },
    grid: { top: 10, right: 10, bottom: 20, left: 40 },
    xAxis: { type: 'category' as const, data: d.durationBuckets.map((b: DurationBucket) => b.label) },
    yAxis: { type: 'value' as const },
    series: [{
      type: 'bar' as const,
      data: d.durationBuckets.map((b: DurationBucket, i: number) => ({ value: b.count, itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length], borderRadius: [4, 4, 0, 0] } })),
    }],
  };

  const wordcloudOption = {
    tooltip: { show: true },
    series: [{
      type: 'wordCloud' as any,
      shape: 'circle',
      sizeRange: [12, 40],
      rotationRange: [-45, 45],
      textStyle: { fontFamily: '"Noto Sans SC", sans-serif', color: () => CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)] },
      data: d.topTags.slice(0, 50).map((t: { name: string; count: number }) => ({ name: t.name, value: t.count })),
    }],
  };

  return (
    <ErrorBoundary>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 4px 12px' }}>分区分布</h3>
          <ChartContainer option={pieOption} height={280} />
        </div>
        <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 4px 12px' }}>兴趣漂移（近3月）</h3>
          <ChartContainer option={driftOption} height={250} />
        </div>
        <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 4px 12px' }}>视频时长偏好</h3>
          <ChartContainer option={barOption} height={200} />
        </div>
        <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 4px 12px' }}>标签兴趣图谱</h3>
          <ChartContainer option={wordcloudOption} height={280} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
