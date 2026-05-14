export type PageType = 'homepage' | 'video' | 'space' | 'search' | 'other';

export function detectPage(): PageType {
  const path = location.pathname;
  if (path === '/' || path === '/index.html') return 'homepage';
  if (path.startsWith('/video/')) return 'video';
  if (path.startsWith('/space/')) return 'space';
  if (path.startsWith('/search')) return 'search';
  return 'other';
}

export function isVideoPage(): boolean {
  return detectPage() === 'video';
}

export function isHomePage(): boolean {
  return detectPage() === 'homepage';
}

export function extractBvid(): string | null {
  const match = location.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/);
  return match ? match[1] : null;
}
