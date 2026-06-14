export type CurrentVideoSummarySourceTier = 'metadata_summary' | 'description_summary' | 'transcript_summary';
export type CurrentVideoSummaryStatus = 'ready' | 'no_context' | 'loading' | 'cancelled';
export type CurrentVideoSummaryConfidence = 'low' | 'medium' | 'high';
export type CurrentVideoSummaryGenerationMode = 'local_fallback' | 'ai';
export type CurrentVideoSummaryAiStatus =
  | 'not_requested'
  | 'disabled'
  | 'not_configured'
  | 'generated'
  | 'failed'
  | 'low_confidence'
  | 'invalid_output';

export interface CurrentVideoSummaryEvidence {
  source: 'metadata' | 'description' | 'page' | 'chapter' | 'transcript' | 'local_fallback';
  label: string;
  value: string;
  startSeconds?: number | null;
  endSeconds?: number | null;
  segmentIds?: string[];
  language?: string | null;
}

export interface CurrentVideoSummaryTimestampRange {
  startSeconds: number;
  endSeconds: number;
  label: string;
  evidenceSnippet: string;
  segmentIds: string[];
  language: string | null;
}

export interface CurrentVideoSummaryAiState {
  status: CurrentVideoSummaryAiStatus;
  model: string | null;
  error: string | null;
  note: string;
}

export interface CurrentVideoSummaryResult {
  status: CurrentVideoSummaryStatus;
  sourceTier: CurrentVideoSummarySourceTier | null;
  sourceTierLabel: '元数据摘要' | '简介摘要' | '字幕正文摘要' | null;
  confidence: CurrentVideoSummaryConfidence;
  generationMode: CurrentVideoSummaryGenerationMode;
  title: string;
  summary: string;
  bullets: string[];
  evidence: CurrentVideoSummaryEvidence[];
  timestampRanges: CurrentVideoSummaryTimestampRange[];
  missingSources: string[];
  warnings: string[];
  limitations: string[];
  nextQuestions: string[];
  ai: CurrentVideoSummaryAiState;
  generatedAt: number;
}
