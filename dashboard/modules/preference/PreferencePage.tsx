import { useEffect, useState } from 'preact/hooks';
import { prefData, prefLoading, prefError } from '../../signals';
import { requestSW } from '../../utils/messaging';
import type {
  CategoryDistribution,
  DurationBucket,
  InterestDrift,
  InterestDriftGranularity,
} from '../../../src/shared/types/analytics';
import { ChartContainer } from '../../components/ChartContainer';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { CHART_COLORS } from '../../../src/shared/constants';

const GRANULARITY_OPTIONS: Array<{ value: InterestDriftGranularity; label: string }> = [
  { value: 'daily', label: '日' },
  { value: 'weekly', label: '周' },
  { value: 'monthly', label: '月' },
];

const DRIFT_CATEGORY_LIMIT = 5;

export function PreferencePage() {
  const [selectedGranularity, setSelectedGranularity] = useState<InterestDriftGranularity | null>(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    prefLoading.value = true;
    prefError.value = null;
    try {
      prefData.value = await requestSW<typeof prefData.value>('GET_PREFERENCE_DATA');
      setSelectedGranularity(null);
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

  const activeGranularity = selectedGranularity ?? d.defaultDriftGranularity;
  const drift = d.driftByGranularity?.[activeGranularity] ?? d.drift;
  const driftDisplay = buildDriftDisplay(drift, DRIFT_CATEGORY_LIMIT);
  const hasDriftData = drift.some((period: InterestDrift) => period.recordCount > 0 && period.totalWatchTime > 0);
  const driftTitle = getDriftTitle(activeGranularity, d.coverage.coveredDays);
  const driftCaveat = getDriftCaveat(activeGranularity, d.coverage.coveredDays, d.coverage.totalRecords, hasDriftData);

  const pieOption = {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {d}%' },
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      data: d.categories.slice(0, 8).map((c: CategoryDistribution) => ({ name: c.name, value: c.watchTime })),
      label: { color: '#A0A0B0' },
    }],
  };

  const driftOption = {
    tooltip: { trigger: 'axis' as const },
    legend: { type: 'scroll' as const, textStyle: { color: '#A0A0B0' }, top: 0 },
    grid: { top: 46, right: 10, bottom: 34, left: 40 },
    xAxis: {
      type: 'category' as const,
      data: drift.map((m: InterestDrift) => m.label),
      axisLabel: { hideOverlap: true, rotate: activeGranularity === 'daily' ? 35 : 0 },
    },
    yAxis: { type: 'value' as const, max: 100, axisLabel: { formatter: '{value}%' } },
    series: driftDisplay.seriesNames.map((cat, i) => ({
      name: cat,
      type: 'line' as const,
      data: driftDisplay.series[cat] ?? [],
      smooth: true,
      symbolSize: 5,
      lineStyle: { width: 2 },
      itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
    })),
  };

  const barOption = {
    tooltip: { trigger: 'axis' as const },
    grid: { top: 10, right: 10, bottom: 20, left: 40 },
    xAxis: { type: 'category' as const, data: d.durationBuckets.map((b: DurationBucket) => b.label) },
    yAxis: { type: 'value' as const },
    series: [{
      type: 'bar' as const,
      data: d.durationBuckets.map((b: DurationBucket, i: number) => ({
        value: b.count,
        itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length], borderRadius: [4, 4, 0, 0] },
      })),
    }],
  };

  const wordcloudOption = {
    tooltip: { show: true },
    series: [{
      type: 'wordCloud' as any,
      shape: 'circle',
      sizeRange: [12, 40],
      rotationRange: [-45, 45],
      textStyle: {
        fontFamily: '"Noto Sans SC", sans-serif',
        color: () => CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)],
      },
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
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', margin: '0 0 8px 12px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ color: '#EAEAF2', fontSize: '14px', margin: '0 0 4px 0' }}>{driftTitle}</h3>
              <div style={{ color: '#A0A0B0', fontSize: '12px', lineHeight: 1.6 }}>
                覆盖 {formatCoverageDate(d.coverage.earliestDate)} 至 {formatCoverageDate(d.coverage.latestDate)}
                {' · '}活跃 {d.coverage.activeDays} 天
                {' · '}样本 {d.coverage.totalRecords} 条
              </div>
            </div>
            <div style={{ display: 'inline-flex', border: '1px solid rgba(160, 160, 176, 0.28)', borderRadius: '8px', overflow: 'hidden' }} aria-label="兴趣粒度选择">
              {GRANULARITY_OPTIONS.map(option => {
                const selected = option.value === activeGranularity;
                return (
                  <button
                    type="button"
                    onClick={() => setSelectedGranularity(option.value)}
                    title={getGranularityHint(option.value, d.coverage.coveredDays, option.value === d.defaultDriftGranularity)}
                    style={{
                      minWidth: '42px',
                      height: '30px',
                      border: 0,
                      borderRight: option.value === 'monthly' ? 0 : '1px solid rgba(160, 160, 176, 0.2)',
                      background: selected ? '#6C5CE7' : 'transparent',
                      color: selected ? '#FFFFFF' : '#C8C8D8',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          {driftCaveat && (
            <div style={{ margin: '0 12px 8px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(255, 210, 102, 0.1)', color: '#FFD166', fontSize: '12px', lineHeight: 1.5 }}>
              {driftCaveat}
            </div>
          )}
          {hasDriftData ? (
            <ChartContainer option={driftOption} height={270} />
          ) : (
            <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A0A0B0', fontSize: '13px', textAlign: 'center', padding: '0 16px' }}>
              暂无足够观看时长用于生成兴趣分布；同步更多历史后会显示日/周/月视图。
            </div>
          )}
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

function buildDriftDisplay(drift: InterestDrift[], limit: number): {
  seriesNames: string[];
  series: Record<string, number[]>;
} {
  const totals = new Map<string, number>();
  for (const period of drift) {
    for (const [category, value] of Object.entries(period.categories)) {
      totals.set(category, (totals.get(category) ?? 0) + value);
    }
  }

  const topCategories = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category]) => category);
  const hiddenCategories = Array.from(totals.keys()).filter(category => !topCategories.includes(category));
  const seriesNames = hiddenCategories.length > 0 ? [...topCategories, '其他'] : topCategories;
  const series: Record<string, number[]> = {};

  for (const category of topCategories) {
    series[category] = drift.map(period => period.categories[category] ?? 0);
  }
  if (hiddenCategories.length > 0) {
    series['其他'] = drift.map(period => roundOne(
      hiddenCategories.reduce((sum, category) => sum + (period.categories[category] ?? 0), 0),
    ));
  }

  return { seriesNames, series };
}

function getDriftTitle(granularity: InterestDriftGranularity, coveredDays: number): string {
  if (granularity === 'monthly' && coveredDays >= 90) return '长期兴趣漂移';
  if (granularity === 'weekly') return '近期兴趣趋势';
  return '近期兴趣分布';
}

function getDriftCaveat(
  granularity: InterestDriftGranularity,
  coveredDays: number,
  totalRecords: number,
  hasData: boolean,
): string {
  if (totalRecords === 0) return '本地还没有观看历史记录，无法计算兴趣分布。';
  if (!hasData) return '已同步记录缺少有效观看时长，图表暂不计算百分比。';
  if (totalRecords < 10) return '样本量较少，百分比容易被单个视频放大，请把它作为近期分布参考。';
  if (granularity === 'monthly' && coveredDays < 90) return '历史覆盖不足 90 天，月粒度只适合粗略查看，不代表长期兴趣漂移。';
  if (granularity === 'weekly' && coveredDays < 14) return '历史覆盖不足 14 天，周粒度样本不足；默认日粒度更可信。';
  if (granularity === 'daily' && coveredDays >= 14) return '日粒度适合排查短期波动，覆盖较长时会比周/月视图更碎。';
  return '';
}

function getGranularityHint(
  granularity: InterestDriftGranularity,
  coveredDays: number,
  isDefault: boolean,
): string {
  const prefix = isDefault ? '当前默认：' : '';
  if (granularity === 'daily') return `${prefix}少于 14 天历史时最可信`;
  if (granularity === 'weekly') return `${prefix}14 至 90 天历史时最可信`;
  return `${prefix}90 天以上历史时最适合观察长期漂移`;
}

function formatCoverageDate(value: string | null): string {
  return value ?? '暂无';
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
