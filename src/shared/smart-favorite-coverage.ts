import type { FavoriteFolder, FavoriteItem, SmartFavoriteIndex } from './types/favorite.ts';

export interface SmartFavoriteIndexCoverageSummary {
  bilibiliReportedItems: number;
  storedItems: number;
  indexedItems: number;
  failedItems: number;
  pendingItems: number;
  staleItems: number;
  indexMissing: boolean;
  staleIndex: boolean;
}

export function summarizeSmartFavoriteIndexCoverage(
  folders: FavoriteFolder[],
  items: FavoriteItem[],
  indexes: Map<string, SmartFavoriteIndex>,
): SmartFavoriteIndexCoverageSummary {
  let indexedItems = 0;
  let failedItems = 0;
  let pendingItems = 0;
  let staleItems = 0;

  for (const item of items) {
    const index = indexes.get(item.itemKey);
    if (!index) {
      pendingItems++;
      continue;
    }

    if (index.status === 'indexed') {
      indexedItems++;
    } else {
      failedItems++;
    }

    if (item.syncedAt > index.indexedAt) {
      staleItems++;
    }
  }

  const storedItems = items.length;
  const bilibiliReportedItems = folders.reduce((sum, folder) => sum + Math.max(0, Number(folder.mediaCount ?? 0)), 0);
  const indexMissing = storedItems > 0 && indexedItems === 0;
  const staleIndex = staleItems > 0 || pendingItems > 0 || failedItems > 0;

  return {
    bilibiliReportedItems,
    storedItems,
    indexedItems,
    failedItems,
    pendingItems,
    staleItems,
    indexMissing,
    staleIndex,
  };
}
