import { BILI_PINK } from '../../src/shared/constants';

export function OpenDashboard() {
  const openDashboard = (hash = '') => {
    const url = chrome.runtime.getURL(`dashboard/index.html${hash}`);
    chrome.tabs.create({ url });
  };

  return (
    <div style={{ display: 'grid', gap: '8px', padding: '12px' }}>
      <button
        onClick={() => openDashboard()}
        style={{
          display: 'block',
          width: '100%',
          padding: '10px 0',
          background: BILI_PINK,
          color: '#FFFFFF',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        打开总览
      </button>
      <button
        onClick={() => openDashboard('#dynamic-bill')}
        style={{
          display: 'block',
          width: '100%',
          padding: '9px 0',
          background: 'transparent',
          color: '#D8D8E8',
          border: '1px solid #333355',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        动态账单入口
      </button>
    </div>
  );
}
