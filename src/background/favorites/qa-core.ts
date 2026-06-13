import type {
  FavoriteFolder,
  FavoriteFolderSyncDiagnostic,
  FavoriteItem,
  SmartFavoriteIndex,
  SmartFavoriteQaCitedVideo,
  SmartFavoriteQaConfidence,
  SmartFavoriteQaEvidenceHit,
  SmartFavoriteQaIndexCoverage,
  SmartFavoriteQaResponse,
  SmartFavoriteQaStatus,
  SmartFavoriteQaStatusKind,
  SmartFavoriteQaSyncCoverage,
} from '../../shared/types/favorite';
import { normalizeFavoriteFolderSyncDiagnostic } from '../../shared/favorite-sync-diagnostics.ts';
import { summarizeSmartFavoriteIndexCoverage } from '../../shared/smart-favorite-coverage.ts';

const DEFAULT_QA_LIMIT = 8;
const MEDIUM_SCORE = 28;
const HIGH_SCORE = 56;
const LOW_RESULT_SCORE = 10;
const QUERY_STOP_TERMS = new Set([
  'find',
  'search',
  'video',
  'videos',
  'favorite',
  'favorites',
  'bilibili',
  'about',
  'related',
  'similar',
  'that',
  'this',
  'have',
  'did',
  'does',
  'with',
  'from',
  'what',
  'which',
  'please',
  'help',
  'me',
  'my',
  '我',
  '你',
  '的',
  '了',
  '吗',
  '呢',
  '有没有',
  '是否',
  '帮我',
  '找',
  '查',
  '搜索',
  '收藏',
  '视频',
  '那个',
  '一个',
  '一些',
  '相关',
  '类似',
  '当前',
  '内容',
]);
const CONTENT_QA_PATTERNS = [
  'transcript',
  'subtitle',
  'caption',
  'comment',
  'danmaku',
  'full content',
  '字幕',
  '台词',
  '弹幕',
  '评论',
  '正文',
  '全文',
  '完整内容',
  '视频里说',
];

interface SmartFavoriteQaInput {
  query: string;
  items: FavoriteItem[];
  indexes: Map<string, SmartFavoriteIndex>;
  folders: FavoriteFolder[];
  limit?: number;
  now?: number;
}

interface SearchableField {
  field: string;
  label: string;
  value: string;
  weight: number;
  reason: string;
}

interface ScoredVideo {
  item: FavoriteItem;
  smart?: SmartFavoriteIndex;
  score: number;
  evidenceHits: SmartFavoriteQaEvidenceHit[];
  sourceFields: string[];
  matchReasons: string[];
  confidence: SmartFavoriteQaConfidence;
}

export function buildSmartFavoriteQaResponse(input: SmartFavoriteQaInput): SmartFavoriteQaResponse {
  const query = input.query.trim();
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? DEFAULT_QA_LIMIT), 20));
  const diagnostics = input.folders
    .map(folder => folder.lastSyncDiagnostic ? normalizeFavoriteFolderSyncDiagnostic(folder.lastSyncDiagnostic) : undefined)
    .filter((diagnostic): diagnostic is FavoriteFolderSyncDiagnostic => diagnostic !== undefined);
  const syncCoverage = buildSyncCoverage(diagnostics);
  const indexCoverage = buildIndexCoverage(input.folders, input.items, input.indexes);
  const notes = buildCoverageNotes(syncCoverage, indexCoverage);

  if (!query) {
    const status = buildStatus('no_result', notes, syncCoverage, indexCoverage);
    return {
      answerType: 'no_result',
      query,
      answer: '请输入问题后再搜索当前已同步收藏。',
      confidence: 'low',
      evidenceSummary: '还没有提供可检索的问题。',
      status,
      citedVideos: [],
    };
  }

  const terms = buildLocalQueryTerms(query);
  const scored = input.items
    .map(item => scoreFavoriteForQuestion(item, input.indexes.get(item.itemKey), terms, query))
    .filter((result): result is ScoredVideo => result !== null)
    .sort((a, b) => b.score - a.score || b.item.favTime - a.item.favTime);
  const citedVideos = scored.slice(0, limit).map(toCitedVideo);
  const asksForUnsupportedContent = CONTENT_QA_PATTERNS.some(pattern => normalizeForSearch(query).includes(normalizeForSearch(pattern)));

  if (citedVideos.length === 0) {
    const status = buildStatus('no_result', notes, syncCoverage, indexCoverage);
    return {
      answerType: asksForUnsupportedContent ? 'insufficient_evidence' : 'no_result',
      query,
      answer: syncCoverage.complete
        ? '在本地已同步收藏中，未找到匹配的收藏。'
        : '当前已同步收藏中，未找到匹配的收藏。',
      confidence: 'low',
      evidenceSummary: asksForUnsupportedContent
        ? '当前收藏问答只能使用收藏元数据和智能收藏索引字段；字幕、评论、弹幕和视频正文不可用。'
        : '没有本地元数据或智能收藏索引字段命中这个问题。',
      status: asksForUnsupportedContent
        ? buildStatus('insufficient_evidence', [
          ...notes,
          '收藏问答当前没有字幕、评论、弹幕或完整视频正文证据。',
        ], syncCoverage, indexCoverage)
        : status,
      citedVideos: [],
    };
  }

  const top = citedVideos[0];
  const confidence = top.confidence;
  const answerType = confidence === 'low' || top.score < MEDIUM_SCORE ? 'candidate_list' : 'retrieval_answer';
  const statusKind = pickStatusKind({
    answerType,
    confidence,
    syncCoverage,
    indexCoverage,
    asksForUnsupportedContent,
  });
  const scopedPrefix = syncCoverage.complete ? '在本地已同步收藏中' : '在当前已同步收藏中';
  const answer = answerType === 'candidate_list'
    ? `${scopedPrefix}，证据还不足以给出确定答案；下方列出最接近的引用候选。`
    : `${scopedPrefix}，下方是最有证据支持的引用匹配。`;
  const evidenceSummary = summarizeEvidence(citedVideos, indexCoverage);

  return {
    answerType: asksForUnsupportedContent ? 'insufficient_evidence' : answerType,
    query,
    answer: asksForUnsupportedContent
      ? `${scopedPrefix}，这些只是元数据或索引候选；当前切片不能回答字幕或完整视频正文问题。`
      : answer,
    confidence,
    evidenceSummary,
    status: buildStatus(statusKind, asksForUnsupportedContent
      ? [
        ...notes,
        '本次只使用收藏元数据、收藏夹/路径、UP、分区/标签、别名、关键词、摘要和分类路径字段。',
      ]
      : notes, syncCoverage, indexCoverage),
    citedVideos,
  };
}

