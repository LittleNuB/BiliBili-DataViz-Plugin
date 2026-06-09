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
    .map(folder => folder.lastSyncDiagnostic)
    .filter((diagnostic): diagnostic is FavoriteFolderSyncDiagnostic => diagnostic !== undefined);
  const syncCoverage = buildSyncCoverage(diagnostics);
  const indexCoverage = buildIndexCoverage(input.items, input.indexes);
  const notes = buildCoverageNotes(syncCoverage, indexCoverage);

  if (!query) {
    const status = buildStatus('no_result', notes, syncCoverage, indexCoverage);
    return {
      answerType: 'no_result',
      query,
      answer: 'Enter a question to search locally synced favorites.',
      confidence: 'low',
      evidenceSummary: 'No query was provided.',
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
        ? 'No matching favorite was found in the locally synced data.'
        : 'No matching favorite was found in the currently synced data.',
      confidence: 'low',
      evidenceSummary: asksForUnsupportedContent
        ? 'This local slice can only use favorite metadata and Smart Favorites index fields; transcript, comments, and video body text are not available.'
        : 'No local metadata or Smart Favorites index field matched the question.',
      status: asksForUnsupportedContent
        ? buildStatus('insufficient_evidence', [
          ...notes,
          'Transcript, comments, danmaku, and full video body evidence are not available for Smart Favorites Q&A.',
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
  const scopedPrefix = syncCoverage.complete ? 'In locally synced favorites' : 'In the currently synced favorite data';
  const answer = answerType === 'candidate_list'
    ? `${scopedPrefix}, there is not enough evidence for a firm answer. The closest cited candidates are listed below.`
    : `${scopedPrefix}, the strongest cited matches are listed below.`;
  const evidenceSummary = summarizeEvidence(citedVideos, indexCoverage);

  return {
    answerType: asksForUnsupportedContent ? 'insufficient_evidence' : answerType,
    query,
    answer: asksForUnsupportedContent
      ? `${scopedPrefix}, these are only metadata/index candidates. This slice cannot answer transcript or full-video content questions.`
      : answer,
    confidence,
    evidenceSummary,
    status: buildStatus(statusKind, asksForUnsupportedContent
      ? [
        ...notes,
        'Only favorite metadata, folder/path, UP, category/tags, aliases, keywords, summaries, and path fields were used.',
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
    { field: 'bvid', label: 'BVID', value: item.bvid, weight: 60, reason: 'BVID match' },
    { field: 'title', label: 'Title', value: item.title, weight: 28, reason: 'Title match' },
    { field: 'authorName', label: 'UP', value: item.authorName, weight: 22, reason: 'UP match' },
    { field: 'smart.path', label: 'Smart path', value: (smart?.path ?? []).join(' / '), weight: 20, reason: 'Smart path match' },
    { field: 'smart.keywords', label: 'Smart keywords', value: (smart?.keywords ?? []).join(' '), weight: 18, reason: 'Smart keyword match' },
    { field: 'smart.aliases', label: 'Smart aliases', value: (smart?.aliases ?? []).join(' '), weight: 18, reason: 'Smart alias match' },
    { field: 'smart.summary', label: 'Smart summary', value: smart?.summary ?? '', weight: 14, reason: 'Smart summary match' },
    { field: 'folderTitle', label: 'Favorite folder', value: item.folderTitle, weight: 12, reason: 'Folder match' },
    { field: 'tagName', label: 'Category', value: item.tagName, weight: 10, reason: 'Category match' },
    { field: 'tags', label: 'Tags', value: (item.tags ?? []).join(' '), weight: 10, reason: 'Tag match' },
    { field: 'intro', label: 'Intro', value: item.intro, weight: 8, reason: 'Intro match' },
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
  return `Matched ${labels.join(', ')} with local term evidence: ${terms.join(', ')}.`;
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

function buildIndexCoverage(items: FavoriteItem[], indexes: Map<string, SmartFavoriteIndex>): SmartFavoriteQaIndexCoverage {
  const indexedItems = Array.from(indexes.values()).filter(index => index.status === 'indexed').length;
  const failedItems = Array.from(indexes.values()).filter(index => index.status === 'failed').length;
  const pendingItems = items.filter(item => !indexes.has(item.itemKey)).length;
  const staleItems = items.filter(item => {
    const index = indexes.get(item.itemKey);
    return index !== undefined && item.syncedAt > index.indexedAt;
  }).length;
  const indexMissing = items.length > 0 && indexedItems === 0;
  const staleIndex = staleItems > 0 || pendingItems > 0 || failedItems > 0;

  return {
    indexedItems,
    failedItems,
    pendingItems,
    staleItems,
    indexMissing,
    staleIndex,
  };
}

function buildCoverageNotes(syncCoverage: SmartFavoriteQaSyncCoverage, indexCoverage: SmartFavoriteQaIndexCoverage): string[] {
  const notes: string[] = [];
  if (!syncCoverage.complete) {
    notes.push('Favorite sync is incomplete; answers are scoped to the currently synced data.');
  }
  if (indexCoverage.indexMissing) {
    notes.push('Smart Favorites index is missing; only favorite metadata was used.');
  } else if (indexCoverage.staleIndex) {
    notes.push('Smart Favorites index may be stale or partial; metadata evidence is still used.');
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
    ? ' Smart index fields were unavailable.'
    : indexCoverage.staleIndex
      ? ' Some index fields may be stale or partial.'
      : '';
  return `Matched ${citedVideos.length} cited video(s) using ${fields.join(', ') || 'local metadata'}.${indexNote}`;
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
      return 'BVID matched';
    case 'title':
      return 'Title matched';
    case 'authorName':
      return 'UP matched';
    case 'smart.path':
      return 'Smart path matched';
    case 'smart.keywords':
      return 'Smart keyword matched';
    case 'smart.aliases':
      return 'Smart alias matched';
    case 'smart.summary':
      return 'Smart summary matched';
    case 'folderTitle':
      return 'Favorite folder matched';
    case 'tagName':
      return 'Category matched';
    case 'tags':
      return 'Tag matched';
    case 'intro':
      return 'Intro matched';
    default:
      return 'Local metadata matched';
  }
}

function hasDiagnosticIssue(diagnostic: FavoriteFolderSyncDiagnostic): boolean {
  return diagnostic.errors.length > 0
    || diagnostic.hasMoreAfterStop
    || diagnostic.stoppedByMaxPages
    || diagnostic.unexplainedDelta > 0;
}

function buildIncompleteSyncNote(diagnostics: FavoriteFolderSyncDiagnostic[]): string {
  const samples = diagnostics.slice(0, 3).map(diagnostic => {
    const issues = [
      diagnostic.errors.length > 0 ? `${diagnostic.errors.length} error(s)` : '',
      diagnostic.unexplainedDelta > 0 ? `delta ${diagnostic.unexplainedDelta}` : '',
      diagnostic.hasMoreAfterStop ? 'has_more after stop' : '',
      diagnostic.stoppedByMaxPages ? 'max pages reached' : '',
    ].filter(Boolean).join(', ');
    return `${diagnostic.title || diagnostic.mediaId}(${diagnostic.mediaId}): ${issues}`;
  });
  return `FAVORITE_SYNC_INCOMPLETE: ${samples.join('; ')}`;
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
