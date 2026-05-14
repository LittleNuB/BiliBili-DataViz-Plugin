import { BILI_PINK } from '../../src/shared/constants';

export function OpenDashboard() {
  const handleClick = () => {
    const url = chrome.runtime.getURL('dashboard/index.html');
    chrome.tabs.create({ url });
  };

  return (
    <div style={{ padding: '12px' }}>
      <button
        onClick={handleClick}
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
        查看完整面板 →
      </button>
    </div>
  );
}
