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
  getFavoriteFolders,
  getFavoriteItems,
  getSmartFavoriteIndexMap,
  putSmartFavoriteIndex,
  upsertFavoriteItems,
} from '../storage/favorite-repo';
import { chatJson } from '../ai/openai-compatible';
import { batchFetchVideoTags } from '../api/video-info';
import {
  buildTaxonomyPromptSummary,
  expandFavoriteSearchTerms,
  normalizeFavoritePath,
  resolveBiliRegion,
  resolveFavoriteBasePath,
  SMART_FAVORITE_TAXONOMY_VERSION,
  UNCATEGORIZED_PATH,
} from './taxonomy';

interface AiFavoriteIndexResponse {
  path?: unknown;
  topicTail?: unknown;
  summary?: unknown;
  keywords?: unknown;
  aliases?: unknown;
}

interface AiQueryRewriteResponse {
  terms?: unknown;
}

interface AiEnhancementResult {
  ai?: AiFavoriteIndexResponse;
  status: NonNullable<SmartFavoriteIndex['aiStatus']>;
  error?: string;
}

const DEFAULT_INDEX_LIMIT = 200;
const TAG_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SMART_INDEX_CANCELLED = 'SMART_INDEX_CANCELLED';

let activeSmartIndexController: AbortController | null = null;

export interface SmartFavoriteIndexOptions {
  includeFailed?: boolean;
  failedOnly?: boolean;
}

export function cancelSmartFavoriteIndex(): boolean {
  if (!activeSmartIndexController) return false;
  activeSmartIndexController.abort();
  return true;
}

export async function buildSmartFavoriteIndex(
  maxItems = DEFAULT_INDEX_LIMIT,
  options: SmartFavoriteIndexOptions = {},
): Promise<SmartIndexResult> {
  if (activeSmartIndexController) {
    throw new Error('SMART_FAVORITE_INDEX_IN_PROGRESS');
  }

  const controller = new AbortController();
  activeSmartIndexController = controller;
  try {
    return await buildSmartFavoriteIndexBatch(maxItems, options, controller.signal);
  } finally {
    if (activeSmartIndexController === controller) {
      activeSmartIndexController = null;
    }
  }
}

async function buildSmartFavoriteIndexBatch(
  maxItems: number,
  options: SmartFavoriteIndexOptions,
  signal: AbortSignal,
): Promise<SmartIndexResult> {
  const config = await loadConfig();
  const items = await getFavoriteItems();
  const indexes = await getSmartFavoriteIndexMap();
  const now = Date.now();
  const hasAiConfig = Boolean(config.ai.apiKey.trim());
  const result: SmartIndexResult = { processed: 0, indexed: 0, degraded: 0, failed: 0, skipped: 0 };
  const candidates = items
    .map(item => {
      const contentHash = hashText(`${SMART_FAVORITE_TAXONOMY_VERSION}\n${buildFavoriteDocument(item)}`);
      const current = indexes.get(item.itemKey);
      const needsTagRefresh = shouldRefreshTags(item, now);
      return { item, contentHash, current, needsTagRefresh };
    })
    .filter(candidate => {
      const shouldIndex = shouldProcessCandidate(candidate.current, candidate.contentHash, config.ai.chatModel, options, hasAiConfig);
      return options.failedOnly ? shouldIndex : candidate.needsTagRefresh || shouldIndex;
    })
    .sort((a, b) => {
      if (options.failedOnly) {
        return (a.current?.indexedAt ?? 0) - (b.current?.indexedAt ?? 0);
      }
      return b.item.favTime - a.item.favTime;
    });

  for (const candidate of candidates) {
    if (result.processed >= maxItems) break;
    if (signal.aborted) {
      return stopCancelled(result);
    }

    result.processed++;
    try {
      const item = await enrichTagsForIndexing(candidate.item, signal);
      const contentHash = hashText(`${SMART_FAVORITE_TAXONOMY_VERSION}\n${buildFavoriteDocument(item)}`);
      const sameModel = candidate.current?.model === config.ai.chatModel;
      const sameContent = candidate.current?.contentHash === contentHash;
      if (candidate.needsTagRefresh && sameModel && sameContent && candidate.current?.status === 'indexed') {
        result.skipped++;
        continue;
      }

      const aiResult = await createSmartIndexEnhancement(item, config.ai, signal);
      const ai = aiResult.ai;
      const path = normalizeFavoritePath(ai, item);
      const status: SmartFavoriteIndex['status'] = aiResult.status === 'enhanced' ? 'indexed' : 'degraded';
      await putSmartFavoriteIndex({
        itemKey: item.itemKey,
        path,
        summary: ai ? normalizeText(ai.summary, item.intro || item.title) : item.intro || item.title,
        keywords: ai ? normalizeTextArray(ai.keywords).slice(0, 12) : [],
        aliases: ai ? normalizeTextArray(ai.aliases).slice(0, 8) : [],
        searchableText: buildSearchableText(item, ai, path),
        contentHash,
        model: config.ai.chatModel,
        status,
        taxonomyVersion: SMART_FAVORITE_TAXONOMY_VERSION,
        ...buildPathMetadata(item, path),
        tagsSnapshot: [...(item.tags ?? [])],
        aiTopicTail: normalizeTextArray(ai?.topicTail).slice(0, 2),
        aiStatus: aiResult.status,
        aiError: aiResult.error,
        indexedAt: Date.now(),
      });
      if (status === 'indexed') {
        result.indexed++;
      } else {
        result.degraded = (result.degraded ?? 0) + 1;
      }
    } catch (error) {
      if (isSmartIndexCancelled(error, signal)) {
        return stopCancelled(result);
      }
      const item = candidate.item;
      await putSmartFavoriteIndex({
        itemKey: item.itemKey,
        path: UNCATEGORIZED_PATH,
        summary: item.intro || item.title,
        keywords: [],
        aliases: [],
        searchableText: buildSearchableText(item, undefined, UNCATEGORIZED_PATH),
        contentHash: candidate.contentHash,
        model: config.ai.chatModel,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        taxonomyVersion: SMART_FAVORITE_TAXONOMY_VERSION,
        ...buildPathMetadata(item, UNCATEGORIZED_PATH),
        pathSource: 'uncategorized',
        tagsSnapshot: [...(item.tags ?? [])],
        aiStatus: 'degraded',
        aiError: error instanceof Error ? error.message : String(error),
        indexedAt: Date.now(),
      });
      result.failed++;
    }
  }

  return result;
}

