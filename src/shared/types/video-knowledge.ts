import type { CurrentVideoTranscriptEvidenceState } from './current-video-transcript';

export type VideoKnowledgeSource =
  | 'metadata'
  | 'description'
  | 'page'
  | 'chapter'
  | 'transcript'
  | 'user_bookmark'
  | 'user_note'
  | 'local_watch_event'
  | 'local_fallback';

export type VideoKnowledgeStatus = 'ready' | 'no_context';

export type VideoKnowledgeSafetyFlag =
  | 'metadata_only'
  | 'description_only'
  | 'page_bound'
  | 'chapter_bound'
  | 'transcript_grounded'
  | 'bounded_current_video'
  | 'manual_confirm_required'
  | 'auto_jump_disabled'
  | 'no_transcript'
  | 'low_confidence'
  | 'stale_source'
  | 'language_mismatch';

export type VideoKnowledgeEvidenceSourceStatus =
  | 'active'
  | 'stale'
  | 'mismatch'
  | 'unavailable';

export interface VideoKnowledgeEvidence {
  textSpan: string | null;
  startChar: number | null;
  endChar: number | null;
  language: string | null;
  sourceId: string;
  segmentId?: string | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  sourceHash?: string | null;
  sourceStatus?: VideoKnowledgeEvidenceSourceStatus;
}

export interface VideoKnowledgeJumpAction {
  type: 'seek' | 'page';
  targetSeconds: number | null;
  targetPage: number | null;
  targetCid: number | null;
  previewLabel: string;
  requiresConfirmation: true;
  returnPointSeconds: number | null;
}

export interface VideoKnowledgeNode {
  id: string;
  bvid: string;
  cid: number | null;
  page: number;
  timestamp: number | null;
  endTimestamp: number | null;
  title: string;
  reason: string;
  source: VideoKnowledgeSource;
  sourceLabel: string;
  confidence: number;
  evidence: VideoKnowledgeEvidence | null;
  jumpAction: VideoKnowledgeJumpAction | null;
  safetyFlags: VideoKnowledgeSafetyFlag[];
  createdAt: number;
  updatedAt: number;
}

export interface VideoKnowledgeSourceState {
  metadata: boolean;
  description: boolean;
  pages: boolean;
  chapters: boolean;
  transcript: boolean;
  transcriptEvidence: boolean;
  contentText: boolean;
}

export interface VideoKnowledgeResult {
  status: VideoKnowledgeStatus;
  title: string;
  generatedAt: number;
  sourceState: VideoKnowledgeSourceState;
  transcriptEvidence: CurrentVideoTranscriptEvidenceState | null;
  nodes: VideoKnowledgeNode[];
  warnings: string[];
  limitations: string[];
}

export interface VideoKnowledgeJumpRequest {
  nodeId: string;
  confirmed: boolean;
}

export interface VideoKnowledgeJumpResponse {
  ok: boolean;
  message: string;
  nodeId: string;
  previousPositionSeconds: number | null;
  targetSeconds: number | null;
  targetPage: number | null;
}
