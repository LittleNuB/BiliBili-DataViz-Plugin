import assert from 'node:assert/strict';
import test from 'node:test';
import { biliGet } from '../src/background/api/client.ts';
import { NAV_ENDPOINT } from '../src/shared/constants.ts';

test('WBI-required responses fetch signing material and retry through the static client cycle', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  const responses = [
    { code: -403, message: 'WBI signature required', data: null },
    {
      code: 0,
      message: '0',
      data: {
        wbi_img: {
          img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
        },
      },
    },
    { code: 0, message: '0', data: { accepted: true } },
  ];

  globalThis.fetch = (async (input, init) => {
    const request = new URL(String(input));
    const response = responses[requests.length];
    assert.ok(response, `Unexpected fetch: ${request}`);
    assert.equal(init?.credentials, 'include');
    requests.push(request);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await biliGet<{ accepted: boolean }>('/x/test/wbi-required', {
    keyword: 'build hygiene',
  });

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(
    requests.map(request => request.pathname),
    ['/x/test/wbi-required', NAV_ENDPOINT, '/x/test/wbi-required'],
  );
  assert.equal(requests[0].searchParams.get('w_rid'), null);
  assert.equal(requests[1].search, '');
  assert.equal(requests[2].searchParams.get('keyword'), 'build hygiene');
  assert.match(requests[2].searchParams.get('wts') ?? '', /^\d+$/);
  assert.match(requests[2].searchParams.get('w_rid') ?? '', /^[a-f0-9]{32}$/);
});
