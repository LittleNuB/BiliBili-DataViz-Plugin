import type {
  FavoriteItem,
  SmartFavoriteIndex,
  SmartFavoriteOverview,
  SmartFavoriteResult,
  SmartFavoriteSearchResponse,
  SmartFavoriteTreeNode,
  SmartIndexResult,
} from '../../shared/types/favorite';
import { normalizeFavoriteFoldersWithDiagnostics } from '../../shared/favorite-sync-diagnostics.ts';
import { summarizeSmartFavoriteIndexCoverage } from '../../shared/smart-favorite-coverage.ts';
import { loadConfig } from '../storage/config-store.ts';
import {
  getFavoriteFolders,
  getFavoriteItems,
  getSmartFavoriteIndexMap,
  putSmartFavoriteIndex,
} from '../storage/favorite-repo.ts';
import { chatJson } from '../ai/openai-compatible.ts';
import {
  buildTaxonomyPromptSummary,
  classifyFavoritePath,
  expandFavoriteSearchTerms,
  UNCATEGORIZED_PATH,
} from './taxonomy.ts';

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
const SMART_FAVORITE_INDEX_VERSION = 'smart-favorites-category-v2';

type SmartAiConfig = Awaited<ReturnType<typeof loadConfig>>['ai'];

interface SmartFavoriteIndexDeps {
  createSmartIndex: (item: FavoriteItem, config: SmartAiConfig) => Promise<AiFavoriteIndexResponse>;
  getFavoriteItems: typeof getFavoriteItems;
  getSmartFavoriteIndexMap: typeof getSmartFavoriteIndexMap;
  loadConfig: typeof loadConfig;
  putSmartFavoriteIndex: typeof putSmartFavoriteIndex;
}

const defaultSmartFavoriteIndexDeps: SmartFavoriteIndexDeps = {
  createSmartIndex,
  getFavoriteItems,
  getSmartFavoriteIndexMap,
  loadConfig,
  putSmartFavoriteIndex,
};

export interface SmartFavoriteIndexOptions {
  includeFailed?: boolean;
  failedOnly?: boolean;
}

export async function buildSmartFavoriteIndex(
  maxItems = DEFAULT_INDEX_LIMIT,
  options: SmartFavoriteIndexOptions = {},
  deps: SmartFavoriteIndexDeps = defaultSmartFavoriteIndexDeps,
): Promise<SmartIndexResult> {
  const config = await deps.loadConfig();
  const items = await deps.getFavoriteItems();
  const indexes = await deps.getSmartFavoriteIndexMap();
  const result: SmartIndexResult = { processed: 0, indexed: 0, failed: 0, skipped: 0, notes: [] };
  const candidates = items
    .map(item => {
      const contentHash = hashText(buildFavoriteIndexFingerprint(item));
      const current = indexes.get(item.itemKey);
      return { item, contentHash, current };
    })
    .filter(candidate => shouldProcessCandidate(candidate.current, candidate.contentHash, config.ai.chatModel, options))
    .sort((a, b) => {
      if (options.failedOnly) {
        return (a.current?.indexedAt ?? 0) - (b.current?.indexedAt ?? 0);
      }
      return b.item.favTime - a.item.favTime;
    });

  for (const { item, contentHash } of candidates) {
    if (result.processed >= maxItems) break;

    result.processed++;
    try {
      const ai = await deps.createSmartIndex(item, config.ai);
      const classification = classifyFavoritePath(item, ai);
      const write = await deps.putSmartFavoriteIndex({
        itemKey: item.itemKey,
        path: classification.path,
        summary: normalizeText(ai.summary, item.intro || item.title),
        keywords: normalizeTextArray(ai.keywords).slice(0, 12),
        aliases: normalizeTextArray(ai.aliases).slice(0, 8),
        categoryEvidence: classification.evidence,
        searchableText: buildSearchableText(item, ai, classification.path),
        contentHash,
        model: config.ai.chatModel,
        status: 'indexed',
        indexedAt: Date.now(),
      });
      mergeNotes(result.notes, write.notes);
      if (write.written > 0) {
        result.indexed++;
      } else {
        result.skipped++;
      }
    } catch (error) {
      const write = await deps.putSmartFavoriteIndex({
        itemKey: item.itemKey,
        path: UNCATEGORIZED_PATH,
        summary: item.intro || item.title,
        keywords: [],
        aliases: [],
        categoryEvidence: {
          kind: 'path_fallback',
          summary: '路径兜底：智能索引失败，暂列未分类。',
          directTerms: [],
          weakTerms: [],
          downgraded: true,
        },
        searchableText: buildSearchableText(item, undefined, UNCATEGORIZED_PATH),
        contentHash,
        model: config.ai.chatModel,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        indexedAt: Date.now(),
      });
      mergeNotes(result.notes, write.notes);
      if (write.written > 0) {
        result.failed++;
      } else {
        result.skipped++;
      }
    }
  }

  return result;
}

