export interface UserConfig {
  dailyWatchGoal: number;
  weeklyWatchGoal: number;
  overDependencyThreshold: number;
  syncIntervalMinutes: number;
  retentionDays: number;
  showSidebar: boolean;
  theme: 'dark' | 'light';
  ai: AiConfig;
  assistant: AssistantConfig;
  dynamicBill: DynamicBillConfig;
}

export interface AiConfig {
  baseURL: string;
  apiKey: string;
  chatModel: string;
}

export interface AiConnectionTestResult {
  ok: true;
  model: string;
  checkedAt: number;
  latencyMs: number;
}

export interface AssistantConfig {
  aiSummariesEnabled: boolean;
  smartFavoritesQaAiEnabled: boolean;
  currentVideoSegmentRerankAiEnabled: boolean;
}

export interface DynamicBillConfig {
  aiExplanationsEnabled: boolean;
}

export const DEFAULT_CONFIG: UserConfig = {
  dailyWatchGoal: 60,
  weeklyWatchGoal: 420,
  overDependencyThreshold: 0.3,
  syncIntervalMinutes: 5,
  retentionDays: 90,
  showSidebar: true,
  theme: 'dark',
  ai: {
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    chatModel: 'deepseek-v4-flash',
  },
  assistant: {
    aiSummariesEnabled: false,
    smartFavoritesQaAiEnabled: false,
    currentVideoSegmentRerankAiEnabled: false,
  },
  dynamicBill: {
    aiExplanationsEnabled: false,
  },
};
