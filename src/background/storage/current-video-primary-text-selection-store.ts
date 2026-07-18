import {
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
  currentVideoPrimaryTextPartKey,
  normalizeCurrentVideoPrimaryTextSelections,
  type CurrentVideoPrimaryTextSelections,
  type SaveCurrentVideoPrimaryTextSelectionResult,
} from '../../shared/current-video-primary-text-selection.ts';

export interface CurrentVideoPrimaryTextSelectionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export interface SaveCurrentVideoPrimaryTextSelectionInput {
  bvid: string;
  cid: number;
  page: number;
  selectedSourceIdentityKey: string;
}

let selectionMutationTail: Promise<void> = Promise.resolve();
let selectionClearDepth = 0;

export function saveCurrentVideoPrimaryTextSelection(
  input: SaveCurrentVideoPrimaryTextSelectionInput,
  storage: CurrentVideoPrimaryTextSelectionStorage = chrome.storage.local,
): Promise<SaveCurrentVideoPrimaryTextSelectionResult> {
  if (selectionClearDepth > 0) {
    return Promise.reject(new Error('PRIMARY_TEXT_SELECTION_CLEAR_IN_PROGRESS'));
  }
  return enqueueSelectionMutation(() => persistCurrentVideoPrimaryTextSelection(input, storage));
}

export function coordinateCurrentVideoPrimaryTextSelectionClear<T>(
  clear: () => Promise<T>,
): Promise<T> {
  selectionClearDepth += 1;
  const operation = enqueueSelectionMutation(clear);
  return operation.finally(() => {
    selectionClearDepth = Math.max(0, selectionClearDepth - 1);
  });
}

async function persistCurrentVideoPrimaryTextSelection(
  input: SaveCurrentVideoPrimaryTextSelectionInput,
  storage: CurrentVideoPrimaryTextSelectionStorage,
): Promise<SaveCurrentVideoPrimaryTextSelectionResult> {
  const partKey = currentVideoPrimaryTextPartKey(input);
  const selectedSourceIdentityKey = input.selectedSourceIdentityKey.trim();
  if (!partKey || !selectedSourceIdentityKey) {
    throw new Error('PRIMARY_TEXT_SELECTION_INVALID');
  }

  let stored: Record<string, unknown>;
  try {
    stored = await storage.get(CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY);
  } catch {
    throw new Error('PRIMARY_TEXT_SELECTION_READ_FAILED');
  }

  const selections = normalizeCurrentVideoPrimaryTextSelections(
    stored?.[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY],
  );
  const merged = {
    ...selections,
    [partKey]: selectedSourceIdentityKey,
  };

  try {
    await storage.set({
      [CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY]: merged,
    });
  } catch {
    throw new Error('PRIMARY_TEXT_SELECTION_WRITE_FAILED');
  }

  let readbackStored: Record<string, unknown>;
  try {
    readbackStored = await storage.get(CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY);
  } catch {
    throw new Error('PRIMARY_TEXT_SELECTION_READBACK_FAILED');
  }
  const readback = normalizeCurrentVideoPrimaryTextSelections(
    readbackStored?.[CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY],
  );
  const readbackMatches = Object.entries(merged).every(
    ([key, value]) => readback[key] === value,
  );
  if (!readbackMatches) {
    throw new Error('PRIMARY_TEXT_SELECTION_READBACK_MISMATCH');
  }

  return {
    partKey,
    selectedSourceIdentityKey,
    selections: readback,
  };
}

function enqueueSelectionMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const operation = selectionMutationTail.then(mutation, mutation);
  selectionMutationTail = operation.then(() => undefined, () => undefined);
  return operation;
}
