import type {
  CurrentVideoChapter,
  CurrentVideoContext,
  CurrentVideoNoContext,
  CurrentVideoPart,
} from '../../shared/types/current-video-context';

const DESCRIPTION_LIMIT = 2000;

interface BiliInitialState {
  bvid?: string;
  cid?: number;
  videoData?: {
    bvid?: string;
    cid?: number;
    title?: string;
    duration?: number;
    desc?: string;
    description?: string;
    owner?: { mid?: number; name?: string };
    pages?: Array<{ page?: number; cid?: number; part?: string; title?: string; duration?: number }>;
    chapters?: Array<{ title?: string; start?: number; startSeconds?: number; start_time?: number }>;
    ugc_season?: {
      sections?: Array<{
        episodes?: Array<{ title?: string; bvid?: string; cid?: number; page?: number; duration?: number }>;
      }>;
    };
  };
  upData?: { mid?: number; name?: string };
}

export function isVideoPage(): boolean {
  return location.pathname.startsWith('/video/');
}

export function collectCurrentVideoContext(): CurrentVideoContext | CurrentVideoNoContext {
  if (!isVideoPage()) {
    return buildNoContext('non_video_page', 'non_video');
  }

  const state = getInitialState();
  const urlBvid = extractBvidFromUrl();
  const stateBvid = normalizeString(state?.bvid ?? state?.videoData?.bvid);
  const bvid = urlBvid || stateBvid;

  if (!bvid) {
    return buildNoContext('video_context_unavailable', 'video');
  }

  const pageNumber = extractPageFromUrl();
  const canTrustState = !urlBvid || !stateBvid || stateBvid === urlBvid;
  const parts = canTrustState ? collectParts(state) : [];
  const currentPart = parts.find(part => part.page === pageNumber) ?? parts[0] ?? null;
  const cid = canTrustState
    ? currentPart?.cid ?? normalizeNumber(state?.cid ?? state?.videoData?.cid)
    : null;
  const title = canTrustState
    ? normalizeString(state?.videoData?.title) ?? collectTitleFromDocument()
    : collectTitleFromDocument();
  const authorName = canTrustState
    ? normalizeString(state?.videoData?.owner?.name ?? state?.upData?.name)
    : null;
  const authorMid = canTrustState
    ? normalizeNumber(state?.videoData?.owner?.mid ?? state?.upData?.mid)
    : null;
  const durationSeconds = canTrustState
    ? currentPart?.durationSeconds ?? normalizeNumber(state?.videoData?.duration)
    : null;
  const descriptionText = canTrustState ? collectDescription(state) : null;
  const chapters = canTrustState ? collectChapters(state) : [];
  const descriptionAvailability = descriptionText ? 'available' : 'unavailable';
  const pagesAvailability = parts.length > 0 ? 'available' : 'unavailable';
  const chaptersAvailability = chapters.length > 0 ? 'available' : 'unknown';
  const warnings: string[] = [];

  if (!cid) warnings.push('cid_unknown');
  if (!title) warnings.push('title_unknown');
  if (!authorName && !authorMid) warnings.push('author_unknown');
  if (!durationSeconds) warnings.push('duration_unknown');
  if (!descriptionText) warnings.push('description_unavailable');
  warnings.push('transcript_unavailable');

  return {
    kind: 'video',
    url: location.href,
    collectedAt: Date.now(),
    bvid,
    cid,
    title,
    authorName,
    authorMid,
    durationSeconds,
    currentPart: {
      page: pageNumber,
      title: currentPart?.title ?? null,
      total: parts.length > 0 ? parts.length : null,
    },
    parts,
    chapters,
    description: {
      availability: descriptionAvailability,
      text: descriptionText,
      length: descriptionText?.length ?? null,
    },
    sources: {
      metadata: 'available',
      description: descriptionAvailability,
      pages: pagesAvailability,
      chapters: chaptersAvailability,
      transcript: 'unavailable',
      contentText: 'unavailable',
    },
    warnings,
  };
}

export function withVideoElementDuration(
  context: CurrentVideoContext,
  video: HTMLVideoElement,
): CurrentVideoContext {
  if (context.durationSeconds || !Number.isFinite(video.duration) || video.duration <= 0) {
    return context;
  }

  return {
    ...context,
    collectedAt: Date.now(),
    durationSeconds: Math.round(video.duration),
    warnings: context.warnings.filter(warning => warning !== 'duration_unknown'),
  };
}

function buildNoContext(
  reason: CurrentVideoNoContext['reason'],
  pageType: CurrentVideoNoContext['pageType'],
): CurrentVideoNoContext {
  return {
    kind: 'no_context',
    url: location.href,
    collectedAt: Date.now(),
    reason,
    pageType,
  };
}

function getInitialState(): BiliInitialState | null {
  try {
    return (window as any).__INITIAL_STATE__ ?? null;
  } catch {
    return null;
  }
}

function extractBvidFromUrl(): string {
  const match = location.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/);
  return match?.[1] ?? '';
}

function extractPageFromUrl(): number {
  const page = Number(new URLSearchParams(location.search).get('p') ?? '1');
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function collectParts(state: BiliInitialState | null): CurrentVideoPart[] {
  const pages = state?.videoData?.pages;
  if (Array.isArray(pages) && pages.length > 0) {
    return pages.map((page, index) => ({
      page: normalizeNumber(page.page) ?? index + 1,
      cid: normalizeNumber(page.cid),
      title: normalizeString(page.part ?? page.title),
      durationSeconds: normalizeNumber(page.duration),
    }));
  }

  const episodes = state?.videoData?.ugc_season?.sections?.flatMap(section => section.episodes ?? []) ?? [];
  return episodes.map((episode, index) => ({
    page: normalizeNumber(episode.page) ?? index + 1,
    cid: normalizeNumber(episode.cid),
    title: normalizeString(episode.title),
    durationSeconds: normalizeNumber(episode.duration),
  }));
}

function collectChapters(state: BiliInitialState | null): CurrentVideoChapter[] {
  const chapters = state?.videoData?.chapters;
  if (!Array.isArray(chapters)) return [];

  return chapters
    .map(chapter => ({
      title: normalizeString(chapter.title) ?? '',
      startSeconds: normalizeNumber(chapter.startSeconds ?? chapter.start ?? chapter.start_time),
    }))
    .filter(chapter => chapter.title);
}

function collectDescription(state: BiliInitialState | null): string | null {
  const fromState = normalizeString(state?.videoData?.desc ?? state?.videoData?.description);
  const fromMeta = normalizeString(
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
  );
  const fromDom = normalizeString(
    document.querySelector<HTMLElement>('.desc-info-text, .video-desc-container, #v_desc .desc-info')?.textContent,
  );
  const text = fromState ?? fromDom ?? fromMeta;
  return text ? text.slice(0, DESCRIPTION_LIMIT) : null;
}

function collectTitleFromDocument(): string | null {
  const rawTitle = normalizeString(document.title);
  if (!rawTitle) return null;
  return rawTitle
    .replace(/_bilibili$/iu, '')
    .trim() || rawTitle;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function normalizeNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}
