import type { FavoriteFolder, FavoriteFolderSyncCompletenessState, FavoriteFolderSyncDiagnostic } from './types/favorite.ts';

export function normalizeFavoriteFolderSyncDiagnostic(diagnostic: FavoriteFolderSyncDiagnostic): FavoriteFolderSyncDiagnostic {
  const filteredItems = Number.isFinite(diagnostic.filteredItems)
    ? diagnostic.filteredItems
    : Math.max(
      0,
      Number(diagnostic.filteredUnavailableItems ?? 0)
      + Number(diagnostic.filteredMissingIdItems ?? 0)
      + Number(diagnostic.filteredNonVideoItems ?? 0),
    );
  const pageErrors = Number.isFinite(diagnostic.pageErrors)
    ? diagnostic.pageErrors
    : Array.isArray(diagnostic.errors) ? diagnostic.errors.length : 0;
  const requestedPages = Number.isFinite(diagnostic.requestedPages)
    ? diagnostic.requestedPages
    : Math.max(0, Number(diagnostic.pagesFetched ?? 0));
  const completenessState = diagnostic.completenessState ?? deriveFavoriteFolderSyncCompletenessState({
    pageErrors,
    errors: diagnostic.errors,
    hasMoreAfterStop: diagnostic.hasMoreAfterStop,
    stoppedByMaxPages: diagnostic.stoppedByMaxPages,
    unexplainedDelta: diagnostic.unexplainedDelta,
  });

  return {
    ...diagnostic,
    filteredItems,
    pageErrors,
    requestedPages,
    completenessState,
  };
}

export function normalizeFavoriteFoldersWithDiagnostics(folders: FavoriteFolder[]): FavoriteFolder[] {
  return folders.map(folder => {
    if (!folder.lastSyncDiagnostic) return folder;
    return {
      ...folder,
      lastSyncDiagnostic: normalizeFavoriteFolderSyncDiagnostic(folder.lastSyncDiagnostic),
    };
  });
}

export function deriveFavoriteFolderSyncCompletenessState(
  diagnostic: Pick<
    FavoriteFolderSyncDiagnostic,
    'pageErrors' | 'errors' | 'hasMoreAfterStop' | 'stoppedByMaxPages' | 'unexplainedDelta'
  >,
): FavoriteFolderSyncCompletenessState {
  return getFavoriteFolderSyncIssueCount(diagnostic) > 0 ? 'incomplete' : 'complete';
}

export function getFavoriteFolderSyncIssueCount(
  diagnostic: Pick<
    FavoriteFolderSyncDiagnostic,
    'pageErrors' | 'errors' | 'hasMoreAfterStop' | 'stoppedByMaxPages' | 'unexplainedDelta'
  >,
): number {
  return [
    Math.max(0, Number(diagnostic.pageErrors ?? (diagnostic.errors?.length ?? 0))),
    diagnostic.hasMoreAfterStop ? 1 : 0,
    diagnostic.stoppedByMaxPages ? 1 : 0,
    Math.max(0, Number(diagnostic.unexplainedDelta ?? 0)) > 0 ? 1 : 0,
  ].reduce((sum, count) => sum + count, 0);
}
