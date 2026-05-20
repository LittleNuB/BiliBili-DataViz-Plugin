import type {
  FavoriteItem,
  SmartFavoriteIndex,
  SmartFavoriteOverview,
  SmartFavoriteResult,
  SmartFavoriteSearchResponse,
  SmartFavoriteTreeNode,
  SmartIndexResult,
} from '../../shared/types/favorite';
import { loadConfig } from '../storage/config-store';
import {
  countIndexedFavorites,
  getFavoriteFolders,
  getFavoriteItems,
  getSmartFavoriteIndexMap,
  putSmartFavoriteIndex,
} from '../storage/favorite-repo';
import { chatJson } from '../ai/openai-compatible';

interface AiFavoriteIndexResponse {
  path?: unknown;
  summary?: unknown;
  keywords?: unknown;
  aliases?: unknown;
}

interface AiQueryRewriteResponse {
  terms?: unknown;
}

const DEFAULT_INDEX_LIMIT = 200;

export async function buildSmartFavoriteIndex(maxItems = DEFAULT_INDEX_LIMIT): Promise<SmartIndexResult> {
  const config = await loadConfig();
  const items = await getFavoriteItems();
  const indexes = await getSmartFavoriteIndexMap();
  const result: SmartIndexResult = { processed: 0, indexed: 0, failed: 0, skipped: 0 };

  for (const item of items) {
    if (result.processed >= maxItems) break;

    const contentHash = hashText(buildFavoriteDocument(item));
    const current = indexes.get(item.itemKey);
    if (current?.contentHash === contentHash && current.status === 'indexed') {
      result.skipped++;
      continue;
    }

    result.processed++;
    try {
      const ai = await createSmartIndex(item, config.ai);
      await putSmartFavoriteIndex({
        itemKey: item.itemKey,
        path: normalizePath(ai.path, item),
        summary: normalizeText(ai.summary, item.intro || item.title),
        keywords: normalizeTextArray(ai.keywords).slice(0, 12),
        aliases: normalizeTextArray(ai.aliases).slice(0, 8),
        searchableText: buildSearchableText(item, ai),
        contentHash,
        model: config.ai.chatModel,
        status: 'indexed',
        indexedAt: Date.now(),
      });
      result.indexed++;
    } catch (error) {
      await putSmartFavoriteIndex({
        itemKey: item.itemKey,
        path: ['未分类'],
        summary: item.intro || item.title,
        keywords: [],
        aliases: [],
        searchableText: buildSearchableText(item),
        contentHash,
        model: config.ai.chatModel,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        indexedAt: Date.now(),
      });
      result.failed++;
    }
  }

  return result;
}

export async function getSmartFavoriteOverview(): Promise<SmartFavoriteOverview> {
  const [folders, items, indexedItems, indexMap] = await Promise.all([
    getFavoriteFolders(),
    getFavoriteItems(),
    countIndexedFavorites(),
    getSmartFavoriteIndexMap(),
  ]);
  const failedItems = Array.from(indexMap.values()).filter(index => index.status === 'failed').length;
  const pendingItems = Math.max(0, items.length - indexedItems - failedItems);

  return {
    folders,
    totalItems: items.length,
    indexedItems,
    failedItems,
    pendingItems,
    lastSyncedAt: Math.max(0, ...folders.map(folder => folder.syncedAt), ...items.map(item => item.syncedAt)),
    tree: buildTree(items, indexMap),
  };
}

export async function searchSmartFavorites(query: string, limit = 30): Promise<SmartFavoriteSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { query, rewrittenTerms: [], results: [] };

  const config = await loadConfig();
  const [items, indexMap] = await Promise.all([getFavoriteItems(), getSmartFavoriteIndexMap()]);
  const rewrittenTerms = await rewriteQuery(trimmed, config.ai.apiKey ? config.ai : null);
  const terms = uniqueTerms([trimmed, ...rewrittenTerms]);

  const results = items
    .map(item => scoreItem(item, indexMap.get(item.itemKey), terms, trimmed))
    .filter((result): result is SmartFavoriteResult => result !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { query: trimmed, rewrittenTerms, results };
}

export async function getSmartFavoritesByPath(path: string[], limit = 200): Promise<SmartFavoriteResult[]> {
  const normalizedPath = path.map(part => part.trim()).filter(Boolean);
  if (normalizedPath.length === 0) return [];

  const [items, indexMap] = await Promise.all([getFavoriteItems(), getSmartFavoriteIndexMap()]);
  return items
    .map(item => {
      const smart = indexMap.get(item.itemKey);
      const itemPath = smart?.path?.length ? smart.path : ['未分类'];
      if (!isPathPrefix(normalizedPath, itemPath)) return null;

      return {
        item,
        ...(smart ? { smart } : {}),
        score: 0,
        reasons: ['分类路径匹配'],
      } satisfies SmartFavoriteResult;
    })
    .filter((result): result is SmartFavoriteResult => result !== null)
    .sort((a, b) => b.item.favTime - a.item.favTime)
    .slice(0, limit);
}

