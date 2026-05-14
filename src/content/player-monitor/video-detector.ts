export async function detectVideo(): Promise<HTMLVideoElement> {
  // Priority: existing <video> element
  let video = document.querySelector<HTMLVideoElement>('video');
  if (video && video.duration > 0) {
    console.log('[BiliViz] Found existing video element');
    return video;
  }

  // Strategy 2: MutationObserver for async-loaded player
  const waitForObserver = new Promise<HTMLVideoElement>((resolve) => {
    const observer = new MutationObserver(() => {
      const v = document.querySelector<HTMLVideoElement>('video');
      if (v && v.duration > 0) {
        observer.disconnect();
        console.log('[BiliViz] Video detected via MutationObserver');
        resolve(v);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety timeout
    setTimeout(() => {
      observer.disconnect();
    }, 25_000);
  });

  // Strategy 3: Polling fallback
  const waitForPolling = new Promise<HTMLVideoElement>((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const v = document.querySelector<HTMLVideoElement>('video');
      if (v && v.duration > 0) {
        clearInterval(timer);
        console.log('[BiliViz] Video detected via polling');
        resolve(v);
      } else if (Date.now() - start > 30_000) {
        clearInterval(timer);
        reject(new Error('Timeout detecting video element after 30s'));
      }
    }, 500);
  });

  return Promise.race([waitForObserver, waitForPolling]);
}
