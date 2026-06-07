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
  totalItems: number;
  indexedItems: number;
  failedItems: number;
  pendingItems: number;
  lastSyncedAt: number;
  lastSyncDiagnostics: FavoriteFolderSyncDiagnostic[];
  tree: SmartFavoriteTreeNode[];
}

export type FavoriteSyncStatus = 'complete' | 'blocked';

export interface FavoriteFolderSyncDiagnostic {
  mediaId: number;
  title: string;
  reportedMediaCount: number;
  pagesFetched: number;
  rawResourcesSeen: number;
  storedVideoItems: number;
  filteredUnavailableItems: number;
  filteredMissingIdItems: number;
  filteredNonVideoItems: number;
  filteredItems: number;
  hasMoreAfterStop: boolean;
  stoppedByMaxPages: boolean;
  unexplainedDelta: number;
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
