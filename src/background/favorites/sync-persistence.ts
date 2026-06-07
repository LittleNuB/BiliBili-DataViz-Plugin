import type { FavoriteFolder, FavoriteFolderSyncDiagnostic, FavoriteItem } from '../../shared/types/favorite';

export interface FavoriteSyncPersistenceRepo {
  replaceFavoriteSnapshot(folders: FavoriteFolder[], items: FavoriteItem[]): Promise<number>;
  updateFavoriteFolderSyncDiagnostics(
    folders: FavoriteFolder[],
    diagnostics: FavoriteFolderSyncDiagnostic[],
  ): Promise<void>;
  upsertFavoriteItems(items: FavoriteItem[]): Promise<number>;
}

export interface FavoriteSyncPersistenceInput {
  complete: boolean;
  folders: FavoriteFolder[];
  items: FavoriteItem[];
  diagnostics: FavoriteFolderSyncDiagnostic[];
}

export interface FavoriteSyncPersistenceResult {
  insertedOrUpdated: number;
  destructiveReplacement: boolean;
}

export async function persistFavoriteSyncData(
  input: FavoriteSyncPersistenceInput,
  repo: FavoriteSyncPersistenceRepo,
): Promise<FavoriteSyncPersistenceResult> {
  const foldersWithDiagnostics = attachDiagnosticsToFolders(input.folders, input.diagnostics);

  if (input.complete) {
    return {
      insertedOrUpdated: await repo.replaceFavoriteSnapshot(foldersWithDiagnostics, input.items),
      destructiveReplacement: true,
    };
  }

  await repo.updateFavoriteFolderSyncDiagnostics(foldersWithDiagnostics, input.diagnostics);
  return {
    insertedOrUpdated: await repo.upsertFavoriteItems(input.items),
    destructiveReplacement: false,
  };
}

function attachDiagnosticsToFolders(
  folders: FavoriteFolder[],
  diagnostics: FavoriteFolderSyncDiagnostic[],
): FavoriteFolder[] {
  const byMediaId = new Map(diagnostics.map(diagnostic => [diagnostic.mediaId, diagnostic]));
  return folders.map(folder => ({
    ...folder,
    lastSyncDiagnostic: byMediaId.get(folder.mediaId),
  }));
}
