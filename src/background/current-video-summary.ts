import type { AiConfig, UserConfig } from '../shared/types/config';
import type { CurrentVideoContextResult } from '../shared/types/current-video-context';
import type { CurrentVideoSummaryResult } from '../shared/types/current-video-summary';
import {
  buildCurrentVideoSummaryAiPayload,
  buildLocalCurrentVideoSummary,
} from '../shared/current-video-summary';
import { chatJson } from './ai/openai-compatible';
import { loadConfig } from './storage/config-store';

interface AiSummaryResponse {
  summary?: unknown;
  bullets?: unknown;
  confidence?: unknown;
}

export interface GenerateCurrentVideoSummaryOptions {
  config?: UserConfig;
  chat?: (config: AiConfig, messages: Parameters<typeof chatJson>[1]) => Promise<AiSummaryResponse>;
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
    aiNote: 'AI 摘要未启用，当前显示本地证据结果。',
    now,
  });

  if (context.kind !== 'video') {
    return buildLocalCurrentVideoSummary(context, {
      aiStatus: 'not_requested',
      aiModel: config.ai.chatModel,
      aiNote: '没有当前视频上下文，因此没有请求 AI。',
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
      aiNote: 'AI 摘要已启用但没有配置 API Key，当前显示本地证据结果。',
      now,
    });
  }

  try {
    const payload = buildCurrentVideoSummaryAiPayload(context);
    const ai = await (options.chat ?? chatJson)(config.ai, [
      {
        role: 'system',
        content: [
          'You are Bili-Bill current video assistant. Return JSON only.',
          'You may summarize only the provided metadata and description payload.',
          'Do not claim a full video summary, full understanding, transcript coverage, audio analysis, comments, danmaku, or visual analysis.',
          'Keep the source tier exactly aligned with the payload sourceTier.',
          'JSON fields: summary string, bullets string[], confidence number from 0 to 1.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ]);
    const normalized = normalizeAiSummary(ai, local);
    if (normalized.confidence < LOW_AI_CONFIDENCE_THRESHOLD) {
      return buildLocalCurrentVideoSummary(context, {
        aiStatus: 'low_confidence',
        aiModel: config.ai.chatModel,
        aiNote: `AI 返回置信度 ${normalized.confidence.toFixed(2)}，低于本地证据结果阈值；当前显示本地证据结果。`,
        now,
      });
    }

    return {
      ...local,
      generationMode: 'ai',
      summary: normalized.summary,
      bullets: normalized.bullets,
      ai: {
        status: 'generated',
        model: config.ai.chatModel,
        error: null,
        note: 'AI 只基于有边界的当前视频元数据和简介 payload 生成。',
      },
      generatedAt: now,
    };
  } catch (error) {
    return buildLocalCurrentVideoSummary(context, {
      aiStatus: 'failed',
      aiModel: config.ai.chatModel,
      aiError: errorMessage(error),
      aiNote: 'AI 生成失败，当前显示本地证据结果。',
      now,
    });
  }
}

function normalizeAiSummary(
  ai: AiSummaryResponse,
  fallback: CurrentVideoSummaryResult,
): { summary: string; bullets: string[]; confidence: number } {
  const summary = normalizeText(ai.summary, fallback.summary, 520);
  const bullets = normalizeBullets(ai.bullets, fallback.bullets);
  const confidence = normalizeConfidence(ai.confidence);
  return { summary, bullets, confidence };
}

function normalizeBullets(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const bullets = value
    .map(item => normalizeText(item, '', 220))
    .filter(Boolean)
    .slice(0, 5);
  return bullets.length > 0 ? bullets : fallback;
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const text = raw || fallback;
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.round(Math.max(0, Math.min(1, numeric)) * 100) / 100;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
