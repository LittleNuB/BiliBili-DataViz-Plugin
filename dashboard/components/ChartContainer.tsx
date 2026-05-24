import { useRef, useEffect } from 'preact/hooks';
import type { EChartsOption } from 'echarts';

type ChartOption = EChartsOption | Record<string, unknown>;

interface ChartInstance {
  setOption(option: ChartOption, notMerge?: boolean): void;
  resize(): void;
  dispose(): void;
}

interface Props {
  option: ChartOption;
  height?: number;
  loading?: boolean;
}

export function ChartContainer({ option, height = 300, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ChartInstance | null>(null);
  const optionRef = useRef<ChartOption>(option);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    async function mountChart() {
      const [{ default: echarts }] = await Promise.all([
        import('../../src/shared/echarts/register'),
        import('../../src/shared/echarts/theme'),
      ]);
      if (usesWordCloud(optionRef.current)) {
        await import('../../src/shared/echarts/wordcloud');
      }
      if (disposed || !containerRef.current) return;

      const instance = echarts.init(containerRef.current, 'bili-dark');
      instanceRef.current = instance;
      instance.setOption(optionRef.current);

      observer = new ResizeObserver(() => instance.resize());
      observer.observe(containerRef.current);
    }

    void mountChart();

    return () => {
      disposed = true;
      observer?.disconnect();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    optionRef.current = option;
    if (instanceRef.current && !loading) {
      if (usesWordCloud(option)) {
        void import('../../src/shared/echarts/wordcloud').then(() => {
          instanceRef.current?.setOption(option, true);
        });
      } else {
        instanceRef.current.setOption(option, true);
      }
    }
  }, [option, loading]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: `${height}px`,
        background: loading ? '#1A1A2E' : 'transparent',
      }}
    />
  );
}

function usesWordCloud(option: ChartOption): boolean {
  const series = (option as { series?: unknown }).series;
  const list = Array.isArray(series) ? series : series ? [series] : [];
  return list.some(item => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'wordCloud');
}
