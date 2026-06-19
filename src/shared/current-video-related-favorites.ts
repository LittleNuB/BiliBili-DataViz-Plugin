import type { CurrentVideoContext, CurrentVideoContextResult } from './types/current-video-context';
import type {
  CurrentVideoRelatedFavoritesHint,
  CurrentVideoRelatedFavoritesResponse,
} from './types/current-video-related-favorites';

const MAX_QUESTION_HINT_LENGTH = 140;
const MAX_TITLE_HINT_LENGTH = 140;
const MAX_AUTHOR_HINT_LENGTH = 80;
const MAX_PART_HINT_LENGTH = 100;
const MAX_SUMMARY_HINT_LENGTH = 180;
const MAX_QUERY_LENGTH = 520;

export interface BuildCurrentVideoRelatedFavoritesHintOptions {
  question?: string | null;
  summaryHint?: string | null;
}

export function buildCurrentVideoRelatedFavoritesHint(
  context: CurrentVideoContext,
  options: BuildCurrentVideoRelatedFavoritesHintOptions = {},
): CurrentVideoRelatedFavoritesHint {
  const title = cleanText(context.title, MAX_TITLE_HINT_LENGTH);
  const author = cleanText(context.authorName, MAX_AUTHOR_HINT_LENGTH);
  const partTitle = context.currentPart.title && normalizeComparable(context.currentPart.title) !== normalizeComparable(context.title)
    ? cleanText(context.currentPart.title, MAX_PART_HINT_LENGTH)
    : '';
  const summary = cleanText(options.summaryHint || context.description.text, MAX_SUMMARY_HINT_LENGTH);
  const question = cleanText(options.question, MAX_QUESTION_HINT_LENGTH);

  const parts = uniqueHintParts([
    { label: '你的问题', value: question },
    { label: '当前视频标题', value: title },
    { label: 'UP 名称', value: author },
    { label: '当前分 P 标题', value: partTitle },
    { label: '简介摘要', value: summary },
  ]);

  return {
    query: cleanText(parts.map(part => part.value).join(' '), MAX_QUERY_LENGTH),
    sourceLabels: parts.map(part => part.label),
    limitations: [
      '相关收藏只来自当前已同步收藏，作为延伸阅读，不作为当前视频回答依据。',
      '检索线索只使用当前视频可见元数据、简介摘要和你的问题，不读取历史、关注或本地敏感文件。',
    ],
  };
}

export function emptyCurrentVideoRelatedFavoritesResponse(
  context: CurrentVideoContextResult,
  now = Date.now(),
): CurrentVideoRelatedFavoritesResponse {
  const title = context.kind === 'video' ? context.title : null;
  return {
    status: context.kind === 'video' ? 'no_hint' : 'no_context',
    contextTitle: title,
    query: '',
    hintSourceLabels: [],
    favorites: null,
    generatedAt: now,
    limitations: context.kind === 'video'
      ? ['当前视频缺少可用于检索收藏的标题、UP、简介或问题线索。']
      : ['请在 B 站视频页内使用相关收藏。'],
  };
}

interface HintPart {
  label: string;
  value: string;
}

function uniqueHintParts(parts: HintPart[]): HintPart[] {
  const seen = new Set<string>();
  const result: HintPart[] = [];
  for (const part of parts) {
    const comparable = normalizeComparable(part.value);
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    result.push(part);
  }
  return result;
}

function cleanText(value: string | null | undefined, maxLength: number): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeComparable(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, '').toLocaleLowerCase();
}
