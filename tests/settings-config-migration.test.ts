import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveSettingsDraft,
  settingsManagedConfigMatches,
  settingsUserConfigFromStorageChange,
  type SettingsDraft,
} from '../dashboard/modules/settings/settings-save-state.ts';
import {
  advanceUserConfigRevisionAfterClear,
  loadConfig,
  loadConfigSnapshot,
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

test('settings save rejects a stale expected config after settings were cleared', async () => {
  const initialConfig = normalizeUserConfig({});
  const store = installChromeStorageMock({ userConfig: initialConfig });
  const expected = await loadConfigSnapshot();
  delete store.userConfig;
  await advanceUserConfigRevisionAfterClear();

  await assert.rejects(
    saveConfig({
      ai: {
        ...initialConfig.ai,
        apiKey: 'stale-new-key',
      },
      assistant: {
        ...initialConfig.assistant,
        currentVideoAiAssistantEnabled: true,
      },
    }, expected),
    error => error instanceof Error && error.message === 'LOCAL_SETTINGS_STALE_CONFIG',
  );
  assert.equal(store.userConfig, undefined);
});

test('concurrent settings pages serialize compare-and-save and reject the stale second page', async () => {
  const initialConfig = normalizeUserConfig({});
  const store = installChromeStorageMock({ userConfig: initialConfig });
  const expected = await loadConfigSnapshot();

  const [first, second] = await Promise.allSettled([
    saveConfig({
      ai: { ...initialConfig.ai, apiKey: 'first-page-key' },
      assistant: initialConfig.assistant,
      dynamicBill: initialConfig.dynamicBill,
    }, expected),
    saveConfig({
      ai: { ...initialConfig.ai, apiKey: 'second-page-key' },
      assistant: initialConfig.assistant,
      dynamicBill: initialConfig.dynamicBill,
    }, expected),
  ]);

  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  if (second.status === 'rejected') {
    assert.equal(second.reason instanceof Error && second.reason.message, 'LOCAL_SETTINGS_STALE_CONFIG');
  }
  assert.equal((store.userConfig as ReturnType<typeof normalizeUserConfig>).ai.apiKey, 'first-page-key');
});

test('settings storage removal resets a stale page before a later save', async () => {
  const staleObservedConfig = normalizeUserConfig({
    ai: {
      baseURL: 'https://stale.example.test',
      apiKey: 'stale-key',
      chatModel: 'stale-model',
    },
    assistant: {
      currentVideoAiAssistantEnabled: true,
      smartFavoritesQaAiEnabled: false,
    },
    dynamicBill: { aiExplanationsEnabled: true },
  });
  const clearedConfig = settingsUserConfigFromStorageChange({ newValue: undefined });
  assert.ok(clearedConfig);
  assert.equal(clearedConfig.ai.apiKey, '');
  assert.equal(clearedConfig.assistant.currentVideoAiAssistantEnabled, false);
  assert.equal(clearedConfig.dynamicBill.aiExplanationsEnabled, false);
  assert.equal(settingsUserConfigFromStorageChange(undefined), null);
  assert.equal(settingsUserConfigFromStorageChange({ newValue: 'invalid' }), null);
  assert.equal(settingsManagedConfigMatches(staleObservedConfig, clearedConfig), false);
  assert.equal(settingsManagedConfigMatches(clearedConfig, clearedConfig), true);

  let persistedConfig = clearedConfig;
  const result = await saveSettingsDraft(
    {
      persistedConfig: clearedConfig,
      draft: {
        ai: {
          baseURL: clearedConfig.ai.baseURL,
          chatModel: clearedConfig.ai.chatModel,
          apiKeyInput: '',
          savedApiKey: staleObservedConfig.ai.apiKey,
        },
        assistant: {
          ...clearedConfig.assistant,
          smartFavoritesQaAiEnabled: true,
        },
        dynamicBill: clearedConfig.dynamicBill,
      },
    },
    {
      persist: async config => {
        persistedConfig = config;
      },
      applyPersistedConfig: () => undefined,
    },
  );

  assert.equal(result.status, 'success');
  assert.equal(persistedConfig.ai.apiKey, '');
  assert.equal(persistedConfig.assistant.currentVideoAiAssistantEnabled, false);
  assert.equal(persistedConfig.assistant.smartFavoritesQaAiEnabled, true);
  assert.equal(persistedConfig.dynamicBill.aiExplanationsEnabled, false);
});

test('settings save failure keeps the complete draft and does not apply unpersisted state', async () => {
  const persistedConfig = normalizeUserConfig({
    ai: {
      baseURL: 'https://saved.example.test',
      apiKey: 'saved-key',
      chatModel: 'saved-model',
    },
    assistant: {
      currentVideoAiAssistantEnabled: false,
      smartFavoritesQaAiEnabled: false,
    },
    dynamicBill: {
      aiExplanationsEnabled: false,
    },
  });
  const draft = makeSettingsDraft();
  let appliedConfig = persistedConfig;

  const result = await saveSettingsDraft(
    { persistedConfig, draft },
    {
      persist: async () => {
        throw new Error('raw persistence failure');
      },
      applyPersistedConfig: config => {
        appliedConfig = config;
      },
    },
  );

  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'persistence_error');
  assert.deepEqual(result.draft, draft);
  assert.deepEqual(result.persistedConfig, persistedConfig);
  assert.equal(appliedConfig, persistedConfig);
  assert.match(result.error, /设置未保存，当前输入已保留/);
  assert.doesNotMatch(result.error, /raw persistence failure/);
});

