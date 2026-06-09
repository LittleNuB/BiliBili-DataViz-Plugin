export type CurrentVideoAvailability = 'available' | 'unavailable' | 'unknown';

export interface CurrentVideoPart {
  page: number;
  cid: number | null;
  title: string | null;
  durationSeconds: number | null;
}

export interface CurrentVideoChapter {
  title: string;
  startSeconds: number | null;
}

export interface CurrentVideoSourceAvailability {
  metadata: CurrentVideoAvailability;
  description: CurrentVideoAvailability;
  pages: CurrentVideoAvailability;
  chapters: CurrentVideoAvailability;
  transcript: CurrentVideoAvailability;
  contentText: CurrentVideoAvailability;
}

export interface CurrentVideoContext {
  kind: 'video';
  url: string;
  collectedAt: number;
  bvid: string;
  cid: number | null;
  title: string | null;
  authorName: string | null;
  authorMid: number | null;
  durationSeconds: number | null;
  currentPart: {
    page: number;
    title: string | null;
    total: number | null;
  };
  parts: CurrentVideoPart[];
  chapters: CurrentVideoChapter[];
  description: {
    availability: CurrentVideoAvailability;
    text: string | null;
    length: number | null;
  };
  sources: CurrentVideoSourceAvailability;
  warnings: string[];
}

export interface CurrentVideoNoContext {
  kind: 'no_context';
  url: string | null;
  collectedAt: number;
  reason: 'non_video_page' | 'video_context_unavailable' | 'unsupported_page' | 'unknown';
  pageType: 'video' | 'non_video' | 'unknown';
}

export type CurrentVideoContextResult = CurrentVideoContext | CurrentVideoNoContext;
