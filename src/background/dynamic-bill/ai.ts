import type {
  DynamicBillColumn,
  DynamicBillExplanation,
  DynamicBillExplanationResult,
  DynamicBillExplanationRunStatus,
  DynamicBillExplanationStatus,
  DynamicBillItem,
} from '../../shared/types/dynamic-bill';
import type { AiConfig } from '../../shared/types/config';
import { chatJson } from '../ai/openai-compatible';
import { loadConfig } from '../storage/config-store';
import { db } from '../storage/db';
import {
  getDynamicBillItems,
  putDynamicBillExplanation,
} from '../storage/dynamic-bill-repo';

interface BuildDynamicBillExplanationOptions {
  maxItems?: number;
  includeFailed?: boolean;
}

interface AiExplanationResponse {
  summary?: unknown;
  reason?: unknown;
  viewingAngle?: unknown;
  keywords?: unknown;
  confidence?: unknown;
}

interface DynamicBillExplanationPayload {
  column: string;
  video: {
    title: string;
    intro: string;
    authorName: string;
    tagName: string;
    tags: string[];
    durationSeconds: number;
    publishedAt: string;
  };
  localEvidence: {
    facts: string[];
    longWindow: {
      days: number;
      watchedCount: number;
      positiveWatchCount: number;
      avgCompletion: number;
    };
    recentWindow: {
      days: number;
      watchedCount: number;
      positiveWatchCount: number;
      avgCompletion: number;
    };
    follow: {
      known: boolean;
      ageDays?: number;
      special?: boolean;
    };
    interest?: {
      kind: string;
      label: string;
      longPositiveShare: number;
      recentPositiveShare: number;
      positiveDropRatio: number;
    };
  };
}

const DEFAULT_EXPLANATION_BATCH_SIZE = 6;
const MAX_EXPLANATION_BATCH_SIZE = 12;
const MAX_FACTS_IN_PROMPT = 7;
const AI_FACT_EXCLUDED_TERMS = [
  '少提醒',
  '反馈',
  '完整历史',
  '完整关注列表',
  '关注列表',
  'Cookie',
  '用户 mid',
  '个人资料',
  '反馈记录',
];

export async function buildDynamicBillExplanations(
  options: BuildDynamicBillExplanationOptions = {},
): Promise<DynamicBillExplanationResult> {
  const config = await loadConfig();
  const items = await getDynamicBillItems();
  const maxItems = Math.max(
    1,
    Math.min(
      Math.floor(options.maxItems ?? DEFAULT_EXPLANATION_BATCH_SIZE),
      MAX_EXPLANATION_BATCH_SIZE,
    ),
  );
  const includeFailed = options.includeFailed !== false;

  if (items.length === 0) {
    return emptyResult('idle', items);
  }

  if (!config.dynamicBill.aiExplanationsEnabled) {
    const fallback = await writeFallbackExplanations(
      items,
      'disabled',
      config.ai.chatModel,
      'DYNAMIC_BILL_AI_DISABLED',
    );
    return {
      status: 'disabled',
      processed: fallback,
      generated: 0,
      failed: 0,
      skipped: 0,
      fallback,
      pending: 0,
      items: await getDynamicBillItems(),
    };
  }

  if (!config.ai.apiKey.trim()) {
    const fallback = await writeFallbackExplanations(
      items,
      'not_configured',
      config.ai.chatModel,
      'AI_API_KEY_MISSING',
    );
    return {
      status: 'not_configured',
      processed: fallback,
      generated: 0,
      failed: 0,
      skipped: 0,
      fallback,
      pending: 0,
      items: await getDynamicBillItems(),
    };
  }

  let processed = 0;
  let generated = 0;
  let failed = 0;
  let skipped = 0;
  let processable = 0;

  for (const item of items) {
    const payload = await buildDynamicBillExplanationPayload(item);
    const contentHash = hashText(JSON.stringify(payload));
    if (!shouldProcessItem(item, contentHash, config.ai.chatModel, includeFailed)) {
      skipped++;
      continue;
    }

    processable++;
    if (processed >= maxItems) continue;

    try {
      const ai = await createAiExplanation(payload, config.ai);
      await putDynamicBillExplanation(normalizeAiExplanation(
        item,
        ai,
        config.ai.chatModel,
        contentHash,
      ));
      generated++;
    } catch (error) {
      await putDynamicBillExplanation(buildFallbackExplanation(
        item,
        'failed',
        config.ai.chatModel,
        contentHash,
        errorMessage(error),
      ));
      failed++;
    }
    processed++;
  }

  return {
    status: runStatus(generated, failed, processed),
    processed,
    generated,
    failed,
    skipped,
    fallback: failed,
    pending: Math.max(0, processable - processed),
    items: await getDynamicBillItems(),
  };
}

