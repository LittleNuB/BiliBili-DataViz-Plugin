import type { CurrentVideoTranscriptEvidenceState } from './current-video-transcript';

export type CurrentVideoAvailability = 'available' | 'unavailable' | 'unknown';
export type CurrentVideoSubtitleSourceStatus =
  | 'available'
  | 'unavailable'
  | 'login_required'
  | 'endpoint_failed'
  | 'malformed'
  | 'unsupported';

export type CurrentVideoSubtitleSourceType =
  | 'bilibili_player_wbi_v2'
  | 'bilibili_player_v2'
  | 'none'
  | 'unknown';

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

export interface CurrentVideoSubtitleTrackDiagnostic {
  id: string | null;
  language: string | null;
  languageLabel: string | null;
  sourceType: CurrentVideoSubtitleSourceType;
  urlHost: string | null;
  segmentCount: number | null;
  coverageStartSeconds: number | null;
  coverageEndSeconds: number | null;
}

export interface CurrentVideoSubtitleSourceState {
  status: CurrentVideoSubtitleSourceStatus;
  available: boolean;
  checkedAt: number;
  bvid: string | null;
  cid: number | null;
  page: number | null;
  sourceType: CurrentVideoSubtitleSourceType;
  sourceDomain: string | null;
  sourcePath: string | null;
  trackCount: number;
  segmentCount: number | null;
  coverageStartSeconds: number | null;
  coverageEndSeconds: number | null;
  languages: string[];
  tracks: CurrentVideoSubtitleTrackDiagnostic[];
  reason: string;
  message: string;
  warnings: string[];
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
  subtitleProbe?: CurrentVideoSubtitleSourceState | null;
  transcriptEvidence?: CurrentVideoTranscriptEvidenceState | null;
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
