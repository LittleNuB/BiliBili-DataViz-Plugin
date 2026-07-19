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

export interface CurrentVideoQueryRewriteState {
  originalQuery: string;
  normalizedQuery: string;
  expanded: boolean;
  expandedTerms: string[];
  visibleExpandedTerms: string[];
  reasons: string[];
  aiRewriteEnabled: false;
}

export type CurrentVideoSegmentRerankAiStatus =
  | 'not_requested'
  | 'disabled'
  | 'not_configured'
  | 'generated'
  | 'failed'
  | 'rejected'
  | 'low_confidence';

export type CurrentVideoQaStatus =
  | 'answered'
  | 'not_found'
  | 'insufficient_evidence'
  | 'no_transcript'
  | 'low_confidence'
  | 'no_context';

export type CurrentVideoQaAiStatus =
  | 'not_requested'
  | 'disabled'
  | 'not_configured'
  | 'generated'
  | 'failed'
  | 'rejected'
  | 'low_confidence';

export interface CurrentVideoSegmentRerankExplanation {
  candidateId: string;
  explanation: string;
  reason: string;
  confidence: number;
}

export interface CurrentVideoSegmentRerankAiState {
  status: CurrentVideoSegmentRerankAiStatus;
  model: string | null;
  note: string;
  error: string | null;
  generatedAt: number;
  payloadCandidateCount: number;
  appliedCandidateIds: string[];
  explanations: CurrentVideoSegmentRerankExplanation[];
}

export interface CurrentVideoQaCitedSegment {
  candidateId: string;
  source: CurrentVideoSegmentRetrievalCandidateSource;
  sourceLabel: string;
  timeRangeLabel: string;
  evidenceText: string;
  confidence: number;
  confidenceLabel: CurrentVideoSegmentRetrievalConfidenceLabel;
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface CurrentVideoQaSourceState {
  transcriptSegmentCount: number;
  timedKnowledgeNodeCount: number;
  metadataHintAvailable: boolean;
  contextFresh: boolean;
  hasCitableEvidence: boolean;
  hasOnlyMetadataHints: boolean;
}

export interface CurrentVideoQaAiState {
  status: CurrentVideoQaAiStatus;
  model: string | null;
  note: string;
  error: string | null;
  generatedAt: number;
  payloadCandidateCount: number;
  citedCandidateIds: string[];
}

export interface CurrentVideoQaResult {
  status: CurrentVideoQaStatus;
  answer: string;
  confidence: number;
  confidenceLabel: CurrentVideoSegmentRetrievalConfidenceLabel;
  citedSegments: CurrentVideoQaCitedSegment[];
  sourceState: CurrentVideoQaSourceState;
  aiState: CurrentVideoQaAiState;
  limitations: string[];
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
  queryRewrite: CurrentVideoQueryRewriteState;
  evidenceState: CurrentVideoSegmentRetrievalEvidenceState;
  aiRerank: CurrentVideoSegmentRerankAiState;
  qa: CurrentVideoQaResult;
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
  sourceIdentityKey: string;
  operationLeaseId: string;
}

export interface CurrentVideoTimestampReturnContentPayload {
  contextBvid: string;
  contextCid: number | null;
  contextPage: number;
  sourceIdentityKey: string;
  operationLeaseId: string;
}

export type CurrentVideoTimestampOperationKind = 'jump' | 'return';

export interface CurrentVideoTimestampOperationLeaseConsumeResult {
  authorized: boolean;
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
