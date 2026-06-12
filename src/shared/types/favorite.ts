export interface FavoriteFolder {
  id?: number;
  mediaId: number;
  title: string;
  cover: string;
  intro: string;
  mediaCount: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number;
  lastSyncDiagnostic?: FavoriteFolderSyncDiagnostic;
}

export interface FavoriteItem {
  id?: number;
  itemKey: string;
  mediaId: number;
  folderTitle: string;
  avid: number;
  bvid: string;
  title: string;
  intro: string;
  authorName: string;
  authorMid: number;
  tagName: string;
  tags: string[];
  cover: string;
  duration: number;
  pubtime: number;
  favTime: number;
  syncedAt: number;
}

export interface SmartFavoriteIndex {
  id?: number;
  itemKey: string;
  path: string[];
  summary: string;
  keywords: string[];
  aliases: string[];
  searchableText: string;
  contentHash: string;
  model: string;
  status: 'indexed' | 'failed';
  error?: string;
  indexedAt: number;
}

export interface SmartFavoriteTreeNode {
  name: string;
  path: string[];
  count: number;
  children: SmartFavoriteTreeNode[];
}

export interface SmartFavoriteResult {
  item: FavoriteItem;
  smart?: SmartFavoriteIndex;
  score: number;
  reasons: string[];
}

export interface SmartFavoriteOverview {
  folders: FavoriteFolder[];
  reportedItems: number;
  storedItems: number;
  totalItems: number;
  indexedItems: number;
  failedItems: number;
  pendingItems: number;
  incompleteFolders: number;
  syncComplete: boolean;
  lastSyncedAt: number;
  lastSyncDiagnostics: FavoriteFolderSyncDiagnostic[];
  tree: SmartFavoriteTreeNode[];
}

export type FavoriteFolderSyncCompletenessState = 'complete' | 'incomplete';

export type FavoriteSyncStatus = 'complete' | 'blocked';

export interface FavoriteFolderSyncDiagnostic {
  mediaId: number;
  title: string;
  reportedMediaCount: number;
  requestedPages: number;
  pagesFetched: number;
  rawResourcesSeen: number;
  storedVideoItems: number;
  filteredUnavailableItems: number;
  filteredMissingIdItems: number;
  filteredNonVideoItems: number;
  filteredItems: number;
  pageErrors: number;
  hasMoreAfterStop: boolean;
  stoppedByMaxPages: boolean;
  unexplainedDelta: number;
  completenessState: FavoriteFolderSyncCompletenessState;
  errors: string[];
}

export interface FavoriteSyncResult {
  status: FavoriteSyncStatus;
  folders: number;
  items: number;
  insertedOrUpdated: number;
  reportedItems: number;
  filteredItems: number;
  blockedReason?: string;
  diagnostics: FavoriteFolderSyncDiagnostic[];
  syncedAt: number;
}

export interface SmartIndexResult {
  processed: number;
  indexed: number;
  failed: number;
  skipped: number;
}

export interface SmartFavoriteSearchResponse {
  query: string;
  rewrittenTerms: string[];
  results: SmartFavoriteResult[];
}

export type SmartFavoriteQaAnswerType =
  | 'retrieval_answer'
  | 'candidate_list'
  | 'no_result'
  | 'insufficient_evidence';

export type SmartFavoriteQaConfidence = 'high' | 'medium' | 'low';

export type SmartFavoriteQaStatusKind =
  | 'ok'
  | 'no_result'
  | 'low_confidence'
  | 'stale_index'
  | 'incomplete_sync'
  | 'index_missing'
  | 'insufficient_evidence';

export interface SmartFavoriteQaEvidenceHit {
  field: string;
  label: string;
  terms: string[];
  weight: number;
  snippet: string;
}

export interface SmartFavoriteQaCitedVideo {
  bvid: string;
  avid: number;
  title: string;
  authorName: string;
  folderTitle: string;
  smartPath: string[];
  link: string;
  matchReasons: string[];
  sourceFields: string[];
  confidence: SmartFavoriteQaConfidence;
  evidence: string;
  evidenceHits: SmartFavoriteQaEvidenceHit[];
  score: number;
  indexedAt?: number;
  syncedAt: number;
}

export interface SmartFavoriteQaSyncCoverage {
  complete: boolean;
  diagnosticsCount: number;
  problemFolders: number;
  note?: string;
}

export interface SmartFavoriteQaIndexCoverage {
  bilibiliReportedItems: number;
  storedItems: number;
  indexedItems: number;
  failedItems: number;
  pendingItems: number;
  staleItems: number;
  indexMissing: boolean;
  staleIndex: boolean;
}

export interface SmartFavoriteQaStatus {
  kind: SmartFavoriteQaStatusKind;
  notes: string[];
  syncCoverage: SmartFavoriteQaSyncCoverage;
  indexCoverage: SmartFavoriteQaIndexCoverage;
}

export type SmartFavoriteQaSynthesisStatus =
  | 'disabled'
  | 'not_configured'
  | 'generated'
  | 'failed'
  | 'rejected'
  | 'local_fallback';

export interface SmartFavoriteQaSynthesis {
  status: SmartFavoriteQaSynthesisStatus;
  answer?: string;
  reason?: string;
  model?: string | null;
  generatedAt?: number;
  citedVideoRefs?: string[];
}

export interface SmartFavoriteQaResponse {
  answerType: SmartFavoriteQaAnswerType;
  query: string;
  answer: string;
  confidence: SmartFavoriteQaConfidence;
  evidenceSummary: string;
  status: SmartFavoriteQaStatus;
  citedVideos: SmartFavoriteQaCitedVideo[];
  synthesis?: SmartFavoriteQaSynthesis;
}
