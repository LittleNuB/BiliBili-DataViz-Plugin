import type {
  LocalDataCategoryRegistration,
  LocalDataCategoryUsage,
} from '../../shared/local-data-category-contract.ts';
import { CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY } from '../../shared/current-video-primary-text-selection.ts';
import { coordinateCurrentVideoPrimaryTextSelectionClear } from './current-video-primary-text-selection-store.ts';

const LOCAL_SETTING_STORAGE_KEYS = [
  'userConfig',
  'floatingPopupWindowId',
  CURRENT_VIDEO_PRIMARY_TEXT_SELECTIONS_STORAGE_KEY,
];

export function getLocalSettingsDataCategoryRegistration(): LocalDataCategoryRegistration {
  return {
    id: 'localSettings',
    label: '本地 AI 设置',
    includeInClearAll: true,
    collectUsage: collectLocalSettingsUsage,
    clear: async () => coordinateCurrentVideoPrimaryTextSelectionClear(async () => {
      await chrome.storage.local.remove(LOCAL_SETTING_STORAGE_KEYS);
      return { cleared: { localSettings: true } };
    }),
    readAfterClear: async () => {
      const usage = await collectLocalSettingsUsage();
      return {
        ...usage,
        empty: usage.count === 0 && usage.usageBytes === 0,
      };
    },
  };
}

async function collectLocalSettingsUsage(): Promise<LocalDataCategoryUsage> {
  const stored = await chrome.storage.local.get(LOCAL_SETTING_STORAGE_KEYS);
  const present = Object.fromEntries(
    Object.entries(stored).filter(([, value]) => value !== undefined),
  );
  const count = Object.keys(present).length;
  return {
    count,
    usageBytes: count > 0 ? serializedSize(present) : 0,
  };
}

function serializedSize(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  return typeof TextEncoder === 'undefined' ? text.length : new TextEncoder().encode(text).byteLength;
}
