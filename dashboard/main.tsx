import { render } from 'preact';
import { App } from './App';

const style = document.createElement('style');
style.textContent = `
  @keyframes bdc-skeleton {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #1A1A2E; }
  ::-webkit-scrollbar-thumb { background: #333355; border-radius: 3px; }
`;
document.head.appendChild(style);

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}

console.log('[Bili-Bill] 面板已加载');