function scoreFavoriteForQuestion(
  item: FavoriteItem,
  smart: SmartFavoriteIndex | undefined,
  terms: string[],
  rawQuery: string,
): ScoredVideo | null {
  const fields = buildSearchableFields(item, smart);
  const raw = normalizeForSearch(rawQuery);
  const hits: SmartFavoriteQaEvidenceHit[] = [];
  let score = 0;

  for (const field of fields) {
    const normalizedValue = normalizeForSearch(field.value);
    if (!normalizedValue) continue;

    const matchedTerms = new Set<string>();
    if (raw && field.field === 'title' && normalizedValue.includes(raw)) {
      matchedTerms.add(rawQuery.trim());
      score += field.weight + 18;
    }

    for (const term of terms) {
      const normalizedTerm = normalizeForSearch(term);
      if (normalizedTerm && normalizedValue.includes(normalizedTerm)) {
        matchedTerms.add(term);
        score += field.weight;
      }
    }

    if (matchedTerms.size > 0) {
      hits.push({
        field: field.field,
        label: field.label,
        terms: Array.from(matchedTerms).slice(0, 6),
        weight: field.weight,
        snippet: clipSnippet(field.value),
      });
    }
  }

  if (score < LOW_RESULT_SCORE || hits.length === 0) return null;

  const sourceFields = uniqueStrings(hits.map(hit => hit.field));
  const matchReasons = uniqueStrings(hits.map(hit => reasonForField(hit.field))).slice(0, 4);
  const confidence = score >= HIGH_SCORE || sourceFields.length >= 4
    ? 'high'
    : score >= MEDIUM_SCORE || sourceFields.length >= 2
      ? 'medium'
      : 'low';

  return {
    item,
    ...(smart ? { smart } : {}),
    score,
    evidenceHits: hits,
    sourceFields,
    matchReasons,
    confidence,
  };
}

function buildSearchableFields(item: FavoriteItem, smart: SmartFavoriteIndex | undefined): SearchableField[] {
  return [
    { field: 'bvid', label: 'BVID', value: item.bvid, weight: 60, reason: 'BVID 命中' },
    { field: 'title', label: '标题', value: item.title, weight: 28, reason: '标题命中' },
    { field: 'authorName', label: 'UP 主', value: item.authorName, weight: 22, reason: 'UP 主命中' },
    { field: 'smart.path', label: '智能分类路径', value: (smart?.path ?? []).join(' / '), weight: 20, reason: '智能分类路径命中' },
    { field: 'smart.keywords', label: '智能关键词', value: (smart?.keywords ?? []).join(' '), weight: 18, reason: '智能关键词命中' },
    { field: 'smart.aliases', label: '智能别名', value: (smart?.aliases ?? []).join(' '), weight: 18, reason: '智能别名命中' },
    { field: 'smart.summary', label: '智能摘要', value: smart?.summary ?? '', weight: 14, reason: '智能摘要命中' },
    { field: 'folderTitle', label: '收藏夹', value: item.folderTitle, weight: 12, reason: '收藏夹命中' },
    { field: 'tagName', label: '分区', value: item.tagName, weight: 10, reason: '分区命中' },
    { field: 'tags', label: '标签', value: (item.tags ?? []).join(' '), weight: 10, reason: '标签命中' },
    { field: 'intro', label: '简介', value: item.intro, weight: 8, reason: '简介命中' },
  ];
}

