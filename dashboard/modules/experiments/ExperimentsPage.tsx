import { useEffect } from 'preact/hooks';
import { expData, expLoading, expError } from '../../signals';
import { requestSW } from '../../utils/messaging';
import type { WeeklyTip, BlindBoxItem } from '../../../src/shared/types/analytics';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { BILI_PINK } from '../../../src/shared/constants';

const CATEGORY_COLORS: Record<string, string> = {
  completion: '#FB7299',
  diversity: '#00A1D6',
  creator: '#FFB347',
  habit: '#00D4AA',
};

export function ExperimentsPage() {
  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    expLoading.value = true;
    expError.value = null;
    try {
      expData.value = await requestSW<typeof expData.value>('GET_EXPERIMENT_DATA');
    } catch (e) {
      expError.value = (e as Error).message;
    } finally {
      expLoading.value = false;
    }
  }

  if (expLoading.value) return <div style={{ padding: '16px' }}><LoadingSkeleton height={400} /></div>;
  if (expError.value) return <div style={{ padding: '16px', color: '#FF6B6B' }}>{expError.value}</div>;
  const d = expData.value;
  if (!d) return <EmptyState />;

  return (
    <ErrorBoundary>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 8px 0' }}>每周优化建议</h3>
          {d.tips.map((tip: WeeklyTip, i: number) => (
            <div key={i} style={{
              background: '#222244', borderRadius: '10px', padding: '12px 14px', marginBottom: '8px',
              borderLeft: `3px solid ${CATEGORY_COLORS[tip.category] ?? BILI_PINK}`,
            }}>
              <div style={{ color: '#FFFFFF', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{tip.title}</div>
              <div style={{ color: '#A0A0B0', fontSize: '13px', lineHeight: 1.5 }}>{tip.description}</div>
            </div>
          ))}
          {d.tips.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#666', background: '#222244', borderRadius: '10px' }}>暂无建议，多看一些视频吧</div>}
        </div>

        <div>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 8px 0' }}>兴趣盲盒</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            {d.blindBox.map((item: BlindBoxItem, i: number) => (
              <div key={i} style={{
                background: '#222244', borderRadius: '10px', padding: '12px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '24px', marginBottom: '6px' }}>
                  {item.type === 'video' ? '🎬' : item.type === 'creator' ? '👤' : '📂'}
                </div>
                <div style={{ color: '#FFFFFF', fontSize: '12px', fontWeight: 500, marginBottom: '4px', lineHeight: 1.3 }}>
                  {item.name}
                </div>
                <div style={{ color: '#9090A0', fontSize: '11px', lineHeight: 1.4 }}>
                  {item.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
