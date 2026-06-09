export type CurrentVideoSummarySourceTier = 'metadata_summary' | 'description_summary';
export type CurrentVideoSummaryStatus = 'ready' | 'no_context' | 'loading' | 'cancelled';
export type CurrentVideoSummaryConfidence = 'low' | 'medium';
export type CurrentVideoSummaryGenerationMode = 'local_fallback' | 'ai';
export type CurrentVideoSummaryAiStatus =
  | 'not_requested'
  | 'disabled'
  | 'not_configured'
  | 'generated'
  | 'failed'
  | 'low_confidence';

export interface CurrentVideoSummaryEvidence {
  source: 'metadata' | 'description' | 'page' | 'chapter' | 'local_fallback';
  label: string;
  value: string;
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
  sourceTierLabel: 'metadata summary' | 'description summary' | null;
  confidence: CurrentVideoSummaryConfidence;
  generationMode: CurrentVideoSummaryGenerationMode;
  title: string;
  summary: string;
  bullets: string[];
  evidence: CurrentVideoSummaryEvidence[];
  missingSources: string[];
  warnings: string[];
  limitations: string[];
  nextQuestions: string[];
  ai: CurrentVideoSummaryAiState;
  generatedAt: number;
}
