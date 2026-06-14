import type { CurrentVideoContext, CurrentVideoContextResult } from './types/current-video-context';
import type {
  CurrentVideoSummaryAiStatus,
  CurrentVideoSummaryEvidence,
  CurrentVideoSummaryResult,
  CurrentVideoSummarySourceTier,
} from './types/current-video-summary';

export interface LocalSummaryOptions {
  aiStatus?: CurrentVideoSummaryAiStatus;
  aiModel?: string | null;
  aiError?: string | null;
  aiNote?: string;
  now?: number;
}

const DESCRIPTION_EVIDENCE_LIMIT = 360;
const DESCRIPTION_AI_PAYLOAD_LIMIT = 1200;
const LIST_LIMIT = 6;

export function buildLocalCurrentVideoSummary(
  context: CurrentVideoContextResult,
  options: LocalSummaryOptions = {},
): CurrentVideoSummaryResult {
  const now = options.now ?? Date.now();
  if (context.kind !== 'video') {
    return {
      status: 'no_context',
      sourceTier: null,
      sourceTierLabel: null,
      confidence: 'low',
      generationMode: 'local_fallback',
      title: '没有当前视频上下文',
      summary: noContextSummary(context.reason),
      bullets: ['请打开一个 B 站视频页，Bili-Bill 才能读取当前视频元数据。'],
      evidence: [],
      missingSources: ['元数据', '简介', '字幕', '正文文本'],
      warnings: [],
      limitations: ['当前标签页没有可用的视频元数据。'],
      nextQuestions: [],
      ai: {
        status: options.aiStatus ?? 'not_requested',
        model: options.aiModel ?? null,
        error: options.aiError ?? null,
        note: options.aiNote ?? '没有当前视频上下文，因此没有请求 AI。',
      },
      generatedAt: now,
    };
  }

  const tier = selectSourceTier(context);
  const confidence = tier === 'description_summary' && usefulDescriptionLength(context) >= 80 ? 'medium' : 'low';
  const evidence = buildEvidence(context, tier);
  const missingSources = buildMissingSources(context);
  const limitations = buildLimitations(context, tier);

  return {
    status: 'ready',
    sourceTier: tier,
    sourceTierLabel: sourceTierLabel(tier),
    confidence,
    generationMode: 'local_fallback',
    title: context.title ?? context.bvid,
    summary: buildSummarySentence(context, tier),
    bullets: buildSummaryBullets(context, tier),
    evidence,
    missingSources,
    warnings: Array.from(new Set(context.warnings)),
    limitations,
    nextQuestions: buildNextQuestions(tier),
    ai: {
      status: options.aiStatus ?? 'not_requested',
      model: options.aiModel ?? null,
      error: options.aiError ?? null,
      note: options.aiNote ?? localAiNote(options.aiStatus),
    },
    generatedAt: now,
  };
}

export function loadingCurrentVideoSummary(now = Date.now()): CurrentVideoSummaryResult {
  return {
    status: 'loading',
    sourceTier: null,
    sourceTierLabel: null,
    confidence: 'low',
    generationMode: 'local_fallback',
    title: '正在准备当前视频摘要',
    summary: '正在读取当前视频上下文，并检查是否允许 AI 生成。',
    bullets: [],
    evidence: [],
    missingSources: [],
    warnings: [],
    limitations: ['你可以取消本次请求；取消后仍会保留本地证据结果。'],
    nextQuestions: [],
    ai: {
      status: 'not_requested',
      model: null,
      error: null,
      note: '正在等待 AI 请求结果被确认。',
    },
    generatedAt: now,
  };
}

export function cancelledCurrentVideoSummary(
  context: CurrentVideoContextResult | null,
  now = Date.now(),
): CurrentVideoSummaryResult {
  if (context) {
    return {
      ...buildLocalCurrentVideoSummary(context, {
        aiStatus: 'not_requested',
        aiNote: '可见的 AI 摘要请求已取消；当前显示本地证据结果。',
        now,
      }),
      status: 'cancelled',
    };
  }

  return {
    ...loadingCurrentVideoSummary(now),
    status: 'cancelled',
    title: '摘要请求已取消',
    summary: '当前视频上下文可用前，摘要请求已被取消。',
    limitations: ['取消后没有采用任何 AI 结果。'],
  };
}

export interface CurrentVideoSummaryAiPayload {
  intent: 'current_video_summary_v0';
  video: {
    bvid: string;
    cid: number | null;
    title: string | null;
    authorName: string | null;
    durationSeconds: number | null;
    currentPart: {
      page: number;
      title: string | null;
      total: number | null;
    };
    parts: Array<{
      page: number;
      cid: number | null;
      title: string | null;
      durationSeconds: number | null;
    }>;
    chapters: Array<{
      title: string;
      startSeconds: number | null;
    }>;
    description: {
      availability: string;
      text: string | null;
      length: number | null;
    };
  };
  availableSources: {
    metadata: string;
    description: string;
    pages: string;
    chapters: string;
    transcript: string;
    contentText: string;
  };
  sourceTier: 'metadata summary' | 'description summary';
  warnings: string[];
  safetyRules: string[];
}

