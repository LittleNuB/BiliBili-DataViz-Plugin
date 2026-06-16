import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCurrentVideoContext } from '../src/content/player-monitor/current-video-context.ts';

test('collects Bilibili video metadata and source availability from page runtime state', async () => {
  setMockPage('https://www.bilibili.com/video/BV1CurrentCtx9?p=2', {
    videoData: {
      aid: 8848,
      bvid: 'BV1CurrentCtx9',
      title: 'Mock current video',
      duration: 600,
      desc: 'Visible description text',
      owner: { mid: 42, name: 'Mock UP' },
      pages: [
        { page: 1, cid: 1001, part: 'Intro', duration: 120 },
        { page: 2, cid: 1002, part: 'Main part', duration: 480 },
      ],
    },
  });

  const context = await collectCurrentVideoContext({
    fetchViewInfo: async () => null,
  });

  assert.equal(context.kind, 'video');
  assert.equal(context.bvid, 'BV1CurrentCtx9');
  assert.equal(context.kind === 'video' ? context.aid : null, 8848);
  assert.equal(context.kind === 'video' ? context.cid : null, 1002);
  assert.equal(context.kind === 'video' ? context.title : null, 'Mock current video');
  assert.equal(context.kind === 'video' ? context.authorName : null, 'Mock UP');
  assert.equal(context.kind === 'video' ? context.authorMid : null, 42);
  assert.equal(context.kind === 'video' ? context.currentPart.page : null, 2);
  assert.equal(context.kind === 'video' ? context.parts.length : null, 2);
  assert.equal(context.kind === 'video' ? context.sources.metadata : null, 'available');
  assert.equal(context.kind === 'video' ? context.sources.description : null, 'available');
  assert.equal(context.kind === 'video' ? context.sources.pages : null, 'available');
  assert.equal(context.kind === 'video' ? context.sources.transcript : null, 'unknown');
  assert.equal(context.kind === 'video' ? context.sources.contentText : null, 'unavailable');
  assert.equal(context.kind === 'video' ? context.subtitleProbe : null, null);
  assert.equal(context.kind === 'video' ? context.description.text : null, 'Visible description text');
  assert.equal(context.kind === 'video' ? context.warnings.includes('cid_source_initial_state') : false, true);
});

test('marks missing description and transcript as unavailable without summary claims', async () => {
  setMockPage('https://www.bilibili.com/video/BV1NoTextCtx9', {
    videoData: {
      bvid: 'BV1NoTextCtx9',
      title: 'Metadata only video',
      owner: { mid: 7, name: 'Metadata UP' },
    },
  });

  const context = await collectCurrentVideoContext({
    fetchViewInfo: async () => null,
  });

  assert.equal(context.kind, 'video');
  assert.equal(context.kind === 'video' ? context.sources.description : null, 'unavailable');
  assert.equal(context.kind === 'video' ? context.sources.contentText : null, 'unavailable');
  assert.equal(context.kind === 'video' ? context.sources.transcript : null, 'unknown');
  assert.equal(context.kind === 'video' ? context.description.text : null, null);
  assert.deepEqual(context.kind === 'video' ? context.warnings.includes('transcript_probe_pending') : false, true);
});

test('returns no-context fallback outside Bilibili video pages', async () => {
  setMockPage('https://www.bilibili.com/', {});

  const context = await collectCurrentVideoContext();

  assert.equal(context.kind, 'no_context');
  assert.equal(context.kind === 'no_context' ? context.reason : null, 'non_video_page');
  assert.equal(context.kind === 'no_context' ? context.pageType : null, 'non_video');
});

test('ignores stale initial-state CID when URL BVID differs and uses view API pages', async () => {
  setMockPage('https://www.bilibili.com/video/BV1FreshCid9?p=2', {
    videoData: {
      bvid: 'BV1OldState99',
      cid: 1111,
      title: 'Old page state',
      pages: [
        { page: 1, cid: 1111, part: 'Old part' },
      ],
    },
  });

  const context = await collectCurrentVideoContext({
    fetchViewInfo: async (bvid) => {
      assert.equal(bvid, 'BV1FreshCid9');
      return {
        aid: 9002,
        bvid,
        title: 'Fresh video',
        owner: { mid: 8, name: 'Fresh UP' },
        pages: [
          { page: 1, cid: 2001, part: 'Fresh intro' },
          { page: 2, cid: 2002, part: 'Fresh current' },
        ],
      };
    },
  });

  assert.equal(context.kind, 'video');
  assert.equal(context.kind === 'video' ? context.bvid : null, 'BV1FreshCid9');
  assert.equal(context.kind === 'video' ? context.cid : null, 2002);
  assert.equal(context.kind === 'video' ? context.aid : null, 9002);
  assert.equal(context.kind === 'video' ? context.title : null, 'Fresh video');
  assert.equal(context.kind === 'video' ? context.currentPart.title : null, 'Fresh current');
  assert.equal(context.kind === 'video' ? context.warnings.includes('state_bvid_mismatch') : false, true);
  assert.equal(context.kind === 'video' ? context.warnings.includes('cid_source_view_api') : false, true);
});

test('uses player.getVideoInfo fallback when initial state has no CID', async () => {
  setMockPage('https://www.bilibili.com/video/BV1PlayerCid9?p=2', {});

  const context = await collectCurrentVideoContext({
    readPageRuntime: async () => ({
      initialState: {
        videoData: {
          bvid: 'BV1PlayerCid9',
          title: 'Initial title',
        },
      },
      playerInfo: {
        aid: 3030,
        bvid: 'BV1PlayerCid9',
        cid: 3032,
        page: 2,
        pages: [
          { page: 1, cid: 3031, part: 'Part 1' },
          { page: 2, cid: 3032, part: 'Part 2' },
        ],
      },
    }),
  });

  assert.equal(context.kind, 'video');
  assert.equal(context.kind === 'video' ? context.cid : null, 3032);
  assert.equal(context.kind === 'video' ? context.aid : null, 3030);
  assert.equal(context.kind === 'video' ? context.currentPart.page : null, 2);
  assert.equal(context.kind === 'video' ? context.warnings.includes('cid_source_player_info') : false, true);
});

test('does not reuse page-1 direct CID for URL p=2 when pages are missing', async () => {
  setMockPage('https://www.bilibili.com/video/BV1MultiNoPages?p=2', {
    videoData: {
      bvid: 'BV1MultiNoPages',
      cid: 4041,
      title: 'Direct CID only',
    },
  });

  const context = await collectCurrentVideoContext({
    fetchViewInfo: async () => null,
  });

  assert.equal(context.kind, 'video');
  assert.equal(context.kind === 'video' ? context.cid : null, null);
  assert.equal(context.kind === 'video' ? context.warnings.includes('cid_unknown') : false, true);
});

function setMockPage(url: string, initialState: unknown): void {
  const parsed = new URL(url);
  const documentMock = {
    title: 'Mock title_bilibili',
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  Object.defineProperty(globalThis, 'location', {
    value: parsed,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: documentMock,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { __INITIAL_STATE__: initialState },
    configurable: true,
  });
}
