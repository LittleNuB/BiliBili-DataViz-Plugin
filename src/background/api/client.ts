import { API_BASE } from '../../shared/constants';
import type { BiliApiResponse } from '../../shared/types/video-info';
import { apiRateLimiter } from './rate-limiter';
import { signWbi } from './wbi-sign';

const WBI_REQUIRED_CODES = [-403, -400];
const REQUEST_TIMEOUT_MS = 30_000;

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

  await apiRateLimiter.acquire();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url.toString());

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
      lastError = normalizeError(e);
      if (lastError.message === 'NOT_LOGGED_IN') throw lastError;
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('API request failed');
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      credentials: 'include',
      referrer: 'https://www.bilibili.com/',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