async function enrichTagsForIndexing(item: FavoriteItem, signal: AbortSignal): Promise<FavoriteItem> {
  if (!shouldRefreshTags(item, Date.now())) return item;

  const tagMap = await batchFetchVideoTags([item.bvid], signal);
  const fetchedAt = Date.now();
  if (!tagMap.has(item.bvid)) {
    const updated = {
      ...item,
      tagsFetchFailedAt: fetchedAt,
      tagsFetchError: 'VIDEO_TAGS_FETCH_FAILED',
    };
    await upsertFavoriteItems([updated]);
    return updated;
  }

  const tags = tagMap.get(item.bvid) ?? [];
  const updated = {
    ...item,
    tags,
    tagsFetchedAt: fetchedAt,
    tagsFetchFailedAt: undefined,
    tagsFetchError: undefined,
  };
  await upsertFavoriteItems([updated]);
  return updated;
}

function shouldRefreshTags(item: FavoriteItem, now: number): boolean {
  if ((item.tags ?? []).length > 0 || !item.bvid) return false;
  if (item.tagsFetchedAt) return false;
  if (!item.tagsFetchFailedAt) return true;
  return now - item.tagsFetchFailedAt >= TAG_RETRY_COOLDOWN_MS;
}

function shouldProcessCandidate(
  current: SmartFavoriteIndex | undefined,
  contentHash: string,
  model: string,
  options: SmartFavoriteIndexOptions,
  hasAiConfig: boolean,
): boolean {
  if (!current) return !options.failedOnly;
  const sameContent = current.contentHash === contentHash;
  const sameModel = current.model === model;

  if (current.status === 'indexed' && sameContent && sameModel) return false;
  if (current.status === 'degraded' && sameContent && sameModel && !hasAiConfig) return false;
  if (options.failedOnly) return current.status === 'failed' && sameContent;
  if (current.status === 'failed' && sameContent && !options.includeFailed) return false;

  return true;
}

function stopCancelled(result: SmartIndexResult): SmartIndexResult {
  return {
    ...result,
    cancelled: true,
    stoppedReason: 'cancelled',
  };
}

function isSmartIndexCancelled(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (!(error instanceof Error)) return false;
  return error.message === SMART_INDEX_CANCELLED || error.message === 'SYNC_CANCELLED';
}

function buildPathMetadata(item: FavoriteItem, path: string[]): Pick<SmartFavoriteIndex, 'pathSource' | 'regionSnapshot'> {
  const region = resolveBiliRegion(item);
  const base = resolveFavoriteBasePath(item);
  const pathSource: SmartFavoriteIndex['pathSource'] = isPathPrefix(UNCATEGORIZED_PATH, path)
    ? 'uncategorized'
    : base.source;

  return {
    pathSource,
    regionSnapshot: {
      tid: region.tid,
      tname: region.tname,
      tidV2: region.tidV2,
      tnameV2: region.tnameV2,
      pidV2: region.pidV2,
      pidNameV2: region.pidNameV2,
    },
  };
}

