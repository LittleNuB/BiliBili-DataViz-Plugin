export function waitForElement<T extends Element = Element>(
  selector: string,
  timeout = 30_000,
  interval = 500,
): Promise<T> {
  const existing = document.querySelector<T>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        clearInterval(timer);
        resolve(el);
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }
    }, interval);
  });
}

export function waitForElementRemoved(
  selector: string,
  timeout = 10_000,
  interval = 500,
): Promise<void> {
  const existing = document.querySelector(selector);
  if (!existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (!el) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error(`Timeout waiting for element removal: ${selector}`));
      }
    }, interval);
  });
}

interface BiliInitialState {
  aid?: number;
  bvid?: string;
  cid?: number;
  videoData?: {
    aid?: number;
    bvid?: string;
    cid?: number;
    title?: string;
    duration?: number;
    owner?: { mid?: number; name?: string; face?: string };
    pages?: Array<{ cid: number; part?: string; duration?: number }>;
  };
  upData?: { mid?: number; name?: string; face?: string };
  tagInfo?: { tag_name?: string };
  tags?: Array<{ tag_name: string }>;
}

export function getInitialState(): BiliInitialState | null {
  try {
    const win = window as any;
    return win.__INITIAL_STATE__ ?? null;
  } catch {
    return null;
  }
}

export function getVideoContext() {
  const state = getInitialState();
  const bvid = state?.bvid ?? state?.videoData?.bvid ?? '';
  const cid = state?.cid ?? state?.videoData?.cid ?? 0;
  const title = state?.videoData?.title ?? document.title.replace('_哔哩哔哩_bilibili', '').trim();
  const duration = state?.videoData?.duration ?? 0;
  const authorMid = state?.videoData?.owner?.mid ?? state?.upData?.mid ?? 0;
  const authorName = state?.videoData?.owner?.name ?? state?.upData?.name ?? '';

  return { bvid, cid, title, duration, authorMid, authorName };
}

export function injectStylesheet(css: string, id: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
