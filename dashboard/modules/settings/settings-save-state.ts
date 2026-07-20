import {
  DEFAULT_CONFIG,
  type AssistantConfig,
  type DynamicBillConfig,
  type UserConfig,
} from '../../../src/shared/types/config.ts';
import { managedSettingsConfigMatches } from '../../../src/shared/settings-managed-config.ts';

export interface SettingsDraft {
  ai: {
    baseURL: string;
    chatModel: string;
    apiKeyInput: string;
    savedApiKey: string;
  };
  assistant: AssistantConfig;
  dynamicBill: DynamicBillConfig;
}

export interface SaveSettingsDraftInput {
  persistedConfig: UserConfig;
  draft: SettingsDraft;
}

export interface SaveSettingsDraftDependencies {
  persist: (config: UserConfig) => Promise<void>;
  applyPersistedConfig: (config: UserConfig) => void;
}

export type SaveSettingsDraftResult =
  | {
    status: 'success';
    draft: SettingsDraft;
    persistedConfig: UserConfig;
    error: '';
  }
  | {
    status: 'failure';
    reason: 'stale_config' | 'persistence_error';
    draft: SettingsDraft;
    persistedConfig: UserConfig;
    error: string;
  };

export function settingsUserConfigFromStorageChange(
  change: { newValue?: unknown } | undefined,
): UserConfig | null {
  if (!change) return null;
  if (change.newValue === undefined || change.newValue === null) {
    return normalizeSettingsUserConfig(DEFAULT_CONFIG);
  }
  if (!change.newValue || typeof change.newValue !== 'object' || Array.isArray(change.newValue)) {
    return null;
  }
  return normalizeSettingsUserConfig(change.newValue as Partial<UserConfig>);
}

export function settingsManagedConfigMatches(
  observed: Partial<UserConfig>,
  current: Partial<UserConfig>,
): boolean {
  const left = normalizeSettingsUserConfig(observed);
  const right = normalizeSettingsUserConfig(current);
  return managedSettingsConfigMatches(left, right);
}

export async function saveSettingsDraft(
  input: SaveSettingsDraftInput,
  dependencies: SaveSettingsDraftDependencies,
): Promise<SaveSettingsDraftResult> {
  const persistedConfig = normalizeSettingsUserConfig(input.persistedConfig);
  const nextConfig = normalizeSettingsUserConfig({
    ...persistedConfig,
    ai: {
      baseURL: input.draft.ai.baseURL.trim(),
      chatModel: input.draft.ai.chatModel.trim(),
      apiKey: input.draft.ai.apiKeyInput.trim() || persistedConfig.ai.apiKey,
    },
    assistant: input.draft.assistant,
    dynamicBill: input.draft.dynamicBill,
  });

  try {
    await dependencies.persist(nextConfig);
  } catch (error) {
    return {
      status: 'failure',
      reason: error instanceof Error && error.message === 'LOCAL_SETTINGS_STALE_CONFIG'
        ? 'stale_config'
        : 'persistence_error',
      draft: input.draft,
      persistedConfig,
      error: formatSettingsError(error),
    };
  }

  dependencies.applyPersistedConfig(nextConfig);
  return {
    status: 'success',
    draft: draftFromPersistedConfig(nextConfig),
    persistedConfig: nextConfig,
    error: '',
  };
}

export function normalizeSettingsUserConfig(config: Partial<UserConfig>): UserConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    ai: {
      ...DEFAULT_CONFIG.ai,
      ...(config.ai ?? {}),
    },
    assistant: normalizeAssistantConfig(config.assistant),
    dynamicBill: normalizeDynamicBillConfig(config.dynamicBill),
  };
}

export function formatSettingsError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const retained = '设置未保存，当前输入已保留。';
  if (message === 'LOCAL_SETTINGS_STALE_CONFIG') {
    return `${retained} 本地 AI 设置已在其他页面更新，请刷新后重试。`;
  }
  if (message === 'AI_BASE_URL_INVALID') return `${retained} AI 服务地址格式不正确。`;
  if (message === 'AI_BASE_URL_UNSUPPORTED') return `${retained} AI 服务地址只支持 http 或 https。`;
  if (message === 'AI_HTTP_HOST_UNSUPPORTED') return `${retained} HTTP 服务地址仅限本机调试地址。`;
  if (message === 'AI_PERMISSION_DENIED') return `${retained} 没有获得该 AI 服务地址的访问权限。`;
  return `${retained} 请检查服务地址、模型名和浏览器授权后重试。`;
}

function draftFromPersistedConfig(config: UserConfig): SettingsDraft {
  return {
    ai: {
      baseURL: config.ai.baseURL,
      chatModel: config.ai.chatModel,
      apiKeyInput: '',
      savedApiKey: config.ai.apiKey,
    },
    assistant: config.assistant,
    dynamicBill: config.dynamicBill,
  };
}

function normalizeAssistantConfig(config: Partial<AssistantConfig> | undefined): AssistantConfig {
  return {
    currentVideoAiAssistantEnabled: config?.currentVideoAiAssistantEnabled === true,
    smartFavoritesQaAiEnabled: config?.smartFavoritesQaAiEnabled === true,
  };
}

function normalizeDynamicBillConfig(config: Partial<DynamicBillConfig> | undefined): DynamicBillConfig {
  return {
    aiExplanationsEnabled: config?.aiExplanationsEnabled === true,
  };
}