function toCitedVideo(result: ScoredVideo): SmartFavoriteQaCitedVideo {
  const link = getVideoUrl(result.item);
  return {
    bvid: result.item.bvid,
    avid: result.item.avid,
    title: result.item.title,
    authorName: result.item.authorName,
    folderTitle: result.item.folderTitle,
    smartPath: result.smart?.path ?? [],
    link,
    matchReasons: result.matchReasons,
    sourceFields: result.sourceFields,
    confidence: result.confidence,
    evidence: buildEvidenceSentence(result),
    evidenceHits: result.evidenceHits,
    score: Math.round(result.score),
    ...(result.smart?.indexedAt ? { indexedAt: result.smart.indexedAt } : {}),
    syncedAt: result.item.syncedAt,
  };
}

function buildEvidenceSentence(result: ScoredVideo): string {
  const labels = uniqueStrings(result.evidenceHits.map(hit => hit.label)).slice(0, 3);
  const terms = uniqueStrings(result.evidenceHits.flatMap(hit => hit.terms)).slice(0, 5);
  return `本地词项命中 ${labels.join('、')}：${terms.join('、')}。`;
}

function buildSyncCoverage(diagnostics: FavoriteFolderSyncDiagnostic[]): SmartFavoriteQaSyncCoverage {
  const problemDiagnostics = diagnostics.filter(hasDiagnosticIssue);
  const problemFolders = diagnostics.filter(hasDiagnosticIssue).length;
  return {
    complete: problemDiagnostics.length === 0,
    diagnosticsCount: diagnostics.length,
    problemFolders,
    ...(problemDiagnostics.length > 0 ? { note: buildIncompleteSyncNote(problemDiagnostics) } : {}),
  };
}

function buildIndexCoverage(
  folders: FavoriteFolder[],
  items: FavoriteItem[],
  indexes: Map<string, SmartFavoriteIndex>,
): SmartFavoriteQaIndexCoverage {
  return summarizeSmartFavoriteIndexCoverage(folders, items, indexes);
}

function buildCoverageNotes(syncCoverage: SmartFavoriteQaSyncCoverage, indexCoverage: SmartFavoriteQaIndexCoverage): string[] {
  const notes: string[] = [
    `索引覆盖：B站报告 ${indexCoverage.bilibiliReportedItems} 条，本地保存 ${indexCoverage.storedItems} 条，已索引 ${indexCoverage.indexedItems} 条，失败 ${indexCoverage.failedItems} 条，待索引 ${indexCoverage.pendingItems} 条。`,
  ];
  if (!syncCoverage.complete) {
    notes.push('收藏同步可能不完整；回答只基于当前已同步收藏。');
  }
  if (indexCoverage.indexMissing) {
    notes.push('智能收藏索引缺失；本次只使用收藏元数据。');
  } else if (indexCoverage.staleIndex) {
    notes.push('智能收藏索引可能过期或不完整；本次仍会使用元数据证据。');
  }
  return notes;
}

function pickStatusKind(input: {
  answerType: 'retrieval_answer' | 'candidate_list';
  confidence: SmartFavoriteQaConfidence;
  syncCoverage: SmartFavoriteQaSyncCoverage;
  indexCoverage: SmartFavoriteQaIndexCoverage;
  asksForUnsupportedContent: boolean;
}): SmartFavoriteQaStatusKind {
  if (input.asksForUnsupportedContent) return 'insufficient_evidence';
  if (!input.syncCoverage.complete) return 'incomplete_sync';
  if (input.indexCoverage.indexMissing) return 'index_missing';
  if (input.indexCoverage.staleIndex) return 'stale_index';
  if (input.answerType === 'candidate_list' || input.confidence === 'low') return 'low_confidence';
  return 'ok';
}

function buildStatus(
  kind: SmartFavoriteQaStatusKind,
  notes: string[],
  syncCoverage: SmartFavoriteQaSyncCoverage,
  indexCoverage: SmartFavoriteQaIndexCoverage,
): SmartFavoriteQaStatus {
  return {
    kind,
    notes,
    syncCoverage,
    indexCoverage,
  };
}

