import { useEffect, useState } from 'preact/hooks';
import { overviewData, overviewLoading, overviewError } from '../../signals';
import { requestSW } from '../../utils/messaging';
import type { DashboardOverview } from '../../../src/shared/types/analytics';
import { ChartContainer } from '../../components/ChartContainer';
import { StatCard } from '../../components/StatCard';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { formatTimeHHMM, formatPercent } from '../../../src/shared/utils/format';
import { HOUR_LABELS, WEEKDAY_LABELS, BILI_PINK, CHART_COLORS } from '../../../src/shared/constants';

interface DeviceData {
  breakdown: { label: string; deviceType: number; watchTime: number; videoCount: number; avgCompletion: number; percentage: number }[];
  hourly: { mobile: number[]; pc: number[] };
  deviceCompletion: { mobile: number; pc: number };
}

export function OverviewPage() {
  const [device, setDevice] = useState<DeviceData | null>(null);

  useEffect(() => {
    fetchData();
    requestSW<DeviceData>('GET_DEVICE_DATA').then(setDevice).catch(() => {});
  }, []);

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

  const maxHeat = Math.max(...d.hourlyHeatmap.flat(), 1);
  const heatmapOption = {
    tooltip: { position: 'top' },
    grid: { top: 30, right: 20, bottom: 20, left: 50 },
    xAxis: { type: 'category', data: HOUR_LABELS, splitArea: { show: true } },
    yAxis: { type: 'category', data: WEEKDAY_LABELS, splitArea: { show: true } },
    visualMap: { min: 0, max: maxHeat, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#1A1A2E', '#00A1D6', '#FB7299'] } },
    series: [{
      type: 'heatmap',
      data: d.hourlyHeatmap.flatMap((row, hour) => row.map((val, day) => [hour, day, val])),
      label: { show: false },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
    }],
  };

  const devicePieOption = device && device.breakdown.length > 0 ? {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {d}%' },
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      center: ['50%', '50%'],
      data: device.breakdown.map((b, i) => ({
        name: b.label,
        value: Math.round(b.watchTime / 60),
      })),
      label: { color: '#A0A0B0', formatter: '{b}\n{d}%' },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
    }],
  } : null;

  const hourlyMax = device ? Math.max(...device.hourly.mobile, ...device.hourly.pc, 1) : 1;
  const deviceHourlyOption = device ? {
    tooltip: { trigger: 'axis' as const },
    legend: { textStyle: { color: '#A0A0B0' }, top: 0, data: ['手机/平板', 'PC'] },
    grid: { top: 30, right: 10, bottom: 20, left: 40 },
    xAxis: { type: 'category' as const, data: HOUR_LABELS },
    yAxis: { type: 'value' as const, show: false, max: Math.ceil(hourlyMax / 60) },
    series: [
      {
        name: '手机/平板',
        type: 'line' as const,
        data: device.hourly.mobile.map(v => Math.round(v / 60)),
        smooth: true,
        areaStyle: { opacity: 0.3 },
        lineStyle: { color: '#FB7299' },
        itemStyle: { color: '#FB7299' },
      },
      {
        name: 'PC',
        type: 'line' as const,
        data: device.hourly.pc.map(v => Math.round(v / 60)),
        smooth: true,
        areaStyle: { opacity: 0.3 },
        lineStyle: { color: '#00A1D6' },
        itemStyle: { color: '#00A1D6' },
      },
    ],
  } : null;

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

        {device && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {device.breakdown.map(b => (
                <StatCard
                  key={b.deviceType}
                  label={`${b.label}端`}
                  value={formatTimeHHMM(b.watchTime)}
                  accent={b.deviceType <= 2 ? BILI_PINK : '#00A1D6'}
                />
              ))}
              {device.breakdown.length === 0 && <StatCard label="全设备" value="-" />}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <StatCard
                label="手机端完播率"
                value={formatPercent(device.deviceCompletion.mobile)}
                accent={BILI_PINK}
              />
              <StatCard
                label="PC端完播率"
                value={formatPercent(device.deviceCompletion.pc)}
                accent="#00A1D6"
              />
            </div>
            {devicePieOption && (
              <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
                <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 4px 12px' }}>设备分布</h3>
                <ChartContainer option={devicePieOption} height={220} />
              </div>
            )}
            {deviceHourlyOption && (
              <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
                <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 4px 12px' }}>
                  设备 × 时段（近30天，单位：分钟）
                </h3>
                <ChartContainer option={deviceHourlyOption} height={240} />
              </div>
            )}
          </>
        )}

        <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 8px 12px' }}>活跃时段热力图</h3>
          <ChartContainer option={heatmapOption} height={280} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
