import { useEffect, useState } from 'preact/hooks';
import { activeTab } from './signals';
import { requestSW } from './utils/messaging';
import { TabBar } from './components/TabBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverviewPage } from './modules/overview/OverviewPage';
import { PreferencePage } from './modules/preference/PreferencePage';
import { CreatorPage } from './modules/creator/CreatorPage';
import { BehaviorPage } from './modules/behavior/BehaviorPage';
import { ExperimentsPage } from './modules/experiments/ExperimentsPage';
import type { WatchHistoryRecord } from '../src/shared/types/watch-event';

const PAGES = [OverviewPage, PreferencePage, CreatorPage, BehaviorPage, ExperimentsPage];

export function App() {
  const ActivePage = PAGES[activeTab.value];
  const [synced, setSynced] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    requestSW<{ lastSyncTime: number; totalRecords: number }>('GET_SYNC_STATUS').then(s => {
      if (s.lastSyncTime > 0) {
        const d = new Date(s.lastSyncTime);
        setSynced(`已同步 ${s.totalRecords} 条记录 · 最后更新: ${d.toLocaleString('zh-CN')}`);
      } else {
        setSynced('等待首次同步...');
      }
    }).catch(() => {});
  }, []);

  async function handleExport(format: 'json' | 'csv') {
    setExporting(true);
    try {
      const { records } = await requestSW<{ records: WatchHistoryRecord[]; format: string }>('EXPORT_DATA', { format });
      let content: string;
      let mime: string;
      let ext: string;

      if (format === 'csv') {
        const header = 'bvid,title,authorName,tagName,viewAt,progress,duration,completion';
        const rows = records.map((r: WatchHistoryRecord) =>
          [r.bvid, r.title, r.authorName, r.tagName, r.viewAt, r.progress, r.duration, Math.round(r.actualCompletion * 100)]
            .map(csvEscape)
            .join(',')
        );
        content = '\uFEFF' + header + '\n' + rows.join('\n');
        mime = 'text/csv;charset=utf-8';
        ext = 'csv';
      } else {
        content = JSON.stringify(records, null, 2);
        mime = 'application/json';
        ext = 'json';
      }

      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bilibili-history-export.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 16px 8px', gap: '10px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#FB7299', margin: 0 }}>
          B站消费数据中心
        </h1>
      </div>
      {synced && <div style={{ textAlign: 'center', fontSize: '11px', color: '#666', marginBottom: '4px' }}>{synced}</div>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '0 16px 8px' }}>
        <button
          onClick={() => handleExport('json')}
          disabled={exporting}
          style={{
            padding: '4px 12px',
            background: 'transparent',
            color: '#A0A0B0',
            border: '1px solid #333355',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          {exporting ? '导出中...' : '导出 JSON'}
        </button>
        <button
          onClick={() => handleExport('csv')}
          disabled={exporting}
          style={{
            padding: '4px 12px',
            background: 'transparent',
            color: '#A0A0B0',
            border: '1px solid #333355',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          导出 CSV
        </button>
      </div>
      <TabBar activeTab={activeTab.value} onChange={(i) => { activeTab.value = i; }} />
      <ErrorBoundary>
        <ActivePage />
      </ErrorBoundary>
    </div>
  );
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