export function buildCurrentVideoSummaryAiPayload(
  context: CurrentVideoContext,
): CurrentVideoSummaryAiPayload {
  const tier = selectSourceTier(context);
  return {
    intent: 'current_video_summary_v0',
    video: {
      bvid: context.bvid,
      cid: context.cid,
      title: limitNullableText(context.title, 160),
      authorName: limitNullableText(context.authorName, 80),
      durationSeconds: context.durationSeconds,
      currentPart: {
        page: context.currentPart.page,
        title: limitNullableText(context.currentPart.title, 120),
        total: context.currentPart.total,
      },
      parts: context.parts.slice(0, LIST_LIMIT).map(part => ({
        page: part.page,
        cid: part.cid,
        title: limitNullableText(part.title, 120),
        durationSeconds: part.durationSeconds,
      })),
      chapters: context.chapters.slice(0, LIST_LIMIT).map(chapter => ({
        title: limitText(chapter.title, 120),
        startSeconds: chapter.startSeconds,
      })),
      description: {
        availability: context.description.availability,
        text: tier === 'description_summary'
          ? limitNullableText(context.description.text, DESCRIPTION_AI_PAYLOAD_LIMIT)
          : null,
        length: context.description.length,
      },
    },
    availableSources: {
      metadata: context.sources.metadata,
      description: context.sources.description,
      pages: context.sources.pages,
      chapters: context.sources.chapters,
      transcript: context.sources.transcript,
      contentText: context.sources.contentText,
    },
    sourceTier: payloadSourceTierLabel(tier),
    warnings: Array.from(new Set(context.warnings)).slice(0, 12),
    safetyRules: [
      'Do not claim a full-video summary because this payload does not contain transcript segments or content text.',
      'If availableSources.transcript is available, treat it only as source availability metadata; no transcript text was provided.',
      'Do not infer body content beyond visible metadata, description, page titles, or chapter titles.',
      'Return the same source tier provided in sourceTier.',
    ],
  };
}

function selectSourceTier(context: CurrentVideoContext): CurrentVideoSummarySourceTier {
  return context.sources.description === 'available' && Boolean(context.description.text?.trim())
    ? 'description_summary'
    : 'metadata_summary';
}

function sourceTierLabel(tier: CurrentVideoSummarySourceTier): '元数据摘要' | '简介摘要' {
  return tier === 'description_summary' ? '简介摘要' : '元数据摘要';
}

function payloadSourceTierLabel(tier: CurrentVideoSummarySourceTier): 'metadata summary' | 'description summary' {
  return tier === 'description_summary' ? 'description summary' : 'metadata summary';
}

function usefulDescriptionLength(context: CurrentVideoContext): number {
  return context.description.text?.trim().length ?? 0;
}

