import type { CurrentVideoContextResult } from '../shared/types/current-video-context.ts';
import type { CurrentVideoSegmentRetrievalResult } from '../shared/types/current-video-segment-retrieval.ts';
import type { CurrentVideoTranscriptSegment } from '../shared/types/current-video-transcript.ts';
import type { UserConfig } from '../shared/types/config.ts';
import type { VideoKnowledgeResult } from '../shared/types/video-knowledge.ts';
import { answerCurrentVideoQuestion } from '../shared/current-video-qa.ts';
import { searchCurrentVideoSegments } from '../shared/current-video-segment-retrieval.ts';
import { rerankCurrentVideoSegmentCandidates } from '../shared/current-video-segment-rerank.ts';
import { chatJson } from './ai/openai-compatible.ts';
import { loadConfig } from './storage/config-store.ts';

export interface SearchCurrentVideoSegmentsWithAiOptions {
  query: string;
  now?: number;
  limit?: number;
  contextMaxAgeMs?: number;
  transcriptSegments?: CurrentVideoTranscriptSegment[];
  videoKnowledge?: VideoKnowledgeResult | null;
  config?: UserConfig;
}

export async function searchCurrentVideoSegmentsWithAiRerank(
  context: CurrentVideoContextResult,
  options: SearchCurrentVideoSegmentsWithAiOptions,
): Promise<CurrentVideoSegmentRetrievalResult> {
  const local = searchCurrentVideoSegments(context, options);
  const config = options.config ?? await loadConfig();
  const answered = await answerCurrentVideoQuestion(context, local, {
    config,
    chat: chatJson,
    now: options.now,
  });
  return await rerankCurrentVideoSegmentCandidates(context, answered, {
    config,
    chat: chatJson,
    now: options.now,
  });
}
