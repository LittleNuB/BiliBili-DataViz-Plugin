import { useEffect } from 'preact/hooks';
import { creatorData, creatorLoading, creatorError } from '../../signals';
import { requestSW } from '../../utils/messaging';
import type { CreatorRanking } from '../../../src/shared/types/analytics';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { formatTimeHHMM } from '../../../src/shared/utils/format';
import { BILI_PINK } from '../../../src/shared/constants';

export function CreatorPage() {
  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    creatorLoading.value = true;
    creatorError.value = null;
    try {
      creatorData.value = await requestSW<typeof creatorData.value>('GET_CREATOR_DATA');
    } catch (e) {
      creatorError.value = (e as Error).message;
    } finally {
      creatorLoading.value = false;
    }
  }

  if (creatorLoading.value) return <div style={{ padding: '16px' }}><LoadingSkeleton height={400} /></div>;
  if (creatorError.value) return <div style={{ padding: '16px', color: '#FF6B6B' }}>{creatorError.value}</div>;
  const d = creatorData.value;
  if (!d) return <EmptyState />;

  return (
    <ErrorBoundary>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
          <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 8px 12px' }}>TOP 10 UP主</h3>
          {d.topCreators.map((c: CreatorRanking, i: number) => (
            <div key={c.mid} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 12px', borderRadius: '8px',
              background: i % 2 === 0 ? '#1A1A2E' : 'transparent',
            }}>
              <span style={{ color: '#9090A0', fontSize: '12px', minWidth: '20px' }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#FFFFFF', fontSize: '14px', fontWeight: 500 }}>{c.name}</div>
                <div style={{ color: '#9090A0', fontSize: '11px' }}>
                  {c.videoCount}个视频 · {formatTimeHHMM(c.totalWatchTime)} · 完播{Math.round(c.avgCompletion * 100)}%
                </div>
              </div>
              {c.isDeepBond && <span style={{ background: BILI_PINK, color: '#FFF', fontSize: '10px', padding: '2px 8px', borderRadius: '10px' }}>深度绑定</span>}
            </div>
          ))}
          {d.topCreators.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>暂无数据</div>}
        </div>

        {d.deepBondCreators.length > 0 && (
          <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
            <h3 style={{ color: BILI_PINK, fontSize: '13px', margin: '0 0 8px 12px' }}>深度绑定 UP主</h3>
            {d.deepBondCreators.map((c: CreatorRanking) => (
              <div key={c.mid} style={{ padding: '8px 12px', color: '#FFFFFF', fontSize: '13px' }}>
                {c.name} — {c.videoCount}个视频，完播{Math.round(c.avgCompletion * 100)}%
              </div>
            ))}
          </div>
        )}

        {d.newCreators.length > 0 && (
          <div style={{ background: '#222244', borderRadius: '10px', padding: '12px' }}>
            <h3 style={{ color: '#A0A0B0', fontSize: '13px', margin: '0 0 8px 12px' }}>本月新发现的 UP主</h3>
            {d.newCreators.map((c) => (
              <div key={c.mid} style={{ padding: '6px 12px', display: 'flex', justifyContent: 'space-between', color: '#CCCCCC', fontSize: '13px' }}>
                <span>{c.name}</span>
                <span style={{ color: c.retained ? '#00D4AA' : '#9090A0', fontSize: '11px' }}>{c.retained ? '已留存' : '仅一次'}</span>
              </div>
            ))}
          </div>
        )}

        {d.overDependency && (
          <div style={{ background: '#332222', borderRadius: '10px', padding: '14px', borderLeft: '3px solid #FF6B6B' }}>
            <div style={{ color: '#FF6B6B', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
              过度依赖提醒
            </div>
            <div style={{ color: '#CCCCCC', fontSize: '13px' }}>
              你已经把 {d.overDependency.percentage}% 的B站时间给了 "{d.overDependency.creator.name}"，
              试试探索其他同类型UP主？
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
