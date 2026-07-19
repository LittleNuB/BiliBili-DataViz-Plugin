import type { AiConfig, UserConfig } from '../shared/types/config.ts';
import type { CurrentVideoContextResult } from '../shared/types/current-video-context.ts';
import type { CurrentVideoTranscriptSegment } from '../shared/types/current-video-transcript.ts';
import type { CurrentVideoSummaryHighlightsResult } from '../shared/types/current-video-summary.ts';
import {
  buildCurrentVideoFullTextRequestEnvelope,
  CurrentVideoFullTextRequestGuard,
  type CurrentVideoTextSourceIdentity,
} from '../shared/current-video-primary-text.ts';
import {
  approximateTextSize,
  buildCurrentVideoSummaryHighlightsAiPayload,
  type CurrentVideoSummaryHighlightsAiOutput,
  buildCurrentVideoSummaryHighlightsMessages,
  cancelledCurrentVideoSummaryHighlights,
  disabledCurrentVideoSummaryHighlights,
  failedCurrentVideoSummaryHighlights,
  invalidCurrentVideoSummaryHighlights,
  noTextCurrentVideoSummaryHighlights,
  notConfiguredCurrentVideoSummaryHighlights,
  notRequestedCurrentVideoSummaryHighlights,
  readyCurrentVideoSummaryHighlights,
  requestSnapshotFromEnvelope,
  textSizeFromEnvelope,
  validateCurrentVideoSummaryHighlightsAiOutput,
} from '../shared/current-video-summary-highlights.ts';
import { chatJson } from './ai/openai-compatible.ts';
import {
  canUseCurrentVideoSummaryHighlightsClearGeneration,
  getCurrentVideoSummaryHighlightsClearState,
} from './current-video-summary-highlights-clear-epoch.ts';
import {
  buildCurrentVideoSummaryHighlightsCacheKey,
  getCurrentVideoSummaryHighlightsCache,
  putCurrentVideoSummaryHighlightsCache,
  withCurrentCacheHit,
} from './storage/current-video-summary-highlights-repo.ts';
import { loadConfig } from './storage/config-store.ts';

const summaryHighlightsRequestGuard = new CurrentVideoFullTextRequestGuard();

export interface GenerateCurrentVideoSummaryHighlightsOptions {
  config?: UserConfig;
  chat?: (config: AiConfig, messages: Parameters<typeof chatJson>[1]) => Promise<CurrentVideoSummaryHighlightsAiOutput>;
  transcriptSegments: CurrentVideoTranscriptSegment[];
  now?: number;
  currentIdentity?: Pick<CurrentVideoTextSourceIdentity, 'sourceIdentityKey'> | null;
  resolveCurrentIdentity?: () => Promise<Pick<CurrentVideoTextSourceIdentity, 'sourceIdentityKey'> | null>;
}

export async function readCachedCurrentVideoSummaryHighlights(
  context: CurrentVideoContextResult,
  options: { config?: UserConfig; now?: number } = {},
): Promise<CurrentVideoSummaryHighlightsResult> {
  const config = options.config ?? await loadConfig();
  const now = options.now ?? Date.now();
  const title = currentVideoSummaryHighlightsTitle(context);
  const model = normalizedModel(config);
  const identity = activeSourceIdentity(context);
  if (!identity) {
    return notRequestedCurrentVideoSummaryHighlights(title, now);
  }
  if (!model) {
    return notConfiguredCurrentVideoSummaryHighlights(title, null, approximateSizeFromContext(context), now);
  }

  const record = await getCurrentVideoSummaryHighlightsCache({
    identity,
    model,
    now,
  });
  if (!record) {
    return notRequestedCurrentVideoSummaryHighlights(title, now);
  }
  return withCurrentCacheHit(record, identity.sourceIdentityKey === record.sourceIdentityKey);
}

