import { API_BASE } from '../../shared/constants';
import type { BiliApiResponse } from '../../shared/types/video-info';
import { apiRateLimiter } from './rate-limiter';
import { signWbi } from './wbi-sign';

const WBI_REQUIRED_CODES = [-403, -400];

async function getBilibiliCookies(): Promise<string> {
  const cookies = await chrome.cookies.getAll({ domain: '.bilibili.com' });
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

export async function biliGet<T>(
  path: string,
  params?: Record<string, string>,
  retries = 3,
  withWbi = false,
): Promise<T> {
  const url = new URL(path, API_BASE);

  if (params) {
    const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of sorted) {
      url.searchParams.set(k, v);
    }
  }

  if (withWbi) {
    await signWbi(url.searchParams);
  }

  const cookie = await getBilibiliCookies();
  if (!cookie.includes('SESSDATA')) {
    throw new Error('NOT_LOGGED_IN');
  }

  await apiRateLimiter.acquire();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          Cookie: cookie,
          Referer: 'https://www.bilibili.com/',
          'User-Agent': navigator.userAgent,
        },
      });

      if (response.status === 412) {
        lastError = new Error('RATE_LIMITED');
        await new Promise(r => setTimeout(r, 60_000));
        continue;
      }

      const json: BiliApiResponse<T> = await response.json();

      if (json.code === -101) {
        throw new Error('NOT_LOGGED_IN');
      }

      if (WBI_REQUIRED_CODES.includes(json.code) && !withWbi) {
        return biliGet<T>(path, params, retries - attempt, true);
      }

      if (json.code !== 0) {
        throw new Error(`API Error: ${json.code} ${json.message}`);
      }

      return json.data;
    } catch (e) {
      lastError = e as Error;
      if ((e as Error).message === 'NOT_LOGGED_IN') throw e;
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('API request failed');
}
