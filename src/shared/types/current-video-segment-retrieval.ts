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