export async function generateCurrentVideoSummaryHighlights(
  context: CurrentVideoContextResult,
  options: GenerateCurrentVideoSummaryHighlightsOptions,
): Promise<CurrentVideoSummaryHighlightsResult> {
  const config = options.config ?? await loadConfig();
  const now = options.now ?? Date.now();
  const title = currentVideoSummaryHighlightsTitle(context);
  const model = normalizedModel(config);
  const approximateSize = approximateSizeFromContext(context);
  if (context.kind !== 'video') {
    return noTextCurrentVideoSummaryHighlights(title, model, approximateSize, now);
  }
  if (!config.assistant.currentVideoAiAssistantEnabled) {
    return disabledCurrentVideoSummaryHighlights(title, model, approximateSize, now);
  }
  if (!aiConfigured(config)) {
    return notConfiguredCurrentVideoSummaryHighlights(title, model, approximateSize, now);
  }
  if (
    !model
    || !context.cid
    || options.transcriptSegments.length <= 0
    || !context.transcriptEvidence?.active
    || !context.transcriptEvidence.sourceType
  ) {
    return noTextCurrentVideoSummaryHighlights(title, model, approximateSize, now);
  }

  const envelope = buildCurrentVideoFullTextRequestEnvelope({
    operation: 'summary_highlights',
    submittedAt: now,
    model,
    video: {
      bvid: context.bvid,
      cid: context.cid,
      page: context.currentPart.page,
      title: context.title,
      partTitle: context.currentPart.title,
      durationSeconds: context.durationSeconds,
    },
    source: 'bilibili_subtitle',
    sourceType: context.transcriptEvidence.sourceType,
    sourceLabel: 'B站字幕',
    language: context.transcriptEvidence.language,
    lines: options.transcriptSegments.map(segment => ({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    })),
  });
  const textSize = textSizeFromEnvelope(envelope);
  if (context.transcriptEvidence.sourceIdentityKey !== envelope.primaryTextIdentity.sourceIdentityKey) {
    return noTextCurrentVideoSummaryHighlights(title, model, textSize, now);
  }

  const clearState = getCurrentVideoSummaryHighlightsClearState();
  summaryHighlightsRequestGuard.start(envelope);

  let aiOutput: CurrentVideoSummaryHighlightsAiOutput;
  try {
    const payload = buildCurrentVideoSummaryHighlightsAiPayload(envelope);
    const messages = buildCurrentVideoSummaryHighlightsMessages(payload);
    aiOutput = await (options.chat ?? chatJson)(config.ai, messages);
  } catch (error) {
    return failedCurrentVideoSummaryHighlights(title, model, errorMessage(error), textSize, Date.now());
  }

  const currentIdentity = options.resolveCurrentIdentity
    ? await options.resolveCurrentIdentity()
    : options.currentIdentity;
  const commit = summaryHighlightsRequestGuard.canCommit(envelope, currentIdentity);
  if (!commit.ok || !canUseCurrentVideoSummaryHighlightsClearGeneration(clearState.generation)) {
    return cancelledCurrentVideoSummaryHighlights(
      title,
      model,
      textSize,
      '本次生成已经被取消、替换或清理，旧结果不会被替换。',
      Date.now(),
    );
  }

  const validation = validateCurrentVideoSummaryHighlightsAiOutput(aiOutput, envelope);
  if (!validation.ok) {
    return invalidCurrentVideoSummaryHighlights(title, model, validation.reason, textSize, Date.now());
  }

  const cacheKey = buildCurrentVideoSummaryHighlightsCacheKey({
    identity: envelope.primaryTextIdentity,
    model,
  });
  const generatedAt = Date.now();
  let result = readyCurrentVideoSummaryHighlights({
    title,
    sourceLabel: envelope.sourceLabel,
    textSize,
    summarySentences: validation.result.summarySentences,
    keyPoints: validation.result.keyPoints,
    highlights: validation.result.highlights,
    model,
    cacheKey,
    cacheHit: false,
    current: commit.current,
    requestId: envelope.requestId,
    generatedAt,
  });

  const cacheResult = await putCurrentVideoSummaryHighlightsCache({
    cacheKey,
    sourceIdentityKey: envelope.primaryTextIdentity.sourceIdentityKey,
    model,
    bvid: envelope.video.bvid,
    cid: envelope.video.cid,
    page: envelope.video.page,
    generatedAt,
    lastAccessedAt: generatedAt,
    requestSnapshot: requestSnapshotFromEnvelope(envelope),
    result,
  });
  result = {
    ...result,
    cacheKey: cacheResult.cacheKey,
    limitations: cacheResult.cached
      ? result.limitations
      : [...result.limitations, '本次结果超过本地缓存上限，仅返回当前结果。'],
  };
  return result;
}

export function cancelCurrentVideoSummaryHighlightsRequest(requestId: string): void {
  summaryHighlightsRequestGuard.cancel(requestId);
}

export function cancelCurrentVideoSummaryHighlightsForSource(sourceIdentityKey: string): void {
  summaryHighlightsRequestGuard.clearPrimaryText({ sourceIdentityKey });
}

export function currentVideoSummaryHighlightsTitle(context: CurrentVideoContextResult | null): string {
  if (context?.kind !== 'video') return '当前视频';
  return context.title?.trim() || '当前视频';
}

export function approximateSizeFromContext(context: CurrentVideoContextResult | null) {
  if (context?.kind !== 'video') return approximateTextSize(0, 0);
  return approximateTextSize(
    context.transcriptEvidence?.segmentCount ?? 0,
    context.transcriptEvidence?.serializedBytes ?? 0,
  );
}

function activeSourceIdentity(
  context: CurrentVideoContextResult,
): Pick<CurrentVideoTextSourceIdentity, 'sourceIdentityKey'> | null {
  if (
    context.kind !== 'video'
    || !context.transcriptEvidence?.active
    || !context.transcriptEvidence.sourceIdentityKey
  ) {
    return null;
  }
  return { sourceIdentityKey: context.transcriptEvidence.sourceIdentityKey };
}

function aiConfigured(config: UserConfig): boolean {
  return Boolean(
    config.ai.baseURL.trim()
    && config.ai.chatModel.trim()
    && config.ai.apiKey.trim(),
  );
}

function normalizedModel(config: UserConfig): string | null {
  return config.ai.chatModel.trim() || null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
