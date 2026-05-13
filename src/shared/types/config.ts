export interface UserConfig {
  dailyWatchGoal: number;
  weeklyWatchGoal: number;
  overDependencyThreshold: number;
  syncIntervalMinutes: number;
  retentionDays: number;
  showSidebar: boolean;
  theme: 'dark' | 'light';
}

export const DEFAULT_CONFIG: UserConfig = {
  dailyWatchGoal: 60,
  weeklyWatchGoal: 420,
  overDependencyThreshold: 0.3,
  syncIntervalMinutes: 5,
  retentionDays: 90,
  showSidebar: true,
  theme: 'dark',
};