function shouldProcessCandidate(
  current: SmartFavoriteIndex | undefined,
  contentHash: string,
  model: string,
  options: SmartFavoriteIndexOptions,
): boolean {
  if (!current) return !options.failedOnly;
  const sameContent = current.contentHash === contentHash;
  const sameModel = current.model === model;

  if (current.status === 'indexed' && sameContent && sameModel) return false;
  if (options.failedOnly) return current.status === 'failed' && sameContent;
  if (current.status === 'failed' && sameContent && !options.includeFailed) return false;

  return true;
}

export async function getSmartFavoriteOverview(): Promise<SmartFavoriteOverview> {
  const [storedFolders, items, indexMap] = await Promise.all([
    getFavoriteFolders(),
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
  ]);
  const folders = normalizeFavoriteFoldersWithDiagnostics(storedFolders);
  const coverage = summarizeSmartFavoriteIndexCoverage(folders, items, indexMap);
  const diagnostics = folders
    .map(folder => folder.lastSyncDiagnostic)
    .filter(diagnostic => diagnostic !== undefined);

  return {
    folders,
    reportedItems: coverage.bilibiliReportedItems,
    storedItems: coverage.storedItems,
    totalItems: items.length,
    indexedItems: coverage.indexedItems,
    failedItems: coverage.failedItems,
    pendingItems: coverage.pendingItems,
    incompleteFolders: diagnostics.filter(diagnostic => diagnostic.completenessState === 'incomplete').length,
    syncComplete: diagnostics.length > 0 && diagnostics.every(diagnostic => diagnostic.completenessState === 'complete'),
    lastSyncedAt: Math.max(0, ...folders.map(folder => folder.syncedAt), ...items.map(item => item.syncedAt)),
    lastSyncDiagnostics: diagnostics,
    tree: buildTree(items, indexMap),
  };
}

export async function searchSmartFavorites(query: string, limit = 30): Promise<SmartFavoriteSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { query, rewrittenTerms: [], results: [] };

  const config = await loadConfig();
  const [items, indexMap] = await Promise.all([getFavoriteItems(), getSmartFavoriteIndexMap()]);
  const rewrittenTerms = await rewriteQuery(trimmed, config.ai.apiKey ? config.ai : null);
  const terms = expandFavoriteSearchTerms(uniqueTerms([trimmed, ...rewrittenTerms]));

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
      const itemPath = smart?.path?.length ? smart.path : UNCATEGORIZED_PATH;
      if (!isPathPrefix(normalizedPath, itemPath)) return null;

      return {
        item,
        ...(smart ? { smart } : {}),
        score: 0,
        reasons: ['分类浏览'],
      } satisfies SmartFavoriteResult;
    })
    .filter((result): result is SmartFavoriteResult => result !== null)
    .sort((a, b) => b.item.favTime - a.item.favTime)
    .slice(0, limit);
}

async function createSmartIndex(item: FavoriteItem, config: SmartAiConfig): Promise<AiFavoriteIndexResponse> {
  return chatJson<AiFavoriteIndexResponse>(config, [
    {
      role: 'system',
      content: [
        '你是一个 B站收藏夹整理助手。请只输出 JSON。',
        '优先依据标题、简介、B站分区、标签和可见文本；原收藏夹名只能作为弱提示。',
        '只有在标题、简介、标签、AI摘要或关键词出现直接证据时，才输出具体子类，例如“娱乐 / 游戏”。',
        '如果只能判断到宽泛父类，请返回父类；如果证据不足，请返回 ["待确认"] 或 ["未分类"]，不要强行猜测具体叶子类。',
        '分类路径最多 4 层，颗粒度从高到低；优先使用下面的标准路径，不要随意创造新的一级类目。',
        buildTaxonomyPromptSummary(),
        'JSON 字段：path: string[]，summary: string，keywords: string[]，aliases: string[]。',
        'path 示例：["知识","历史","二战","库尔斯克"]。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: buildFavoriteDocument(item),
    },
  ]);
}

function mergeNotes(target: string[], incoming: string[]): void {
  for (const note of incoming) {
    if (!target.includes(note)) {
      target.push(note);
    }
  }
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
    const path = indexMap.get(item.itemKey)?.path?.length ? indexMap.get(item.itemKey)!.path : UNCATEGORIZED_PATH;
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
    `B站分区：${item.tagName || '未知'}`,
    `B站标签：${(item.tags ?? []).join('、') || '无'}`,
  ].join('\n');
}

function buildFavoriteIndexFingerprint(item: FavoriteItem): string {
  return [SMART_FAVORITE_INDEX_VERSION, buildFavoriteDocument(item)].join('\n');
}

function buildSearchableText(item: FavoriteItem, ai?: AiFavoriteIndexResponse, path = classifyFavoritePath(item, ai).path): string {
  return [
    buildFavoriteDocument(item),
    path.join(' '),
    normalizeText(ai?.summary, ''),
    normalizeTextArray(ai?.keywords).join(' '),
    normalizeTextArray(ai?.aliases).join(' '),
  ].join('\n');
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
