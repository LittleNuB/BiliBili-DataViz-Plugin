import type { BiliVizRequest, BiliVizResponse, RequestAction } from '../../src/shared/types/messages';

export async function requestSW<T = unknown>(
  action: RequestAction,
  params?: Record<string, unknown>,
): Promise<T> {
  const message: BiliVizRequest = { action, params };
  const response: BiliVizResponse<T> = await chrome.runtime.sendMessage(message);

  if (!response || !response.success) {
    throw new Error(response?.error ?? `请求 ${action} 失败`);
  }

  return response.data as T;
}