export async function buildDynamicBillExplanationPayload(
  item: DynamicBillItem,
): Promise<DynamicBillExplanationPayload> {
  const update = await db.followedVideoUpdates
    .where('updateKey')
    .equals(item.updateKey)
    .first();
  const evidence = item.evidence;

  return {
    column: columnTitle(item.column),
    video: {
      title: limitText(evidence.newVideo.title || update?.title || '未命名视频', 120),
      intro: limitText(update?.intro || '', 360),
      authorName: limitText(item.creatorName || update?.authorName || '未知 UP', 80),
      tagName: limitText(evidence.newVideo.tagName || update?.tagName || '未知分区', 40),
      tags: normalizeTextArray(evidence.newVideo.tags.length ? evidence.newVideo.tags : update?.tags).slice(0, 8),
      durationSeconds: Math.max(0, Math.floor(evidence.newVideo.duration || update?.duration || 0)),
      publishedAt: evidence.newVideo.pubtime > 0
        ? new Date(evidence.newVideo.pubtime * 1000).toISOString()
        : '',
    },
    localEvidence: {
      facts: compactFacts(evidence.facts),
      longWindow: {
        days: evidence.longWindow.windowDays,
        watchedCount: evidence.longWindow.watchedCount,
        positiveWatchCount: evidence.longWindow.positiveWatchCount,
        avgCompletion: roundRatio(evidence.longWindow.avgCompletion),
      },
      recentWindow: {
        days: evidence.recentWindow.windowDays,
        watchedCount: evidence.recentWindow.watchedCount,
        positiveWatchCount: evidence.recentWindow.positiveWatchCount,
        avgCompletion: roundRatio(evidence.recentWindow.avgCompletion),
      },
      follow: {
        known: evidence.follow.followAgeKnown,
        ageDays: evidence.follow.followAgeDays,
        special: evidence.follow.special,
      },
      ...(evidence.interest ? {
        interest: {
          kind: evidence.interest.kind === 'category' ? '分区' : '标签',
          label: evidence.interest.label,
          longPositiveShare: evidence.interest.longPositiveShare,
          recentPositiveShare: evidence.interest.recentPositiveShare,
          positiveDropRatio: evidence.interest.positiveDropRatio,
        },
      } : {}),
    },
  };
}

