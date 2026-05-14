import { quickStats, completionPercent } from '../signals';
import { secondsToHours } from '../../src/shared/utils/time';

const tileStyle: Record<string, string> = {
  background: '#222244',
  borderRadius: '10px',
  padding: '10px 8px',
  textAlign: 'center',
};

const valueStyle: Record<string, string> = {
  fontSize: '22px',
  fontWeight: '700',
  color: '#FFFFFF',
  lineHeight: '1.2',
};

const labelStyle: Record<string, string> = {
  fontSize: '11px',
  color: '#9090A0',
  marginTop: '3px',
};

export function QuickStats() {
  const stats = quickStats.value;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 12px' }}>
      <div style={{ ...tileStyle, flex: '1 1 calc(50% - 4px)' }}>
        <div style={valueStyle}>{stats ? `${stats.streakDays}天` : '-'}</div>
        <div style={labelStyle}>连续观看</div>
      </div>
      <div style={{ ...tileStyle, flex: '1 1 calc(50% - 4px)' }}>
        <div style={valueStyle}>{stats ? `${secondsToHours(stats.weeklyWatchTime)}h` : '-'}</div>
        <div style={labelStyle}>本周观看</div>
      </div>
      <div style={{ ...tileStyle, flex: '1 1 calc(50% - 4px)' }}>
        <div style={valueStyle}>{stats ? stats.efficiencyScore : '-'}</div>
        <div style={labelStyle}>效率评分</div>
      </div>
      <div style={{ ...tileStyle, flex: '1 1 calc(50% - 4px)' }}>
        <div style={valueStyle}>{completionPercent.value}%</div>
        <div style={labelStyle}>平均完播率</div>
      </div>
    </div>
  );
}
