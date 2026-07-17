import type { AiConfig, UserConfig } from '../shared/types/config.ts';
import type { CurrentVideoContextResult } from '../shared/types/current-video-context.ts';
import type { CurrentVideoSummaryResult } from '../shared/types/current-video-summary.ts';
import {
  buildLocalCurrentVideoSummary,
} from '../shared/current-video-summary.ts';
import type { CurrentVideoTranscriptSegment } from '../shared/types/current-video-transcript.ts';
import { chatJson } from './ai/openai-compatible.ts';
import { loadConfig } from './storage/config-store.ts';

interface AiSummaryResponse {
  summary?: unknown;
  bullets?: unknown;
  confidence?: unknown;
}

export interface GenerateCurrentVideoSummaryOptions {
  config?: UserConfig;
  chat?: (config: AiConfig, messages: Parameters<typeof chatJson>[1]) => Promise<AiSummaryResponse>;
  transcriptSegments?: CurrentVideoTranscriptSegment[];
  now?: number;
}

export async function generateCurrentVideoSummary(
  context: CurrentVideoContextResult,
  options: GenerateCurrentVideoSummaryOptions = {},
): Promise<CurrentVideoSummaryResult> {
  const config = options.config ?? await loadConfig();
  const now = options.now ?? Date.now();
  const local = buildLocalCurrentVideoSummary(context, {
    aiStatus: 'disabled',
    aiModel: config.ai.chatModel,
    aiNote: '当前只显示本地证据结果，本次没有向聊天服务发送视频内容。',
    transcriptSegments: options.transcriptSegments,
    now,
  });

  if (context.kind !== 'video') {
    return buildLocalCurrentVideoSummary(context, {
      aiStatus: 'not_requested',
      aiModel: config.ai.chatModel,
      aiNote: '没有当前视频上下文，因此没有请求 AI。',
      transcriptSegments: options.transcriptSegments,
      now,
    });
  }

  return local;
}
