import type { AiConfig } from '../../shared/types/config';

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

export async function chatJson<T>(
  config: AiConfig,
  messages: ChatMessage[],
): Promise<T> {
  if (!config.apiKey.trim()) {
    throw new Error('AI_API_KEY_MISSING');
  }

  const endpoint = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(endpoint, {
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
  });

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
  return JSON.parse(raw) as T;
}

