import type { CurrentVideoSubtitleSourceType } from './current-video-context';

export type CurrentVideoTranscriptEvidenceStatus =
  | 'cached'
  | 'missing'
  | 'stale'
  | 'empty'
  | 'malformed'
  | 'track_unavailable'
  | 'language_mismatch'
  | 'login_required'
  | 'endpoint_failed'
  | 'unsupported';

export type CurrentVideoTranscriptSource = 'bilibili_subtitle';

export interface CurrentVideoTranscriptIdentity {
  bvid: string;
  cid: number;
  page: number;
  language?: string | null;
}

export interface CurrentVideoTranscriptSegment {
  id?: number;
  segmentId: string;
  bvid: string;
  cid: number;
  page: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  language: string | null;
  source: CurrentVideoTranscriptSource;
  sourceType: CurrentVideoSubtitleSourceType;
  sourceHash: string;
  stale: boolean;
  fetchedAt: number;
  updatedAt: number;
}

export interface CurrentVideoTranscriptSourceRecord {
  id?: number;
  identityKey: string;
  bvid: string;
  cid: number;
  page: number;
  language: string | null;
  source: CurrentVideoTranscriptSource;
  sourceType: CurrentVideoSubtitleSourceType;
  sourceHash: string | null;
  trackId: string | null;
  trackUrlHost: string | null;
  segmentCount: number;
  coverageStartSeconds: number | null;
  coverageEndSeconds: number | null;
  status: CurrentVideoTranscriptEvidenceStatus;
  stale: boolean;
  fetchedAt: number;
  updatedAt: number;
  reason: string;
  message: string;
  warnings: string[];
}

export interface CurrentVideoTranscriptEvidenceState {
  status: CurrentVideoTranscriptEvidenceStatus;
  active: boolean;
  checkedAt: number;
  bvid: string | null;
  cid: number | null;
  page: number | null;
  language: string | null;
  source: CurrentVideoTranscriptSource | null;
  sourceType: CurrentVideoSubtitleSourceType;
  sourceHash: string | null;
  segmentCount: number;
  staleSegmentCount: number;
  coverageStartSeconds: number | null;
  coverageEndSeconds: number | null;
  fetchedAt: number | null;
  updatedAt: number | null;
  reason: string;
  message: string;
  warnings: string[];
}

export interface CurrentVideoTranscriptEvidenceWrite {
  sourceRecord: CurrentVideoTranscriptSourceRecord;
  segments: CurrentVideoTranscriptSegment[];
}
