import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCurrentVideoContext } from '../src/content/player-monitor/current-video-context.ts';

test('collects Bilibili video metadata and source availability from page runtime state', () => {
  setMockPage('https://www.bilibili.com/video/BV1CurrentCtx9?p=2', {
    videoData: {
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

  const context = collectCurrentVideoContext();

  assert.equal(context.kind, 'video');
  assert.equal(context.bvid, 'BV1CurrentCtx9');
  assert.equal(context.cid, 1002);
  assert.equal(context.title, 'Mock current video');
  assert.equal(context.authorName, 'Mock UP');
  assert.equal(context.authorMid, 42);
  assert.equal(context.currentPart.page, 2);
  assert.equal(context.parts.length, 2);
  assert.equal(context.sources.metadata, 'available');
  assert.equal(context.sources.description, 'available');
  assert.equal(context.sources.pages, 'available');
  assert.equal(context.sources.transcript, 'unknown');
  assert.equal(context.sources.contentText, 'unavailable');
  assert.equal(context.subtitleProbe, null);
  assert.equal(context.description.text, 'Visible description text');
});

test('marks missing description and transcript as unavailable without summary claims', () => {
  setMockPage('https://www.bilibili.com/video/BV1NoTextCtx9', {
    videoData: {
      bvid: 'BV1NoTextCtx9',
      title: 'Metadata only video',
      owner: { mid: 7, name: 'Metadata UP' },
    },
  });

  const context = collectCurrentVideoContext();

  assert.equal(context.kind, 'video');
  assert.equal(context.sources.description, 'unavailable');
  assert.equal(context.sources.contentText, 'unavailable');
  assert.equal(context.sources.transcript, 'unknown');
  assert.equal(context.description.text, null);
  assert.deepEqual(context.warnings.includes('transcript_probe_pending'), true);
});

test('returns no-context fallback outside Bilibili video pages', () => {
  setMockPage('https://www.bilibili.com/', {});

  const context = collectCurrentVideoContext();

  assert.equal(context.kind, 'no_context');
  assert.equal(context.reason, 'non_video_page');
  assert.equal(context.pageType, 'non_video');
});

function setMockPage(url: string, initialState: unknown): void {
  const parsed = new URL(url);
  const documentMock = {
    title: 'Mock title_bilibili',
    querySelector() {
      return null;
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
