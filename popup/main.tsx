import { render } from 'preact';
import { App } from './App';

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}

console.log('[BiliViz] Popup loaded');
