import type { FavoriteFolderSyncDiagnostic } from '../../shared/types/favorite';

export interface FavoriteSyncCompletenessAssessment {
  complete: boolean;
  reason?: string;
}

export function assessFavoriteSyncCompleteness(
  diagnostics: FavoriteFolderSyncDiagnostic[],
): FavoriteSyncCompletenessAssessment {
  const failedFolders = diagnostics.filter(diagnostic => diagnostic.completenessState === 'incomplete');

  if (failedFolders.length === 0) return { complete: true };

  const samples = failedFolders.slice(0, 3).map(diagnostic => {
    const issues = [
      diagnostic.pageErrors > 0 ? `${diagnostic.pageErrors} page error(s)` : '',
      `requested/fetched ${diagnostic.requestedPages}/${diagnostic.pagesFetched}`,
      diagnostic.unexplainedDelta > 0 ? `delta ${diagnostic.unexplainedDelta}` : '',
      diagnostic.hasMoreAfterStop ? 'has_more after stop' : '',
      diagnostic.stoppedByMaxPages ? 'max pages reached' : '',
    ].filter(Boolean).join(', ');
    return `${diagnostic.title || diagnostic.mediaId}(${diagnostic.mediaId}): ${issues}`;
  });

  return {
    complete: false,
    reason: `FAVORITE_SYNC_INCOMPLETE: ${samples.join('; ')}`,
  };
}

export function attachFavoriteSyncDiagnostics<T extends { mediaId: number }>(
  folders: T[],
  diagnostics: FavoriteFolderSyncDiagnostic[],
): T[] {
  const byMediaId = new Map(diagnostics.map(diagnostic => [diagnostic.mediaId, diagnostic]));
  return folders.map(folder => ({
    ...folder,
    lastSyncDiagnostic: byMediaId.get(folder.mediaId),
  }));
}
