import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  loadConfig,
  normalizeUserConfig,
  saveConfig,
} from '../src/background/storage/config-store.ts';

interface MockChromeStorage {
  userConfig?: unknown;
  [key: string]: unknown;
}

test('settings migration keeps service config but does not inherit old current-video switches', async () => {
  const store = installChromeStorageMock({
    userConfig: {
      dailyWatchGoal: 70,
      weeklyWatchGoal: 500,
      overDependencyThreshold: 0.4,
      syncIntervalMinutes: 10,
      retentionDays: 180,
      showSidebar: false,
      theme: 'light',
      ai: {
        baseURL: 'https://api.example.test',
        apiKey: 'saved-key',
        chatModel: 'example-model',
      },
      assistant: {
        aiSummariesEnabled: true,
        currentVideoSegmentRerankAiEnabled: true,
        currentVideoQaAiEnabled: true,
        videoBlindBoxAiEnabled: true,
        smartFavoritesQaAiEnabled: true,
      },
      dynamicBill: {
        aiExplanationsEnabled: true,
      },
    },
  });

  const config = await loadConfig();

  assert.equal(config.ai.baseURL, 'https://api.example.test');
  assert.equal(config.ai.apiKey, 'saved-key');
  assert.equal(config.ai.chatModel, 'example-model');
  assert.equal(config.assistant.currentVideoAiAssistantEnabled, false);
  assert.equal(config.assistant.smartFavoritesQaAiEnabled, true);
  assert.equal(config.dynamicBill.aiExplanationsEnabled, true);
  assert.equal('aiSummariesEnabled' in config.assistant, false);
  assert.equal('currentVideoSegmentRerankAiEnabled' in config.assistant, false);
  assert.equal('currentVideoQaAiEnabled' in config.assistant, false);
  assert.equal('videoBlindBoxAiEnabled' in config.assistant, false);

  const persisted = store.userConfig as ReturnType<typeof normalizeUserConfig>;
  assert.equal(persisted.assistant.currentVideoAiAssistantEnabled, false);
  assert.equal('currentVideoQaAiEnabled' in persisted.assistant, false);
});

test('settings save preserves a saved API key when updating feature switches', async () => {
  const store = installChromeStorageMock({
    userConfig: normalizeUserConfig({
      ai: {
        baseURL: 'https://api.example.test',
        apiKey: 'saved-key',
        chatModel: 'old-model',
      },
      assistant: {
        currentVideoAiAssistantEnabled: false,
        smartFavoritesQaAiEnabled: false,
      },
      dynamicBill: {
        aiExplanationsEnabled: false,
      },
    }),
  });

  await saveConfig({
    ai: {
      baseURL: 'https://api.example.test',
      apiKey: 'saved-key',
      chatModel: 'new-model',
    },
    assistant: {
      currentVideoAiAssistantEnabled: true,
      smartFavoritesQaAiEnabled: true,
    },
  });

  const persisted = store.userConfig as ReturnType<typeof normalizeUserConfig>;
  assert.equal(persisted.ai.apiKey, 'saved-key');
  assert.equal(persisted.ai.chatModel, 'new-model');
  assert.equal(persisted.assistant.currentVideoAiAssistantEnabled, true);
  assert.equal(persisted.assistant.smartFavoritesQaAiEnabled, true);
  assert.equal('videoBlindBoxAiEnabled' in persisted.assistant, false);
});

test('settings save failure keeps every draft field and reports that it is unsaved', async () => {
  const source = await readFile(
    new URL('../dashboard/modules/settings/SettingsPage.tsx', import.meta.url),
    'utf8',
  );
  const saveFunction = source.match(
    /async function saveSettings\(\)[\s\S]*?\n  async function testConnection/,
  )?.[0];
  assert.ok(saveFunction, 'saveSettings should remain executable from the settings page');

  const catchBody = saveFunction.match(/} catch \(err\) \{([\s\S]*?)\n    } finally/)?.[1];
  assert.ok(catchBody, 'saveSettings should expose a failure branch');
  assert.doesNotMatch(
    catchBody,
    /\b(?:refreshConfig|applyConfig|setForm|setAssistant|setDynamicBill)\s*\(/,
    'a failed save must not replace service, model, key, or toggle drafts',
  );
  assert.match(source, /设置未保存[^'"\n]*当前输入已保留/);
});

function installChromeStorageMock(initial: MockChromeStorage): MockChromeStorage {
  const store: MockChromeStorage = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys?: string | string[]) => {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map(key => [key, store[key]]));
          }
          return { ...store };
        },
        set: async (value: Record<string, unknown>) => {
          Object.assign(store, value);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete store[key];
          }
        },
      },
    },
  } as typeof chrome;
  return store;
}
