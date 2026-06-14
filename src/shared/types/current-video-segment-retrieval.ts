export type CurrentVideoSegmentRetrievalStatus =
  | 'ready'
  | 'empty_query'
  | 'no_context'
  | 'stale_context'
  | 'no_evidence'
  | 'metadata_only'
  | 'low_confidence';

export type CurrentVideoSegmentRetrievalCandidateSource =
  | 'transcript_segment'
  | 'transcript_node'
  | 'chapter_node'
  | 'page_node'
  | 'metadata_hint'
  | 'description_hint';

export type CurrentVideoSegmentRetrievalConfidenceLabel = '高' | '中' | '低';

export type CurrentVideoTimestampJumpDisabledReason =
  | 'confirmation_required'
  | 'no_context'
  | 'stale_context'
  | 'not_timed_candidate'
  | 'metadata_only'
  | 'low_confidence'
  | 'invalid_timestamp'
  | 'candidate_not_found'
  | 'context_mismatch'
  | 'player_unavailable'
  | 'unsupported_player';

export interface CurrentVideoTimestampJumpPreview {
  canJump: boolean;
  requiresConfirmation: true;
  disabledReason: CurrentVideoTimestampJumpDisabledReason | null;
  message: string;
  targetSeconds: number | null;
  targetTimeLabel: string | null;
  sourceLabel: string;
  confidence: number;
  confidenceLabel: CurrentVideoSegmentRetrievalConfidenceLabel;
  evidencePreview: string;
}

export interface CurrentVideoSegmentRetrievalCandidateBinding {
  kind: 'transcript_segment' | 'video_knowledge_node' | 'metadata_hint';
  segmentId?: string | null;
  nodeId?: string | null;
}

export interface CurrentVideoSegmentRetrievalCandidate {
  id: string;
  binding: CurrentVideoSegmentRetrievalCandidateBinding;
  source: CurrentVideoSegmentRetrievalCandidateSource;
  sourceLabel: string;
  startSeconds: number | null;
  endSeconds: number | null;
  timeRangeLabel: string;
  evidenceText: string;
  matchReasons: string[];
  confidence: number;
  confidenceLabel: CurrentVideoSegmentRetrievalConfidenceLabel;
  note: string | null;
  jumpPreview: CurrentVideoTimestampJumpPreview;
}

export interface CurrentVideoSegmentRetrievalEvidenceState {
  transcriptSegmentCount: number;
  timedKnowledgeNodeCount: number;
  metadataHintAvailable: boolean;
  contextFresh: boolean;
}

export interface CurrentVideoSegmentRetrievalResult {
  status: CurrentVideoSegmentRetrievalStatus;
  query: string;
  normalizedQuery: string;
  title: string;
  generatedAt: number;
  candidates: CurrentVideoSegmentRetrievalCandidate[];
  summary: string;
  limitations: string[];
  evidenceState: CurrentVideoSegmentRetrievalEvidenceState;
}

export interface CurrentVideoTimestampJumpContentPayload {
  candidateId: string;
  confirmed: boolean;
  contextBvid: string;
  contextCid: number | null;
  contextPage: number;
  contextUrl: string;
  contextCollectedAt: number;
  targetSeconds: number;
  targetTimeLabel: string;
  sourceLabel: string;
  confidence: number;
  confidenceLabel: CurrentVideoSegmentRetrievalConfidenceLabel;
  evidencePreview: string;
}

export interface CurrentVideoTimestampJumpResponse {
  ok: boolean;
  message: string;
  candidateId: string;
  targetSeconds: number | null;
  targetTimeLabel: string | null;
  returnPointSeconds: number | null;
  sourceLabel: string | null;
  confidence: number | null;
}

export interface CurrentVideoTimestampReturnResponse {
  ok: boolean;
  message: string;
  candidateId: string | null;
  returnPointSeconds: number | null;
  targetSeconds: number | null;
}
