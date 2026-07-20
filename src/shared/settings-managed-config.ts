import type { UserConfig } from './types/config.ts';

export const USER_CONFIG_REVISION_STORAGE_KEY = 'userConfigRevision';

export interface SettingsConfigSnapshot {
  config: UserConfig;
  revision: string;
}

export interface SettingsConfigRevisionRecord {
  token: string;
  configPresent: boolean;
  mutation: 'state' | 'save' | 'clear';
}

export function settingsConfigRevisionRecord(value: unknown): SettingsConfigRevisionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<SettingsConfigRevisionRecord>;
  if (typeof raw.token !== 'string' || !raw.token) return null;
  if (typeof raw.configPresent !== 'boolean') return null;
  if (raw.mutation !== 'state' && raw.mutation !== 'save' && raw.mutation !== 'clear') return null;
  return {
    token: raw.token,
    configPresent: raw.configPresent,
    mutation: raw.mutation,
  };
}

export function managedSettingsConfigMatches(
  observed: UserConfig,
  current: UserConfig,
): boolean {
  return observed.ai.baseURL === current.ai.baseURL
    && observed.ai.chatModel === current.ai.chatModel
    && observed.ai.apiKey === current.ai.apiKey
    && observed.assistant.currentVideoAiAssistantEnabled === current.assistant.currentVideoAiAssistantEnabled
    && observed.assistant.smartFavoritesQaAiEnabled === current.assistant.smartFavoritesQaAiEnabled
    && observed.dynamicBill.aiExplanationsEnabled === current.dynamicBill.aiExplanationsEnabled;
}
