import type { UserConfig } from './types/config.ts';

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