async function createAiExplanation(
  payload: DynamicBillExplanationPayload,
  config: AiConfig,
): Promise<AiExplanationResponse> {
  return chatJson<AiExplanationResponse>(config, [
    {
      role: 'system',
      content: [
        '你是 Bili-Bill 动态账单解释助手。请只输出 JSON。',
        '本地规则已经决定账单项入选和排序；你只生成摘要与解释，不得新增或改写入选规则。',
        'reason 必须服从 localEvidence.facts，不要与本地事实冲突，不要声称用户一定喜欢或必须观看。',
        'confidence 只表示你对摘要/解释质量的自评，范围 0 到 1。',
        'JSON 字段：summary: string，reason: string，viewingAngle: string，keywords: string[]，confidence: number。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ]);
}

function shouldProcessItem(
  item: DynamicBillItem,
  contentHash: string,
  model: string,
  includeFailed: boolean,
): boolean {
  const explanation = item.explanation;
  if (!explanation) return true;

  const sameContent = explanation.contentHash === contentHash;
  const sameModel = explanation.model === model;
  if (explanation.status === 'generated' && sameContent && sameModel) return false;
  if (explanation.status === 'failed' && sameContent && sameModel && !includeFailed) return false;

  return true;
}

async function writeFallbackExplanations(
  items: DynamicBillItem[],
  status: Extract<DynamicBillExplanationStatus, 'disabled' | 'not_configured'>,
  model: string,
  error: string,
): Promise<number> {
  let written = 0;
  for (const item of items) {
    const payload = await buildDynamicBillExplanationPayload(item);
    const contentHash = hashText(JSON.stringify(payload));
    const explanation = item.explanation;
    if (
      explanation?.status === status
      && explanation.contentHash === contentHash
      && explanation.model === model
    ) {
      continue;
    }
    await putDynamicBillExplanation(buildFallbackExplanation(
      item,
      status,
      model,
      contentHash,
      error,
    ));
    written++;
  }
  return written;
}

function normalizeAiExplanation(
  item: DynamicBillItem,
  ai: AiExplanationResponse,
  model: string,
  contentHash: string,
): DynamicBillExplanation {
  return {
    billKey: item.billKey,
    status: 'generated',
    summary: normalizeText(ai.summary, fallbackSummary(item), 120),
    reason: normalizeText(ai.reason, fallbackReason(item), 220),
    viewingAngle: normalizeText(ai.viewingAngle, fallbackViewingAngle(item), 160),
    keywords: normalizeTextArray(ai.keywords).slice(0, 8),
    confidence: normalizeConfidence(ai.confidence),
    model,
    generatedAt: Date.now(),
    contentHash,
  };
}

function buildFallbackExplanation(
  item: DynamicBillItem,
  status: DynamicBillExplanationStatus,
  model: string,
  contentHash: string,
  error: string,
): DynamicBillExplanation {
  return {
    billKey: item.billKey,
    status,
    summary: fallbackSummary(item),
    reason: fallbackReason(item),
    viewingAngle: fallbackViewingAngle(item),
    keywords: fallbackKeywords(item),
    confidence: 0,
    model,
    generatedAt: Date.now(),
    contentHash,
    error,
  };
}

function fallbackSummary(item: DynamicBillItem): string {
  return `来自已关注 UP「${item.creatorName}」的新投稿《${item.evidence.newVideo.title || item.evidence.newVideo.bvid}》。`;
}

function fallbackReason(item: DynamicBillItem): string {
  const facts = compactFacts(item.evidence.facts).slice(0, 2).join(' ');
  return `这个视频出现是因为它已经被「${columnTitle(item.column)}」本地规则入选：${facts || cardReason(item)}。`;
}

function fallbackViewingAngle(item: DynamicBillItem): string {
  if (item.column === 'favorite_related') {
    return '把它当作一次从本地收藏关系出发的回访，看看这个 UP 的新投稿是否仍值得关注。';
  }
  if (item.column === 'buried_follow') {
    return '把它当作一次低压力回访，判断这个关注是否仍值得保留注意力。';
  }
  return '把它当作一次关注轮换，先看一个较少出现在账单里的已关注 UP。';
}

function fallbackKeywords(item: DynamicBillItem): string[] {
  return Array.from(new Set([
    columnTitle(item.column),
    item.evidence.newVideo.tagName,
    ...(item.evidence.interest ? [item.evidence.interest.label] : []),
    ...item.evidence.newVideo.tags,
  ].map(keyword => keyword.trim()).filter(Boolean))).slice(0, 8);
}

function cardReason(item: DynamicBillItem): string {
  if (item.column === 'favorite_related') {
    return '本地已同步收藏中有这个 UP 的既有作品，且最近有新投稿。';
  }
  if (item.column === 'buried_follow') {
    return '关注关系仍在，本地近期观看缺席或近乎缺席，且最近有新投稿。';
  }
  return '这条来自剩余已关注 UP 的最近新投稿，按全局轮换扩大创作者覆盖。';
}

function compactFacts(facts: string[]): string[] {
  return facts
    .filter(fact => !AI_FACT_EXCLUDED_TERMS.some(term => fact.includes(term)))
    .map(fact => limitText(fact, 180))
    .slice(0, MAX_FACTS_IN_PROMPT);
}

function columnTitle(column: DynamicBillColumn): string {
  switch (column) {
    case 'buried_follow':
      return '被淹没的关注';
    case 'favorite_related':
      return '收藏关联更新';
    case 'follow_rotation':
      return '关注轮换';
    default:
      return column;
  }
}

function runStatus(
  generated: number,
  failed: number,
  processed: number,
): DynamicBillExplanationRunStatus {
  if (generated > 0 && failed === 0) return 'generated';
  if (failed > 0 && generated === 0) return 'failed';
  if (generated > 0) return 'generated';
  return processed > 0 ? 'failed' : 'idle';
}

function emptyResult(
  status: DynamicBillExplanationRunStatus,
  items: DynamicBillItem[],
): DynamicBillExplanationResult {
  return {
    status,
    processed: 0,
    generated: 0,
    failed: 0,
    skipped: 0,
    fallback: 0,
    pending: 0,
    items,
  };
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  return limitText(typeof value === 'string' && value.trim() ? value.trim() : fallback, maxLength);
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => typeof item === 'string' ? limitText(item.trim(), 24) : '')
    .filter(Boolean);
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return roundRatio(Math.max(0, Math.min(1, numeric)));
}

function limitText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
