import { activeTab } from './signals';
import { TabBar } from './components/TabBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverviewPage } from './modules/overview/OverviewPage';
import { PreferencePage } from './modules/preference/PreferencePage';
import { CreatorPage } from './modules/creator/CreatorPage';
import { BehaviorPage } from './modules/behavior/BehaviorPage';
import { ExperimentsPage } from './modules/experiments/ExperimentsPage';

const PAGES = [OverviewPage, PreferencePage, CreatorPage, BehaviorPage, ExperimentsPage];

export function App() {
  const ActivePage = PAGES[activeTab.value];

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', minHeight: '100vh' }}>
      <h1 style={{
        fontSize: '18px',
        fontWeight: 700,
        color: '#FB7299',
        textAlign: 'center',
        padding: '16px 0 8px',
        margin: 0,
      }}>
        B站消费数据中心
      </h1>
      <TabBar activeTab={activeTab.value} onChange={(i) => { activeTab.value = i; }} />
      <ErrorBoundary>
        <ActivePage />
      </ErrorBoundary>
    </div>
  );
}
