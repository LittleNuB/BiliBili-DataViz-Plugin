(() => {
  const REQUEST_TYPE = 'BILI_BILL_PAGE_RUNTIME_REQUEST';
  const RESPONSE_TYPE = 'BILI_BILL_PAGE_RUNTIME_RESPONSE';
  const RESPONSE_SOURCE = 'bili-bill-page-runtime';

  function asRecord(value) {
    return value && typeof value === 'object' ? value : null;
  }

  function pickNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
  }

  function pickString(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text || undefined;
  }

  function pickOwner(value) {
    const owner = asRecord(value);
    if (!owner) return undefined;
    const mid = pickNumber(owner.mid);
    const name = pickString(owner.name);
    return mid || name ? { mid, name } : undefined;
  }

  function pickPart(value, index) {
    const part = asRecord(value);
    if (!part) return null;
    return {
      page: pickNumber(part.page) ?? index + 1,
      cid: pickNumber(part.cid),
      part: pickString(part.part),
      title: pickString(part.title),
      duration: pickNumber(part.duration),
    };
  }

  function pickParts(value) {
    if (!Array.isArray(value)) return undefined;
    return value.map(pickPart).filter(Boolean);
  }

  function pickChapters(value) {
    if (!Array.isArray(value)) return undefined;
    return value.map((item) => {
      const chapter = asRecord(item);
      if (!chapter) return null;
      return {
        title: pickString(chapter.title),
        start: pickNumber(chapter.start),
        startSeconds: pickNumber(chapter.startSeconds),
        start_time: pickNumber(chapter.start_time),
      };
    }).filter(Boolean);
  }

  function pickVideoData(value) {
    const data = asRecord(value);
    if (!data) return null;
    const videoData = asRecord(data.videoData);
    const source = videoData ?? data;
    const picked = {
      aid: pickNumber(source.aid),
      avid: pickNumber(source.avid),
      bvid: pickString(source.bvid),
      cid: pickNumber(source.cid),
      p: pickNumber(source.p),
      page: pickNumber(source.page),
      title: pickString(source.title),
      duration: pickNumber(source.duration),
      desc: pickString(source.desc),
      description: pickString(source.description),
      owner: pickOwner(source.owner),
      currentPart: pickPart(source.currentPart, 0),
      pages: pickParts(source.pages),
      chapters: pickChapters(source.chapters),
    };

    return Object.fromEntries(
      Object.entries(picked).filter(([, field]) => {
        if (Array.isArray(field)) return field.length > 0;
        return field !== undefined && field !== null;
      }),
    );
  }

  function pickInitialState() {
    const state = asRecord(window.__INITIAL_STATE__);
    if (!state) return null;
    const videoData = pickVideoData(state.videoData ?? state);
    const upData = asRecord(state.upData);
    return {
      aid: pickNumber(state.aid),
      avid: pickNumber(state.avid),
      bvid: pickString(state.bvid),
      cid: pickNumber(state.cid),
      p: pickNumber(state.p),
      page: pickNumber(state.page),
      currentPart: pickPart(state.currentPart, 0),
      videoData,
      upData: upData
        ? { mid: pickNumber(upData.mid), name: pickString(upData.name) }
        : undefined,
    };
  }

  async function pickPlayerInfo() {
    const player = asRecord(window.player);
    if (!player || typeof player.getVideoInfo !== 'function') return null;
    try {
      return pickVideoData(await player.getVideoInfo());
    } catch {
      return null;
    }
  }

  window.addEventListener('message', async (event) => {
    const data = asRecord(event.data);
    if (
      event.source !== window
      || data?.source !== 'bili-bill-content-script'
      || data?.type !== REQUEST_TYPE
      || typeof data?.requestId !== 'string'
    ) {
      return;
    }

    window.postMessage({
      source: RESPONSE_SOURCE,
      type: RESPONSE_TYPE,
      requestId: data.requestId,
      payload: {
        initialState: pickInitialState(),
        playerInfo: await pickPlayerInfo(),
      },
    }, '*');
  });
})();
