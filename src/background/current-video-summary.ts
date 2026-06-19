import type { AiConfig, UserConfig } from '../shared/types/config.ts';
import type { CurrentVideoContextResult } from '../shared/types/current-video-context.ts';
import type { CurrentVideoSummaryResult } from '../shared/types/current-video-summary.ts';
import {
  buildCurrentVideoSummaryAiPayload,
  buildLocalCurrentVideoSummary,
  validateCurrentVideoSummaryAiOutput,
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

const LOW_AI_CONFIDENCE_THRESHOLD = 0.45;

export async function generateCurrentVideoSummary(
  context: CurrentVideoContextResult,
  options: GenerateCurrentVideoSummaryOptions = {},
): Promise<CurrentVideoSummaryResult> {
  const config = options.config ?? await loadConfig();
  const now = options.now ?? Date.now();
  const local = buildLocalCurrentVideoSummary(context, {
    aiStatus: 'disabled',
    aiModel: config.ai.chatModel,
    aiNote: 'AI 摘要未在设置中启用，当前显示本地证据结果。',
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

  if (!config.assistant.aiSummariesEnabled) {
    return local;
  }

  if (!config.ai.apiKey.trim()) {
    return buildLocalCurrentVideoSummary(context, {
      aiStatus: 'not_configured',
      aiModel: config.ai.chatModel,
      aiNote: 'AI 摘要已启用但尚未在设置中配置 API Key，当前显示本地证据结果。',
      transcriptSegments: options.transcriptSegments,
      now,
    });
  }

  try {
    const payload = buildCurrentVideoSummaryAiPayload(context, {
      transcriptSegments: options.transcriptSegments,
    });
    const transcriptPayload = payload.intent === 'current_video_transcript_summary_v1';
    const ai = await (options.chat ?? chatJson)(config.ai, [
      {
        role: 'system',
        content: buildSystemPrompt(transcriptPayload),
      },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ]);

    const validated = validateCurrentVideoSummaryAiOutput(ai, payload, local);
    if (!validated.ok) {
      return buildLocalCurrentVideoSummary(context, {
        aiStatus: 'invalid_output',
        aiModel: config.ai.chatModel,
        aiError: validated.error,
        aiNote: 'AI 返回内容引用了本次证据范围之外的片段或时间，当前显示本地字幕正文证据结果。',
        transcriptSegments: options.transcriptSegments,
        now,
      });
    }
    if (validated.confidence < LOW_AI_CONFIDENCE_THRESHOLD) {
      return buildLocalCurrentVideoSummary(context, {
        aiStatus: 'low_confidence',
        aiModel: config.ai.chatModel,
        aiNote: `AI 返回置信度 ${validated.confidence.toFixed(2)}，低于本地证据结果阈值；当前显示本地证据结果。`,
        transcriptSegments: options.transcriptSegments,
        now,
      });
    }

    return {
      ...local,
      generationMode: 'ai',
      summary: validated.summary,
      bullets: validated.bullets,
      ai: {
        status: 'generated',
        model: config.ai.chatModel,
        error: null,
        note: transcriptPayload
          ? 'AI 只基于当前视频元数据和有边界的字幕正文证据片段生成。'
          : 'AI 只基于有边界的当前视频元数据和简介 payload 生成。',
      },
      generatedAt: now,
    };
  } catch (error) {
    return buildLocalCurrentVideoSummary(context, {
      aiStatus: 'failed',
      aiModel: config.ai.chatModel,
      aiError: errorMessage(error),
      aiNote: 'AI 生成失败，当前显示本地证据结果。',
      transcriptSegments: options.transcriptSegments,
      now,
    });
  }
}

function buildSystemPrompt(transcriptPayload: boolean): string {
  const common = [
    'You are Bili-Bill current video assistant. Return JSON only.',
    'Keep the source tier exactly aligned with the payload sourceTier.',
    'JSON fields: summary string, bullets string[], confidence number from 0 to 1.',
  ];
  if (transcriptPayload) {
    return [
      ...common,
      'Summarize only the provided current-video metadata and transcript chunks.',
      'Do not cite segment IDs or timestamps that are not in the payload.',
      'Do not claim access to audio, visuals, comments, danmaku, local ledgers, or any unprovided data.',
    ].join('\n');
  }
  return [
    ...common,
    'You may summarize only the provided metadata and description payload.',
    'Do not claim a full video summary, full understanding, transcript coverage, audio analysis, comments, danmaku, or visual analysis.',
  ].join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
