import { signal, computed } from '@preact/signals';
import type { QuickStats } from '../src/shared/types/analytics';
import type { SyncNowResult, SyncProgress } from '../src/shared/types/messages';

export const quickStats = signal<QuickStats | null>(null);
export const loading = signal(true);
export const error = signal<string | null>(null);
export const lastSyncResult = signal<SyncNowResult | null>(null);
export const syncInProgress = signal(false);
export const syncProgress = signal<SyncProgress | null>(null);

export const completionPercent = computed(() => {
  const stats = quickStats.value;
  if (!stats) return 0;
  return Math.round(stats.avgCompletion * 100);
});

export const todayPercent = computed(() => {
  const stats = quickStats.value;
  if (!stats || stats.dailyGoal === 0) return 0;
  return Math.round((stats.todayWatchTime / stats.dailyGoal) * 100);
});
