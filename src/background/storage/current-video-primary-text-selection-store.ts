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
let selectionMutationGeneration = 0;
let selectionMutationDepth = 0;

export interface CurrentVideoPrimaryTextSelectionMutationState {
  generation: number;
  mutating: boolean;
}

export function getCurrentVideoPrimaryTextSelectionMutationState(): CurrentVideoPrimaryTextSelectionMutationState {
  return {
    generation: selectionMutationGeneration,
    mutating: selectionMutationDepth > 0,
  };
}

export function canUseCurrentVideoPrimaryTextSelectionGeneration(
  generation: number | null | undefined,
): boolean {
  return generation === selectionMutationGeneration
    && selectionMutationDepth === 0;
}

export function saveCurrentVideoPrimaryTextSelection(
  input: SaveCurrentVideoPrimaryTextSelectionInput,
  storage: CurrentVideoPrimaryTextSelectionStorage = chrome.storage.local,
): Promise<SaveCurrentVideoPrimaryTextSelectionResult> {
  if (selectionClearDepth > 0) {
    return Promise.reject(new Error('PRIMARY_TEXT_SELECTION_CLEAR_IN_PROGRESS'));
  }
  beginSelectionMutation();
  return enqueueSelectionMutation(() => persistCurrentVideoPrimaryTextSelection(input, storage))
    .finally(endSelectionMutation);
}

export function coordinateCurrentVideoPrimaryTextSelectionClear<T>(
  clear: () => Promise<T>,
): Promise<T> {
  beginSelectionMutation();
  selectionClearDepth += 1;
  const operation = enqueueSelectionMutation(clear);
  return operation.finally(() => {
    selectionClearDepth = Math.max(0, selectionClearDepth - 1);
    endSelectionMutation();
  });
}

export function beginCurrentVideoPrimaryTextSelectionClearWindow(): () => void {
  let ended = false;
  beginSelectionMutation();
  selectionClearDepth += 1;
  return () => {
    if (ended) return;
    ended = true;
    selectionClearDepth = Math.max(0, selectionClearDepth - 1);
    endSelectionMutation();
  };
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

function beginSelectionMutation(): void {
  selectionMutationDepth += 1;
  selectionMutationGeneration += 1;
}

function endSelectionMutation(): void {
  selectionMutationDepth = Math.max(0, selectionMutationDepth - 1);
  selectionMutationGeneration += 1;
}
