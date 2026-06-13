import type { AiConfig } from '../../shared/types/config.ts';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const AI_REQUEST_TIMEOUT_MS = 60_000;

export async function chatJson<T>(
  config: AiConfig,
  messages: ChatMessage[],
): Promise<T> {
  if (!config.apiKey.trim()) {
    throw new Error('AI_API_KEY_MISSING');
  }

  const endpoint = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.chatModel,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AI_REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`AI_REQUEST_FAILED_${response.status}`);
  }

  const json: ChatResponse = await response.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  return parseJsonContent<T>(content);
}

function parseJsonContent<T>(content: string): T {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('AI_RESPONSE_INVALID_JSON');
  }
}