function buildSummarySentence(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string {
  const title = context.title ?? context.bvid;
  const author = context.authorName ? `，UP 主：${context.authorName}` : '';
  if (tier === 'description_summary') {
    return `基于可见简介和元数据，《${title}》${author}大致围绕：${descriptionLead(context.description.text)}。`;
  }
  return `仅基于可见元数据，《${title}》${author}。目前只能从标题、UP 主、时长，以及可用的分 P 或章节标题判断主题。`;
}

function buildSummaryBullets(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string[] {
  const bullets: string[] = [];
  if (context.authorName) bullets.push(`元数据显示 UP 主：${context.authorName}。`);
  if (context.durationSeconds) bullets.push(`可见时长：${formatDuration(context.durationSeconds)}。`);
  if (context.currentPart.total && context.currentPart.total > 1) {
    bullets.push(`当前分 P：第 ${context.currentPart.page} / ${context.currentPart.total} P${context.currentPart.title ? `，「${context.currentPart.title}」` : ''}。`);
  }
  if (context.parts.length > 1) {
    bullets.push(`可见 ${context.parts.length} 个分 P 标题，导航上下文比单个标题更充分。`);
  }
  if (context.chapters.length > 0) {
    bullets.push('检测到章节标题，但它们只作为结构标签，不当作字幕证据。');
  }
  if (tier === 'description_summary' && context.description.text) {
    bullets.unshift(`简介写到：${limitText(context.description.text, 180)}`);
  }
  if (bullets.length === 0) {
    bullets.push('当前只有 BVID 和基础页面上下文可用。');
  }
  return bullets.slice(0, 5);
}

function buildEvidence(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): CurrentVideoSummaryEvidence[] {
  const evidence: CurrentVideoSummaryEvidence[] = [
    { source: 'metadata', label: 'BVID', value: context.bvid },
  ];
  if (context.title) evidence.push({ source: 'metadata', label: '标题', value: context.title });
  if (context.authorName) evidence.push({ source: 'metadata', label: 'UP 主', value: context.authorName });
  if (context.durationSeconds) evidence.push({ source: 'metadata', label: '时长', value: formatDuration(context.durationSeconds) });
  if (context.currentPart.title) evidence.push({ source: 'page', label: '当前分 P', value: context.currentPart.title });
  if (context.parts.length > 0) evidence.push({ source: 'page', label: '分 P 数量', value: String(context.parts.length) });
  if (context.chapters.length > 0) {
    evidence.push({
      source: 'chapter',
      label: '章节',
      value: context.chapters.slice(0, 3).map(chapter => chapter.title).join('、'),
    });
  }
  if (tier === 'description_summary' && context.description.text) {
    evidence.push({
      source: 'description',
      label: '简介摘录',
      value: limitText(context.description.text, DESCRIPTION_EVIDENCE_LIMIT),
    });
  }
  evidence.push({
    source: 'local_fallback',
    label: '来源边界',
    value: '简介和正文文本是不同来源层级；当前正文文本不可用。',
  });
  if (context.subtitleProbe) {
    evidence.push({
      source: 'local_fallback',
      label: '字幕来源探测',
      value: context.subtitleProbe.message,
    });
  }
  if (context.transcriptEvidence && context.transcriptEvidence.status !== 'missing') {
    evidence.push({
      source: 'local_fallback',
      label: 'Transcript evidence cache',
      value: context.transcriptEvidence.message,
    });
  }
  return evidence;
}

function buildMissingSources(context: CurrentVideoContext): string[] {
  const missing: string[] = [];
  if (context.sources.description !== 'available') missing.push('简介');
  if (context.sources.transcript === 'unknown') {
    missing.push('字幕来源探测');
  } else if (context.sources.transcript !== 'available') {
    missing.push('字幕');
  }
  if (context.sources.contentText !== 'available') {
    missing.push(context.sources.transcript === 'available' ? '字幕正文/正文文本' : '正文文本');
  }
  if (context.sources.pages !== 'available') missing.push('分 P 标题');
  if (context.sources.chapters !== 'available') missing.push('章节');
  return missing;
}

function buildLimitations(
  context: CurrentVideoContext,
  tier: CurrentVideoSummarySourceTier,
): string[] {
  const limitations = [
    transcriptLimitation(context),
    '完整正文文本不可用；简介不会被当作正文内容。',
  ];
  if (tier === 'metadata_summary') {
    limitations.unshift('当前只有元数据可用，因此摘要置信度较低，只能判断主题层面。');
  } else {
    limitations.unshift('摘要使用可见简介和元数据，但不包含字幕或完整正文文本。');
  }
  if (context.sources.chapters === 'available') {
    limitations.push('章节标题只能说明结构，不会被扩展成正文内容判断。');
  }
  return limitations;
}

function transcriptLimitation(context: CurrentVideoContext): string {
  if (context.transcriptEvidence?.active) {
    return '已缓存本地 transcript 证据，但当前摘要 slice 仍不读取或发送字幕正文，不会生成完整视频总结；#101 才会接入 transcript summary pipeline。';
  }

  if (context.sources.transcript === 'available') {
    return '已探测到字幕来源，但当前版本只记录来源状态，尚未读取、缓存或总结 transcript 正文；因此这仍不是完整视频总结。';
  }

  if (context.sources.transcript === 'unknown') {
    return '字幕来源尚未完成探测；当前只能使用元数据/简介 fallback，不能做完整视频总结。';
  }

  if (context.subtitleProbe?.message) {
    return `${context.subtitleProbe.message} 因此这不是完整视频总结，也不会声称理解了完整视频正文。`;
  }

  return '没有可用字幕，因此这不是完整视频总结，也不会声称理解了完整视频正文。';
}

function buildNextQuestions(tier: CurrentVideoSummarySourceTier): string[] {
  return tier === 'description_summary'
    ? ['只看简介重点', '查找相关收藏']
    : ['刷新当前视频元数据', '查找相关收藏'];
}

function noContextSummary(reason: string): string {
  if (reason === 'non_video_page') return '当前标签页不是 B 站视频页。';
  if (reason === 'video_context_unavailable') return '当前 B 站视频上下文暂时不可用。';
  return '没有可用的当前视频上下文。';
}

function descriptionLead(text: string | null): string {
  const normalized = normalizeText(text);
  if (!normalized) return '简介里的可见文本';
  const sentence = normalized.split(/(?<=[.!?。！？])\s+/u)[0] ?? normalized;
  return limitText(sentence, 180);
}

function localAiNote(status?: CurrentVideoSummaryAiStatus): string {
  switch (status) {
    case 'disabled':
      return 'AI 摘要未启用，因此当前显示本地证据结果。';
    case 'not_configured':
      return 'AI 摘要已启用但没有配置 API Key，因此当前显示本地证据结果。';
    case 'failed':
      return 'AI 生成失败，当前显示本地证据结果。';
    case 'low_confidence':
      return 'AI 返回的置信度较低，当前显示本地证据结果。';
    default:
      return '本地证据结果；本次没有请求 AI。';
  }
}

function limitNullableText(value: string | null, maxLength: number): string | null {
  return value ? limitText(value, maxLength) : null;
}

function limitText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
