import type { FavoriteFolder, FavoriteFolderSyncDiagnostic, FavoriteItem } from '../../shared/types/favorite';
import type { FavoriteRepoWriteResult } from '../storage/favorite-repo';

export interface FavoriteSyncPersistenceRepo {
  replaceFavoriteSnapshot(folders: FavoriteFolder[], items: FavoriteItem[]): Promise<FavoriteRepoWriteResult>;
  updateFavoriteFolderSyncDiagnostics(
    folders: FavoriteFolder[],
    diagnostics: FavoriteFolderSyncDiagnostic[],
  ): Promise<FavoriteRepoWriteResult>;
  upsertFavoriteItems(items: FavoriteItem[]): Promise<FavoriteRepoWriteResult>;
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
  notes: string[];
}

export async function persistFavoriteSyncData(
  input: FavoriteSyncPersistenceInput,
  repo: FavoriteSyncPersistenceRepo,
): Promise<FavoriteSyncPersistenceResult> {
  const foldersWithDiagnostics = attachDiagnosticsToFolders(input.folders, input.diagnostics);

  if (input.complete) {
    const write = await repo.replaceFavoriteSnapshot(foldersWithDiagnostics, input.items);
    return {
      insertedOrUpdated: write.written,
      destructiveReplacement: true,
      notes: write.notes,
    };
  }

  const folderWrite = await repo.updateFavoriteFolderSyncDiagnostics(foldersWithDiagnostics, input.diagnostics);
  const itemWrite = await repo.upsertFavoriteItems(input.items);
  return {
    insertedOrUpdated: itemWrite.written,
    destructiveReplacement: false,
    notes: [...folderWrite.notes, ...itemWrite.notes],
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
