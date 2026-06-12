export const API_BASE = 'https://api.bilibili.com';
export const HISTORY_ENDPOINT = '/x/web-interface/history/cursor';
export const VIDEO_INFO_ENDPOINT = '/x/web-interface/view';
export const NAV_ENDPOINT = '/x/web-interface/nav';
export const FAVORITE_FOLDERS_ENDPOINT = '/x/v3/fav/folder/created/list-all';
export const FAVORITE_RESOURCES_ENDPOINT = '/x/v3/fav/resource/list';
export const DYNAMIC_FEED_ENDPOINT = '/x/polymer/web-dynamic/v1/feed/all';
export const FOLLOWINGS_ENDPOINT = '/x/relation/followings';

export const HISTORY_PAGE_SIZE = 30;
export const MAX_BACKFILL_PAGES = 300;
export const FAVORITE_PAGE_SIZE = 20;
export const MAX_FAVORITE_SYNC_PAGES = 500;
export const FAVORITE_SHORT_PAGE_RETRY_LIMIT = 2;
export const DYNAMIC_UPDATE_WINDOW_DAYS = 7;
export const DYNAMIC_FEED_MAX_PAGES = 80;
export const FOLLOWING_PAGE_SIZE = 50;
export const MAX_FOLLOWING_SYNC_PAGES = 200;
export const SYNC_INTERVAL_MINUTES = 5;
export const AGGREGATE_INTERVAL_MINUTES = 60;
export const CLEANUP_INTERVAL_MINUTES = 1440;
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 60_000;

export const RATE_LIMIT_TOKENS_PER_SEC = 5;
export const RATE_LIMIT_MAX_BURST = 10;

export const VIDEO_INFO_CACHE_MS = 12 * 60 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 5000;

export const BILI_PINK = '#FB7299';
export const BILI_BLUE = '#00A1D6';

export const DURATION_BUCKETS = [
  { label: '<3分钟', min: 0, max: 180 },
  { label: '3-10分钟', min: 180, max: 600 },
  { label: '10-30分钟', min: 600, max: 1800 },
  { label: '30-60分钟', min: 1800, max: 3600 },
  { label: '>60分钟', min: 3600, max: Infinity },
];

export const COMPLETION_BUCKETS = [
  { label: '25%以下', range: [0, 0.25] as [number, number] },
  { label: '25%-50%', range: [0.25, 0.5] as [number, number] },
  { label: '50%-75%', range: [0.5, 0.75] as [number, number] },
  { label: '75%-100%', range: [0.75, 1.0] as [number, number] },
];

export const CHART_COLORS = [
  '#FB7299', '#00A1D6', '#FFB347', '#7B68EE',
  '#00D4AA', '#FF6B6B', '#4ECDC4', '#FFE66D',
  '#A888FF', '#FF8A5C',
];

export const HOUR_LABELS = [
  '0时', '1时', '2时', '3时', '4时', '5时', '6时', '7时', '8时', '9时',
  '10时', '11时', '12时', '13时', '14时', '15时', '16时', '17时', '18时', '19时',
  '20时', '21时', '22时', '23时',
];

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
