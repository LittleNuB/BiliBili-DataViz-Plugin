import assert from 'node:assert/strict';
import test from 'node:test';
import { testAiConnection } from '../src/background/ai/openai-compatible.ts';

test('AI connection test sends only a minimal health-check payload', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), 'https://api.test/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
    requestBody = String(init?.body ?? '');
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await testAiConnection({
    baseURL: 'https://api.test/',
    apiKey: 'test-key',
    chatModel: 'test-model',
  });

  const payload = JSON.parse(requestBody);
  const rawPayload = JSON.stringify(payload);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'test-model');
  assert.equal(payload.model, 'test-model');
  assert.equal(payload.messages.length, 2);
  assert.doesNotMatch(rawPayload, /watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i);
});

test('AI connection test requires an API key before network access', async (t) => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error('fetch should not run');
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => testAiConnection({
      baseURL: 'https://api.test',
      apiKey: '',
      chatModel: 'test-model',
    }),
    /AI_API_KEY_MISSING/,
  );
  assert.equal(called, false);
});