async function createSmartIndex(item: FavoriteItem, config: Awaited<ReturnType<typeof loadConfig>>['ai']): Promise<AiFavoriteIndexResponse> {
  return chatJson<AiFavoriteIndexResponse>(config, [
    {
      role: 'system',
      content: [
        '你是一个 B站收藏夹整理助手。请只输出 JSON。',
        '根据视频元数据生成语义索引，分类路径最多 4 层，颗粒度从高到低。',
        'JSON 字段：path: string[]，summary: string，keywords: string[]，aliases: string[]。',
        'path 示例：["历史","二战","苏德战争","库尔斯克"]。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: buildFavoriteDocument(item),
    },
  ]);
}

async function rewriteQuery(
  query: string,
  config: Awaited<ReturnType<typeof loadConfig>>['ai'] | null,
): Promise<string[]> {
  if (!config) return fallbackTerms(query);
  try {
    const response = await chatJson<AiQueryRewriteResponse>(config, [
      {
        role: 'system',
        content: '你是收藏夹搜索助手。请只输出 JSON：{"terms":["关键词1","同义词或相关概念"]}，最多 8 个词。',
      },
      {
        role: 'user',
        content: `用户想找收藏过的视频，但只记得模糊描述：${query}`,
      },
    ]);
    return normalizeTextArray(response.terms).slice(0, 8);
  } catch {
    return fallbackTerms(query);
  }
}

function scoreItem(
  item: FavoriteItem,
  smart: SmartFavoriteIndex | undefined,
  terms: string[],
  rawQuery: string,
): SmartFavoriteResult | null {
  const title = normalizeForSearch(item.title);
  const author = normalizeForSearch(item.authorName);
  const folder = normalizeForSearch(item.folderTitle);
  const path = normalizeForSearch((smart?.path ?? []).join(' '));
  const keywords = normalizeForSearch([...(smart?.keywords ?? []), ...(smart?.aliases ?? [])].join(' '));
  const summary = normalizeForSearch(smart?.summary ?? '');
  const all = normalizeForSearch([
    item.title,
    item.intro,
    item.authorName,
    item.folderTitle,
    item.tagName,
    ...(item.tags ?? []),
    ...(smart?.path ?? []),
    smart?.summary ?? '',
    ...(smart?.keywords ?? []),
    ...(smart?.aliases ?? []),
  ].join(' '));

  let score = 0;
  const reasons = new Set<string>();
  const normalizedRaw = normalizeForSearch(rawQuery);

  if (normalizedRaw && title.includes(normalizedRaw)) {
    score += 40;
    reasons.add('标题精确命中');
  }

  for (const term of terms.map(normalizeForSearch).filter(Boolean)) {
    if (title.includes(term)) {
      score += 28;
      reasons.add('标题相关');
    }
    if (author.includes(term)) {
      score += 18;
      reasons.add('UP主相关');
    }
    if (path.includes(term)) {
      score += 16;
      reasons.add('分类路径相关');
    }
    if (keywords.includes(term)) {
      score += 14;
      reasons.add('AI关键词相关');
    }
    if (summary.includes(term)) {
      score += 10;
      reasons.add('AI摘要相关');
    }
    if (folder.includes(term)) {
      score += 8;
      reasons.add('原收藏夹相关');
    }
    if (all.includes(term)) {
      score += 4;
      reasons.add('元数据相关');
    }
  }

  if (score <= 0) return null;
  return {
    item,
    smart,
    score,
    reasons: Array.from(reasons).slice(0, 3),
  };
}

function buildTree(items: FavoriteItem[], indexMap: Map<string, SmartFavoriteIndex>): SmartFavoriteTreeNode[] {
  const roots: SmartFavoriteTreeNode[] = [];

  for (const item of items) {
    const path = indexMap.get(item.itemKey)?.path?.length ? indexMap.get(item.itemKey)!.path : ['未分类'];
    let current = roots;
    const walked: string[] = [];
    for (const name of path.slice(0, 4)) {
      walked.push(name);
      let node = current.find(child => child.name === name);
      if (!node) {
        node = { name, path: [...walked], count: 0, children: [] };
        current.push(node);
      }
      node.count++;
      current = node.children;
    }
  }

  sortTree(roots);
  return roots;
}

function sortTree(nodes: SmartFavoriteTreeNode[]): void {
  nodes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  for (const node of nodes) sortTree(node.children);
}

function buildFavoriteDocument(item: FavoriteItem): string {
  return [
    `标题：${item.title}`,
    `简介：${item.intro || '无'}`,
    `UP主：${item.authorName || '未知'}`,
    `原收藏夹：${item.folderTitle}`,
    `分区：${item.tagName || '未知'}`,
    `标签：${(item.tags ?? []).join('、') || '无'}`,
  ].join('\n');
}

function buildSearchableText(item: FavoriteItem, ai?: AiFavoriteIndexResponse): string {
  return [
    buildFavoriteDocument(item),
    normalizePath(ai?.path, item).join(' '),
    normalizeText(ai?.summary, ''),
    normalizeTextArray(ai?.keywords).join(' '),
    normalizeTextArray(ai?.aliases).join(' '),
  ].join('\n');
}

function normalizePath(value: unknown, item: FavoriteItem): string[] {
  const arr = normalizeTextArray(value).slice(0, 4);
  if (arr.length > 0) return arr;
  if (item.tagName) return [item.tagName];
  if (item.folderTitle) return [item.folderTitle];
  return ['未分类'];
}

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function fallbackTerms(query: string): string[] {
  return query.split(/[\s,，。！？、/\\|]+/).map(term => term.trim()).filter(Boolean).slice(0, 8);
}

function uniqueTerms(terms: string[]): string[] {
  return Array.from(new Set(terms.flatMap(term => fallbackTerms(term)).filter(term => term.length > 0))).slice(0, 16);
}

function normalizeForSearch(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

function isPathPrefix(prefix: string[], path: string[]): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((part, index) => part === path[index]);
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
