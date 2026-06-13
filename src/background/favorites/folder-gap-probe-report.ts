import type {
  FavoriteFolderGapBuckets,
  FavoriteFolderGapProbeResult,
  FavoriteFolderProbeClassification,
  FavoriteFolderProbeLocalIndexCoverage,
  FavoriteItem,
  SmartFavoriteIndex,
} from '../../shared/types/favorite';

export function buildFavoriteFolderGapReport(
  folder: { mediaId: number; title: string; mediaCount: number },
  diagnostic: FavoriteFolderGapProbeResult['diagnostic'],
  localFolderItems: FavoriteItem[],
  probeItems: FavoriteItem[],
  indexMap: Map<string, SmartFavoriteIndex>,
): FavoriteFolderGapProbeResult {
  const localIndexCoverage = summarizeLocalIndexCoverage(localFolderItems, indexMap, probeItems);
  const gapBuckets = buildGapBuckets(diagnostic.reportedMediaCount, diagnostic.uniqueResourcesSeen, diagnostic.filteredItems, localIndexCoverage);
  const classification = classifyProbe(gapBuckets);
  const notes = buildProbeNotes(gapBuckets, diagnostic, localIndexCoverage);

  return {
    folder: {
      mediaId: folder.mediaId,
      title: folder.title,
      reportedMediaCount: Math.max(0, Number(folder.mediaCount ?? 0)),
    },
    diagnostic,
    localIndexCoverage,
    gapBuckets,
    classification,
    notes,
    probedAt: Date.now(),
  };
}

function summarizeLocalIndexCoverage(
  localItems: FavoriteItem[],
  indexMap: Map<string, SmartFavoriteIndex>,
  probeItems: FavoriteItem[],
): FavoriteFolderProbeLocalIndexCoverage {
  const probeKeys = new Set(probeItems.map(item => item.itemKey));
  const localKeys = new Set(localItems.map(item => item.itemKey));
  let indexedItems = 0;
  let failedItems = 0;
  let pendingItems = 0;
  let staleItems = 0;
  let overlapItems = 0;

  for (const item of localItems) {
    const index = indexMap.get(item.itemKey);
    if (!index) {
      pendingItems++;
    } else if (index.status === 'indexed') {
      indexedItems++;
    } else {
      failedItems++;
    }

    if (index && item.syncedAt > index.indexedAt) {
      staleItems++;
    }
    if (probeKeys.has(item.itemKey)) {
      overlapItems++;
    }
  }

  let probeOnlyItems = 0;
  for (const item of probeItems) {
    if (!localKeys.has(item.itemKey)) {
      probeOnlyItems++;
    }
  }

  return {
    storedItems: localItems.length,
    indexedItems,
    failedItems,
    pendingItems,
    staleItems,
    overlapItems,
    localOnlyItems: Math.max(0, localItems.length - overlapItems),
    probeOnlyItems,
  };
}

function buildGapBuckets(
  reportedMediaCount: number,
  uniqueResourcesSeen: number,
  filteredItems: number,
  localIndexCoverage: FavoriteFolderProbeLocalIndexCoverage,
): FavoriteFolderGapBuckets {
  return {
    apiMissingItems: Math.max(0, reportedMediaCount - uniqueResourcesSeen),
    filteredItems: Math.max(0, filteredItems),
    storedButNotIndexedItems: Math.max(0, localIndexCoverage.pendingItems + localIndexCoverage.failedItems),
    localOnlyItems: Math.max(0, localIndexCoverage.localOnlyItems),
  };
}

function classifyProbe(gapBuckets: FavoriteFolderGapBuckets): FavoriteFolderProbeClassification {
  const activeBuckets = [
    gapBuckets.apiMissingItems > 0,
    gapBuckets.filteredItems > 0,
    gapBuckets.storedButNotIndexedItems > 0,
    gapBuckets.localOnlyItems > 0,
  ].filter(Boolean).length;

  if (activeBuckets === 0) return 'complete';
  if (activeBuckets > 1) return 'mixed';
  if (gapBuckets.apiMissingItems > 0) return 'api_gap_only';
  if (gapBuckets.filteredItems > 0) return 'filtered_only';
  if (gapBuckets.storedButNotIndexedItems > 0) return 'index_gap_only';
  return 'local_retained_only';
}

function buildProbeNotes(
  gapBuckets: FavoriteFolderGapBuckets,
  diagnostic: FavoriteFolderGapProbeResult['diagnostic'],
  localIndexCoverage: FavoriteFolderProbeLocalIndexCoverage,
): string[] {
  const notes: string[] = [];
  if (gapBuckets.apiMissingItems > 0) {
    notes.push(
      `Bilibili reported ${diagnostic.reportedMediaCount}, but the probe only saw ${diagnostic.uniqueResourcesSeen} unique resources from the API.`,
    );
  }
  if (gapBuckets.filteredItems > 0) {
    notes.push(
      `The API returned ${gapBuckets.filteredItems} resources that the plugin filtered as unavailable, non-video, or missing IDs.`,
    );
  }
  if (gapBuckets.storedButNotIndexedItems > 0) {
    notes.push(
      `The local folder already has ${localIndexCoverage.storedItems} stored items, but ${gapBuckets.storedButNotIndexedItems} are still pending or failed in Smart Favorites indexing.`,
    );
  }
  if (gapBuckets.localOnlyItems > 0) {
    notes.push(
      `${gapBuckets.localOnlyItems} local items were kept from an older usable snapshot and did not appear in the current live probe.`,
    );
  }
  if (diagnostic.duplicateResourceIds > 0 || diagnostic.duplicateBvids > 0) {
    notes.push(
      `The live probe saw duplicate resources across fetched pages (resource-id duplicates ${diagnostic.duplicateResourceIds}, bvid duplicates ${diagnostic.duplicateBvids}).`,
    );
  }
  if (diagnostic.pageErrors > 0) {
    notes.push(`The probe hit ${diagnostic.pageErrors} page-level issue(s): ${diagnostic.errors.join(' | ')}.`);
  }
  return notes;
}
