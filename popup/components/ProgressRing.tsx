import { useRef, useEffect } from 'preact/hooks';
import echarts from '../../src/shared/echarts/register';
import '../../src/shared/echarts/theme';
import { todayPercent } from '../signals';
import { BILI_PINK, BILI_BLUE } from '../../src/shared/constants';

export function ProgressRing() {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const instance = echarts.init(chartRef.current, 'bili-dark');
    instanceRef.current = instance;

    const percent = todayPercent.value;

    instance.setOption({
      series: [{
        type: 'gauge',
        startAngle: 210,
        endAngle: -30,
        center: ['50%', '55%'],
        radius: '90%',
        min: 0,
        max: 100,
        splitNumber: 10,
        axisLine: {
          show: true,
          lineStyle: {
            width: 12,
            color: [
              [0.3, '#333355'],
              [0.7, BILI_BLUE],
              [1, BILI_PINK],
            ],
          },
        },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true,
          formatter: '{value}%',
          color: '#FFFFFF',
          fontSize: 28,
          offsetCenter: [0, '20%'],
        },
        data: [{ value: percent, name: '今日目标' }],
      }],
    });

    return () => {
      instance.dispose();
    };
  }, []);

  // Update on signal change
  useEffect(() => {
    const percent = todayPercent.value;
    if (instanceRef.current) {
      instanceRef.current.setOption({ series: [{ data: [{ value: percent }] }] });
    }
  });

  return <div ref={chartRef} style={{ width: '100%', height: '180px' }} />;
}