export async function getSmartFavoriteOverview(): Promise<SmartFavoriteOverview> {
  const [folders, items, indexMap] = await Promise.all([
    getFavoriteFolders(),
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
  ]);
  const indexes = Array.from(indexMap.values());
  const indexedItems = indexes.filter(index => index.status === 'indexed').length;
  const degradedItems = indexes.filter(index => index.status === 'degraded').length;
  const failedItems = indexes.filter(index => index.status === 'failed').length;
  const pendingItems = Math.max(0, items.length - indexedItems - degradedItems - failedItems);

  return {
    folders,
    totalItems: items.length,
    uniqueItems: countUniqueFavoriteVideos(items),
    indexedItems,
    degradedItems,
    failedItems,
    pendingItems,
    lastSyncedAt: Math.max(0, ...folders.map(folder => folder.syncedAt), ...items.map(item => item.syncedAt)),
    tree: buildTree(items, indexMap),
  };
}

function countUniqueFavoriteVideos(items: FavoriteItem[]): number {
  return new Set(items.map(getFavoriteVideoKey)).size;
}

function getFavoriteVideoKey(item: FavoriteItem): string {
  if (item.bvid) return `bvid:${item.bvid}`;
  if (item.avid) return `avid:${item.avid}`;
  return item.itemKey;
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
        reasons: ['分类路径匹配'],
      } satisfies SmartFavoriteResult;
    })
    .filter((result): result is SmartFavoriteResult => result !== null)
    .sort((a, b) => b.item.favTime - a.item.favTime)
    .slice(0, limit);
}

async function createSmartIndexEnhancement(
  item: FavoriteItem,
  config: Awaited<ReturnType<typeof loadConfig>>['ai'],
  signal: AbortSignal,
): Promise<AiEnhancementResult> {
  if (!config.apiKey.trim()) {
    return { status: 'skipped', error: 'AI_API_KEY_MISSING' };
  }

  try {
    return {
      ai: await createSmartIndex(item, config, signal),
      status: 'enhanced',
    };
  } catch (error) {
    if (isSmartIndexCancelled(error, signal)) throw error;
    return {
      status: 'degraded',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function createSmartIndex(
  item: FavoriteItem,
  config: Awaited<ReturnType<typeof loadConfig>>['ai'],
  signal: AbortSignal,
): Promise<AiFavoriteIndexResponse> {
  return chatJson<AiFavoriteIndexResponse>(config, [
    {
      role: 'system',
      content: [
        '你是一个 B站收藏夹整理助手。请只输出 JSON。',
        '本地程序会根据 B站分区 ID 决定分类根路径。你不要决定一级或二级分类。',
        '你只需要概括视频内容，并在 topicTail 中给出 0-2 个末级主题词，用于追加到本地分类路径末尾。',
        'topicTail 必须来自标题、简介、标签或非常明确的主题，不要联想无关历史、战争、影视等分类。',
        buildTaxonomyPromptSummary(),
        'JSON 字段：topicTail: string[]，summary: string，keywords: string[]，aliases: string[]。',
        'topicTail 示例：["编程","Codex"]。如果没有明确末级主题，返回空数组。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: buildFavoriteDocument(item),
    },
  ], signal);
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
    item.tname ?? '',
    item.pidNameV2 ?? '',
    item.tnameV2 ?? '',
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
  const region = resolveBiliRegion(item);
  return [
    `标题：${item.title}`,
    `简介：${item.intro || '无'}`,
    `UP主：${item.authorName || '未知'}`,
    `原收藏夹：${item.folderTitle}`,
    `B站新版分区：${region.v2Path.join(' / ') || '未知'}`,
    `B站旧分区：${region.legacyPath.join(' / ') || item.tagName || '未知'}`,
    `B站标签：${(item.tags ?? []).join('、') || '无'}`,
  ].join('\n');
}

function buildSearchableText(item: FavoriteItem, ai?: AiFavoriteIndexResponse, path = normalizeFavoritePath(ai, item)): string {
  return [
    buildFavoriteDocument(item),
    path.join(' '),
    normalizeText(ai?.summary, ''),
    normalizeTextArray(ai?.keywords).join(' '),
    normalizeTextArray(ai?.aliases).join(' '),
    normalizeTextArray(ai?.topicTail).join(' '),
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
