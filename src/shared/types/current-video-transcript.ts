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
  source?: CurrentVideoTranscriptSource | null;
  sourceType?: CurrentVideoSubtitleSourceType | null;
  sourceHash?: string | null;
  bodyHash?: string | null;
  timelineHash?: string | null;
  sourceIdentityKey?: string | null;
}

export interface CurrentVideoTranscriptSegment {
  id?: number;
  segmentId: string;
  sourceIdentityKey?: string;
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
  sourceIdentityKey?: string;
  partIdentityKey?: string;
  bvid: string;
  cid: number;
  page: number;
  language: string | null;
  source: CurrentVideoTranscriptSource;
  sourceType: CurrentVideoSubtitleSourceType;
  sourceHash: string | null;
  bodyHash?: string | null;
  timelineHash?: string | null;
  trackId: string | null;
  trackUrlHost: string | null;
  segmentCount: number;
  serializedBytes?: number;
  coverageStartSeconds: number | null;
  coverageEndSeconds: number | null;
  status: CurrentVideoTranscriptEvidenceStatus;
  stale: boolean;
  persistent?: boolean;
  fetchedAt: number;
  updatedAt: number;
  lastAccessedAt?: number;
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
  sourceIdentityKey?: string | null;
  sourceHash: string | null;
  bodyHash?: string | null;
  timelineHash?: string | null;
  segmentCount: number;
  staleSegmentCount: number;
  serializedBytes?: number;
  coverageStartSeconds: number | null;
  coverageEndSeconds: number | null;
  fetchedAt: number | null;
  updatedAt: number | null;
  lastAccessedAt?: number | null;
  persistent?: boolean;
  temporary?: boolean;
  reason: string;
  message: string;
  warnings: string[];
}

export interface CurrentVideoTranscriptEvidenceWrite {
  sourceRecord: CurrentVideoTranscriptSourceRecord;
  segments: CurrentVideoTranscriptSegment[];
}
