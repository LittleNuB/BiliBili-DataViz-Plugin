import type { SmartFavoriteQaResponse } from './favorite';

export type CurrentVideoRelatedFavoritesStatus = 'ready' | 'no_context' | 'no_hint';

export interface CurrentVideoRelatedFavoritesHint {
  query: string;
  sourceLabels: string[];
  limitations: string[];
}

export interface CurrentVideoRelatedFavoritesResponse {
  status: CurrentVideoRelatedFavoritesStatus;
  contextTitle: string | null;
  query: string;
  hintSourceLabels: string[];
  favorites: SmartFavoriteQaResponse | null;
  generatedAt: number;
  limitations: string[];
}
