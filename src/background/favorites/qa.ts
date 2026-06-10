import type { AiConfig, UserConfig } from '../../shared/types/config';
import type { SmartFavoriteQaResponse } from '../../shared/types/favorite';
import {
  synthesizeSmartFavoriteQaAnswerFromLocal,
  type SmartFavoriteQaAiResponse,
} from '../../shared/smart-favorites-qa-synthesis';
import { assertAssistantPayloadAudit, smartFavoriteQaPayloadContract } from '../../shared/assistant-payload-audit';
import { chatJson } from '../ai/openai-compatible';
import { loadConfig } from '../storage/config-store';
import { getFavoriteFolders, getFavoriteItems, getSmartFavoriteIndexMap } from '../storage/favorite-repo';
import { buildSmartFavoriteQaResponse } from './qa-core';

export interface AnswerSmartFavoriteQuestionOptions {
  config?: UserConfig;
  chat?: (config: AiConfig, messages: Parameters<typeof chatJson>[1]) => Promise<SmartFavoriteQaAiResponse>;
  now?: number;
}

export async function answerSmartFavoriteQuestion(
  query: string,
  limit = 8,
  options: AnswerSmartFavoriteQuestionOptions = {},
): Promise<SmartFavoriteQaResponse> {
  const [folders, items, indexes] = await Promise.all([
    getFavoriteFolders(),
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
  ]);
  const local = buildSmartFavoriteQaResponse({ query, items, indexes, folders, limit });
  return synthesizeSmartFavoriteQaAnswer(local, options);
}

export async function synthesizeSmartFavoriteQaAnswer(
  local: SmartFavoriteQaResponse,
  options: AnswerSmartFavoriteQuestionOptions = {},
): Promise<SmartFavoriteQaResponse> {
  const config = options.config ?? await loadConfig();
  return synthesizeSmartFavoriteQaAnswerFromLocal(local, {
    config,
    chat: options.chat ?? chatJson,
    auditPayload: payload => assertAssistantPayloadAudit(payload, smartFavoriteQaPayloadContract),
    now: options.now,
  });
}