function summarizeEvidence(citedVideos: SmartFavoriteQaCitedVideo[], indexCoverage: SmartFavoriteQaIndexCoverage): string {
  const fields = uniqueStrings(citedVideos.flatMap(video => video.sourceFields));
  const indexNote = indexCoverage.indexMissing
    ? ' 智能索引字段不可用。'
    : indexCoverage.staleIndex
      ? ' 部分索引字段可能过期或不完整。'
      : '';
  return `命中 ${citedVideos.length} 个引用视频，使用字段：${fields.map(displaySourceField).join('、') || '本地元数据'}。${indexNote}`;
}

function buildLocalQueryTerms(query: string): string[] {
  const compact = normalizeForSearch(query);
  const withoutChineseStopWords = compact
    .replace(/有没有|帮我|收藏过|收藏|视频|那个|一个|一些|相关|类似|当前|查找|搜索|请问|请/g, ' ');
  const directTerms = query
    .split(/[\s,.;:!?，。；：！？、|/\\()[\]{}"'`~]+/)
    .map(term => term.trim())
    .filter(isUsefulTerm);
  const compactTerms = withoutChineseStopWords
    .split(/\s+/)
    .map(term => term.trim())
    .filter(isUsefulTerm);
  const cjkTerms = getCjkNgrams(withoutChineseStopWords);
  return uniqueStrings([query.trim(), ...directTerms, ...compactTerms, ...cjkTerms])
    .filter(isUsefulTerm)
    .slice(0, 32);
}

function getCjkNgrams(value: string): string[] {
  const cjkRuns = value.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  const terms: string[] = [];
  for (const run of cjkRuns) {
    if (run.length <= 6) {
      terms.push(run);
      continue;
    }
    for (const size of [4, 3, 2]) {
      for (let index = 0; index <= run.length - size; index++) {
        terms.push(run.slice(index, index + size));
      }
    }
  }
  return terms;
}

function isUsefulTerm(term: string): boolean {
  const normalized = normalizeForSearch(term);
  if (normalized.length < 2) return false;
  return !QUERY_STOP_TERMS.has(normalized);
}

function reasonForField(field: string): string {
  switch (field) {
    case 'bvid':
      return 'BVID 命中';
    case 'title':
      return '标题命中';
    case 'authorName':
      return 'UP 主命中';
    case 'smart.path':
      return '智能分类路径命中';
    case 'smart.keywords':
      return '智能关键词命中';
    case 'smart.aliases':
      return '智能别名命中';
    case 'smart.summary':
      return '智能摘要命中';
    case 'folderTitle':
      return '收藏夹命中';
    case 'tagName':
      return '分区命中';
    case 'tags':
      return '标签命中';
    case 'intro':
      return '简介命中';
    default:
      return '本地元数据命中';
  }
}

function hasDiagnosticIssue(diagnostic: FavoriteFolderSyncDiagnostic): boolean {
  return diagnostic.completenessState === 'incomplete';
}

function buildIncompleteSyncNote(diagnostics: FavoriteFolderSyncDiagnostic[]): string {
  const samples = diagnostics.slice(0, 3).map(diagnostic => {
    const issues = [
      diagnostic.pageErrors > 0 ? `${diagnostic.pageErrors} 个页面错误` : '',
      `请求/获取页数 ${diagnostic.requestedPages}/${diagnostic.pagesFetched}`,
      diagnostic.unexplainedDelta > 0 ? `差异 ${diagnostic.unexplainedDelta}` : '',
      diagnostic.hasMoreAfterStop ? '停止后仍提示有更多' : '',
      diagnostic.stoppedByMaxPages ? '达到页数上限' : '',
    ].filter(Boolean).join(', ');
    return `${diagnostic.title || diagnostic.mediaId}(${diagnostic.mediaId}): ${issues}`;
  });
  return `收藏同步可能不完整：${samples.join('；')}`;
}

function displaySourceField(field: string): string {
  switch (field) {
    case 'bvid':
      return 'BVID';
    case 'title':
      return '标题';
    case 'authorName':
      return 'UP 主';
    case 'smart.path':
      return '智能分类路径';
    case 'smart.keywords':
      return '智能关键词';
    case 'smart.aliases':
      return '智能别名';
    case 'smart.summary':
      return '智能摘要';
    case 'folderTitle':
      return '收藏夹';
    case 'tagName':
      return '分区';
    case 'tags':
      return '标签';
    case 'intro':
      return '简介';
    default:
      return field;
  }
}

function getVideoUrl(item: FavoriteItem): string {
  if (item.bvid) return `https://www.bilibili.com/video/${encodeURIComponent(item.bvid)}`;
  if (item.avid) return `https://www.bilibili.com/video/av${encodeURIComponent(String(item.avid))}`;
  return '';
}

function clipSnippet(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}

function normalizeForSearch(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
