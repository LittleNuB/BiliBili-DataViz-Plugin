import type { SmartFavoriteQaResponse } from '../../shared/types/favorite';
import { getFavoriteFolders, getFavoriteItems, getSmartFavoriteIndexMap } from '../storage/favorite-repo';
import { buildSmartFavoriteQaResponse } from './qa-core';

export async function answerSmartFavoriteQuestion(query: string, limit = 8): Promise<SmartFavoriteQaResponse> {
  const [folders, items, indexes] = await Promise.all([
    getFavoriteFolders(),
    getFavoriteItems(),
    getSmartFavoriteIndexMap(),
  ]);

  return buildSmartFavoriteQaResponse({ query, items, indexes, folders, limit });
}