test('settings save classifies a stale persistence conflict', async () => {
  const persistedConfig = normalizeUserConfig({});
  const result = await saveSettingsDraft(
    { persistedConfig, draft: makeSettingsDraft() },
    {
      persist: async () => {
        throw new Error('LOCAL_SETTINGS_STALE_CONFIG');
      },
      applyPersistedConfig: () => undefined,
    },
  );

  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'stale_config');
  assert.match(result.error, /本地 AI 设置已在其他页面更新/);
});

test('settings save success persists and applies the complete draft', async () => {
  const persistedConfig = normalizeUserConfig({
    dailyWatchGoal: 75,
    ai: {
      baseURL: 'https://saved.example.test',
      apiKey: 'saved-key',
      chatModel: 'saved-model',
    },
    assistant: {
      currentVideoAiAssistantEnabled: false,
      smartFavoritesQaAiEnabled: false,
    },
    dynamicBill: {
      aiExplanationsEnabled: false,
    },
  });
  const draft = makeSettingsDraft();
  let persistedPayload: typeof persistedConfig | null = null;
  let appliedConfig = persistedConfig;

  const result = await saveSettingsDraft(
    { persistedConfig, draft },
    {
      persist: async config => {
        persistedPayload = config;
      },
      applyPersistedConfig: config => {
        appliedConfig = config;
      },
    },
  );

  const expectedConfig = {
    ...persistedConfig,
    ai: {
      baseURL: 'https://draft.example.test/v1',
      apiKey: 'draft-key',
      chatModel: 'draft-model',
    },
    assistant: {
      currentVideoAiAssistantEnabled: true,
      smartFavoritesQaAiEnabled: true,
    },
    dynamicBill: {
      aiExplanationsEnabled: true,
    },
  };
  assert.equal(result.status, 'success');
  assert.deepEqual(persistedPayload, expectedConfig);
  assert.deepEqual(appliedConfig, expectedConfig);
  assert.deepEqual(result.persistedConfig, expectedConfig);
  assert.equal(result.draft.ai.apiKeyInput, '');
  assert.equal(result.draft.ai.savedApiKey, 'draft-key');
  assert.equal(result.error, '');
});

function makeSettingsDraft(): SettingsDraft {
  return {
    ai: {
      baseURL: '  https://draft.example.test/v1  ',
      chatModel: '  draft-model  ',
      apiKeyInput: '  draft-key  ',
      savedApiKey: 'saved-key',
    },
    assistant: {
      currentVideoAiAssistantEnabled: true,
      smartFavoritesQaAiEnabled: true,
    },
    dynamicBill: {
      aiExplanationsEnabled: true,
    },
  };
}

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
