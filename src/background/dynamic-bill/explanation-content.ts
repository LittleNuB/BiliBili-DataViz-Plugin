import type {
  DynamicBillColumn,
  DynamicBillItem,
  FollowedVideoUpdate,
} from '../../shared/types/dynamic-bill';

export interface DynamicBillExplanationPayload {
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

export interface DynamicBillExplanationContent {
  payload: DynamicBillExplanationPayload;
  contentHash: string;
}

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
const ROTATION_LEDGER_FACT_MARKERS = [
  '全局轮换记录',
  '上次进入动态账单',
  '上次展示',
  '展示过',
  '尚未展示',
  '最久未展示',
];

export function buildDynamicBillExplanationContent(
  item: DynamicBillItem,
  update?: FollowedVideoUpdate,
): DynamicBillExplanationContent {
  const evidence = item.evidence;
  const payload: DynamicBillExplanationPayload = {
    column: columnTitle(item.column),
    video: {
      title: limitText(evidence.newVideo.title || update?.title || '未命名视频', 120),
      intro: limitText(update?.intro || '', 360),
      authorName: limitText(item.creatorName || update?.authorName || '未知 UP', 80),
      tagName: limitText(evidence.newVideo.tagName || update?.tagName || '未知分区', 40),
      tags: normalizeTextArray(
        evidence.newVideo.tags.length ? evidence.newVideo.tags : update?.tags,
      ).slice(0, 8),
      durationSeconds: Math.max(
        0,
        Math.floor(evidence.newVideo.duration || update?.duration || 0),
      ),
      publishedAt: evidence.newVideo.pubtime > 0
        ? new Date(evidence.newVideo.pubtime * 1000).toISOString()
        : '',
    },
    localEvidence: {
      facts: compactDynamicBillFactsForAi(evidence.facts),
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

  return {
    payload,
    contentHash: hashText(JSON.stringify(payload)),
  };
}

export function compactDynamicBillFactsForAi(facts: string[]): string[] {
  return facts
    .filter(isDynamicBillFactAllowedForAi)
    .map(fact => limitText(fact, 180))
    .slice(0, MAX_FACTS_IN_PROMPT);
}

function isDynamicBillFactAllowedForAi(fact: string): boolean {
  if (AI_FACT_EXCLUDED_TERMS.some(term => fact.includes(term))) return false;
  return !ROTATION_LEDGER_FACT_MARKERS.some(marker => fact.includes(marker));
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

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => typeof item === 'string' ? limitText(item.trim(), 24) : '')
    .filter(Boolean);
}

function limitText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
