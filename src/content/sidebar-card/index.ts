import { isHomePage } from '../utils/page-detector';
import { waitForElement } from '../utils/dom-utils';
import { buildSidebarCard } from './renderer';

async function initializeSidebar(): Promise<void> {
  if (!isHomePage()) return;

  try {
    // Fetch quick stats from background
    const response = await chrome.runtime.sendMessage({ action: 'GET_QUICK_STATS' });
    if (!response || !response.success || !response.data) {
      console.warn('[BiliViz] Failed to get quick stats for sidebar');
      return;
    }

    // Wait for B站 sidebar to be ready
    const container = await waitForElement('.right-container, .recommend-container, .home-content', 10_000);

    // Check if card already exists
    if (document.getElementById('bdc-sidebar-card')) return;

    const card = buildSidebarCard(response.data);
    container.insertBefore(card, container.firstChild);
    console.log('[BiliViz] Sidebar card injected');
  } catch (e) {
    console.error('[BiliViz] Failed to inject sidebar card:', e);
  }
}

// Run after page settles
setTimeout(initializeSidebar, 2000);

// Also listen for B站 SPA navigation back to homepage
let lastPath = location.pathname;
const navObserver = new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    if (isHomePage()) {
      setTimeout(initializeSidebar, 2000);
    }
  }
});
navObserver.observe(document.body, { childList: true, subtree: true });

console.log('[BiliViz] Sidebar card loaded');
