import assert from 'node:assert/strict';
import test from 'node:test';
import type { HistoryCursorItem, VideoInfo } from '../src/shared/types/video-info.ts';
import { executeHistorySync } from '../src/background/sync/history-sync-executor.ts';
import { classifyHistoryItemForSync, shouldUseAvidCidViewAtFallback } from '../src/background/sync/history-sync-item.ts';

function createHistoryItem(overrides: Partial<HistoryCursorItem> = {}): HistoryCursorItem {
  return {
    kid: overrides.kid ?? 1,
    avid: overrides.avid,
    bvid: overrides.bvid ?? '',
    cid: overrides.cid,
    title: overrides.title ?? 'test',
    author_name: overrides.author_name ?? 'tester',
    author_mid: overrides.author_mid ?? 1,
    view_at: overrides.view_at ?? 1_717_000_000,
    progress: overrides.progress ?? 120,
    duration: overrides.duration ?? 300,
    business: overrides.business ?? 'archive',
    cover: overrides.cover ?? '',
    tag_name: overrides.tag_name ?? '',
    tags: overrides.tags ?? '',
    device: overrides.device,
    is_fav: overrides.is_fav ?? 0,
    dt: overrides.dt ?? 0,
    history: overrides.history,
  };
}

function createVideoInfo(bvid: string): VideoInfo {
  return {
    avid: 100,
    bvid,
    title: `info:${bvid}`,
    duration: 300,
    owner: {
      mid: 1,
      name: 'tester',
      face: '',
    },
    tname: '',
    tags: [],
    pic: '',
    stat: {
      view: 0,
      danmaku: 0,
      reply: 0,
      favorite: 0,
      coin: 0,
      share: 0,
      like: 0,
    },
  };
}

test('full sync reconciles mixed archive/live pages to fetched count and reaches API end', async () => {
  const page1 = [
    createHistoryItem({ kid: 1, avid: 201, bvid: 'BV1A', cid: 301, view_at: 1_717_000_000, business: 'archive' }),
    createHistoryItem({ kid: 2, avid: 0, bvid: '', cid: 0, view_at: 1_716_999_000, business: 'live' }),
  ];
  const page2 = [
    createHistoryItem({ kid: 3, avid: 202, bvid: 'BV1B', cid: 302, view_at: 1_716_998_000, business: 'archive' }),
    createHistoryItem({ kid: 4, avid: 0, bvid: '', cid: 0, view_at: 1_716_997_000, business: 'article' }),
    createHistoryItem({ kid: 5, avid: 0, bvid: '', cid: 0, view_at: 1_716_996_000, business: 'archive' }),
    createHistoryItem({ kid: 6, avid: 203, bvid: 'BV1C', cid: 303, view_at: 1_716_995_000, business: 'archive' }),
  ];

  const responses = [
    {
      list: page1,
      cursor: { max: 11, view_at: 1_716_999_000, business: 'archive', has_more: true },
    },
    {
      list: page2,
      cursor: { max: 7, view_at: 1_716_995_000, business: 'archive', has_more: true },
    },
    {
      list: [],
      cursor: { max: 0, view_at: 0, business: '', has_more: false },
    },
  ];

  let pageIndex = 0;
  const storedKids = new Set<number>([3]);
  const insertedKids: number[] = [];

  const { result } = await executeHistorySync(
    {
      mode: 'full',
      pageLimit: 10,
      requestedPageLimit: 10,
    },
    {
      async fetchPage() {
        const response = responses[pageIndex];
        pageIndex++;
        return response;
      },
      async isCancelRequested() {
        return false;
      },
      async isStored(item) {
        return storedKids.has(item.kid);
      },
      async updateDeviceTypes() {
        return 0;
      },
      async fetchVideoInfo(bvids) {
        return new Map<string, VideoInfo>(bvids.map(bvid => [bvid, createVideoInfo(bvid)]));
      },
      async insertRecords(records) {
        for (const record of records) {
          insertedKids.push(record.kid);
          storedKids.add(record.kid);
        }
      },
      async delay() {
        return;
      },
    },
  );

  assert.equal(result.fetchedPages, 2);
  assert.equal(result.fetchedCount, 6);
  assert.equal(result.insertedCount, 2);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.liveExcludedCount, 1);
  assert.equal(result.unsupportedBusinessCount, 1);
  assert.equal(result.missingIdCount, 1);
  assert.equal(result.skippedCount, 4);
  assert.equal(result.stoppedReason, 'api_end_empty_page');
  assert.equal(result.reachedEnd, true);
  assert.deepEqual(insertedKids, [1, 6]);
  assert.equal(
    result.insertedCount
      + result.duplicateCount
      + result.liveExcludedCount
      + result.unsupportedBusinessCount
      + result.missingIdCount,
    result.fetchedCount,
  );
});

test('live and missing-id entries are classified instead of entering fallback dedup', () => {
  const liveItem = createHistoryItem({
    kid: 10,
    avid: 0,
    bvid: '',
    cid: 0,
    view_at: 1_717_000_100,
    business: 'live',
  });
  const bvidOnlyArchiveItem = createHistoryItem({
    kid: 11,
    avid: 0,
    bvid: 'BV1ONLY',
    cid: 0,
    view_at: 1_717_000_100,
    business: 'archive',
  });

  assert.equal(classifyHistoryItemForSync(liveItem).reason, 'live_excluded');
  assert.equal(classifyHistoryItemForSync(bvidOnlyArchiveItem).action, 'store');
  assert.equal(shouldUseAvidCidViewAtFallback(liveItem), false);
  assert.equal(shouldUseAvidCidViewAtFallback(bvidOnlyArchiveItem), false);
});
