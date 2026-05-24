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
  tid?: number;
  tname?: string;
  tidV2?: number;
  tnameV2?: string;
  pidV2?: number;
  pidNameV2?: string;
  tagName: string;
  tags: string[];
  tagsFetchedAt?: number;
  tagsFetchFailedAt?: number;
  tagsFetchError?: string;
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
  status: 'indexed' | 'degraded' | 'failed';
  error?: string;
  taxonomyVersion?: string;
  pathSource?: 'bili_v2' | 'bili_legacy' | 'tag_override' | 'folder' | 'uncategorized';
  regionSnapshot?: {
    tid?: number;
    tname?: string;
    tidV2?: number;
    tnameV2?: string;
    pidV2?: number;
    pidNameV2?: string;
  };
  tagsSnapshot?: string[];
  aiTopicTail?: string[];
  aiStatus?: 'enhanced' | 'degraded' | 'skipped';
  aiError?: string;
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
  uniqueItems?: number;
  indexedItems: number;
  degradedItems: number;
  failedItems: number;
  pendingItems: number;
  lastSyncedAt: number;
  tree: SmartFavoriteTreeNode[];
}

export interface FavoriteSyncResult {
  folders: number;
  items: number;
  uniqueItems?: number;
  insertedOrUpdated: number;
  syncedAt: number;
}

export interface SmartIndexResult {
  processed: number;
  indexed: number;
  degraded?: number;
  failed: number;
  skipped: number;
  cancelled?: boolean;
  stoppedReason?: string;
}

export interface SmartFavoriteSearchResponse {
  query: string;
  rewrittenTerms: string[];
  results: SmartFavoriteResult[];
}
