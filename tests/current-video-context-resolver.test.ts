import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRENT_VIDEO_CONTEXT_MAX_AGE_MS,
  resolveCurrentVideoTabState,
  type CurrentVideoTabSnapshot,
} from '../src/background/current-video-context-resolver.ts';
import type { CurrentVideoContextResult } from '../src/shared/types/current-video-context.ts';

test('prefers the most recently accessed active normal tab context', () => {
  const tabs: CurrentVideoTabSnapshot[] = [
    {
      id: 11,
      url: 'https://www.bilibili.com/video/BVOlderCtx11',
      active: true,
      lastAccessed: 100,
    },
    {
      id: 22,
      url: 'https://www.bilibili.com/video/BVLatestCtx22?p=2',
      active: true,
      lastAccessed: 200,
    },
  ];
  const contexts = new Map<number, CurrentVideoContextResult>([
    [11, videoContext('https://www.bilibili.com/video/BVOlderCtx11', 'BVOlderCtx11', 1000)],
    [22, videoContext('https://www.bilibili.com/video/BVLatestCtx22?p=2', 'BVLatestCtx22', 1001)],
  ]);

  const resolved = resolveCurrentVideoTabState(tabs, contexts, 2000);

  assert.equal(resolved.tab?.id, 22);
  assert.equal(resolved.context?.kind, 'video');
  assert.equal(resolved.context?.kind === 'video' ? resolved.context.bvid : null, 'BVLatestCtx22');
});

test('keeps non-video fallback when the most recent active tab is not a video page', () => {
  const tabs: CurrentVideoTabSnapshot[] = [
    {
      id: 31,
      url: 'https://www.bilibili.com/',
      active: true,
      lastAccessed: 300,
    },
    {
      id: 32,
      url: 'https://www.bilibili.com/video/BVBackground32',
      active: false,
      lastAccessed: 200,
    },
  ];
  const contexts = new Map<number, CurrentVideoContextResult>([
    [32, videoContext('https://www.bilibili.com/video/BVBackground32', 'BVBackground32', 1000)],
  ]);

  const resolved = resolveCurrentVideoTabState(tabs, contexts, 2000);

  assert.equal(resolved.tab?.id, 31);
  assert.equal(resolved.context, null);
});

test('ignores mismatched or stale contexts for the chosen video tab', () => {
  const tabs: CurrentVideoTabSnapshot[] = [
    {
      id: 41,
      url: 'https://www.bilibili.com/video/BVTarget41',
      active: true,
      lastAccessed: 400,
    },
  ];

  const mismatched = resolveCurrentVideoTabState(
    tabs,
    new Map<number, CurrentVideoContextResult>([
      [41, videoContext('https://www.bilibili.com/video/BVOther41', 'BVOther41', 1000)],
    ]),
    2000,
  );
  assert.equal(mismatched.tab?.id, 41);
  assert.equal(mismatched.context, null);

  const stale = resolveCurrentVideoTabState(
    tabs,
    new Map<number, CurrentVideoContextResult>([
      [41, videoContext('https://www.bilibili.com/video/BVTarget41', 'BVTarget41', 1000)],
    ]),
    1000 + CURRENT_VIDEO_CONTEXT_MAX_AGE_MS + 1,
  );
  assert.equal(stale.tab?.id, 41);
  assert.equal(stale.context, null);
});

test('falls back to the freshest matching video context when tab urls are unavailable', () => {
  const tabs: CurrentVideoTabSnapshot[] = [
    {
      id: 51,
      url: null,
      active: true,
      lastAccessed: 500,
    },
    {
      id: 52,
      url: 'https://www.bilibili.com/video/BVFallback52',
      active: false,
      lastAccessed: 450,
    },
  ];
  const contexts = new Map<number, CurrentVideoContextResult>([
    [52, videoContext('https://www.bilibili.com/video/BVFallback52', 'BVFallback52', 1500)],
  ]);

  const resolved = resolveCurrentVideoTabState(tabs, contexts, 2000);

  assert.equal(resolved.tab?.id, 52);
  assert.equal(resolved.context?.kind, 'video');
  assert.equal(resolved.context?.kind === 'video' ? resolved.context.bvid : null, 'BVFallback52');
});

function videoContext(url: string, bvid: string, collectedAt: number): CurrentVideoContextResult {
  return {
    kind: 'video',
    url,
    collectedAt,
    bvid,
    cid: 100,
    title: 'Resolver test video',
    authorName: 'Resolver UP',
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: 'Main part',
      total: 1,
    },
    parts: [],
    chapters: [],
    description: {
      availability: 'unavailable',
      text: null,
      length: null,
    },
    sources: {
      metadata: 'available',
      description: 'unavailable',
      pages: 'unavailable',
      chapters: 'unknown',
      transcript: 'unavailable',
      contentText: 'unavailable',
    },
    warnings: ['transcript_unavailable'],
  };
}
