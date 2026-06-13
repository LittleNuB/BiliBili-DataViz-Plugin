import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExperimentData } from '../src/background/analytics/suggestions.ts';
import type { FavoriteItem, SmartFavoriteIndex } from '../src/shared/types/favorite';
import type { WatchHistoryRecord } from '../src/shared/types/watch-event';

const NOW_MS = Date.UTC(2026, 5, 13, 12, 0, 0);

test('builds four local blind boxes with concrete video candidates', () => {
  const bannedGuessWord = `猜${'你喜欢'}`;
  const records: WatchHistoryRecord[] = [
    createRecord({ bvid: 'BVREC001', tagName: '游戏', daysAgo: 3, actualCompletion: 0.82, title: '最近游戏 1' }),
    createRecord({ bvid: 'BVREC002', tagName: '游戏', daysAgo: 5, actualCompletion: 0.78, title: '最近游戏 2' }),
    createRecord({ bvid: 'BVREC003', tagName: '游戏', daysAgo: 8, actualCompletion: 0.75, title: '最近游戏 3' }),
    createRecord({ bvid: 'BVREC004', tagName: '游戏', daysAgo: 12, actualCompletion: 0.88, title: '最近游戏 4' }),
    createRecord({ bvid: 'BVREC005', tagName: '游戏', daysAgo: 16, actualCompletion: 0.8, title: '最近游戏 5' }),
    createRecord({ bvid: 'BVREC006', tagName: '游戏', daysAgo: 22, actualCompletion: 0.79, title: '最近游戏 6' }),
    createRecord({ bvid: 'BVKNO001', tagName: '知识', daysAgo: 120, actualCompletion: 0.92, title: '旧兴趣 1' }),
    createRecord({ bvid: 'BVKNO002', tagName: '知识', daysAgo: 145, actualCompletion: 0.94, title: '旧兴趣 2' }),
    createRecord({ bvid: 'BVKNO003', tagName: '知识', daysAgo: 170, actualCompletion: 0.9, title: '旧兴趣 3' }),
    createRecord({ bvid: 'BVKNO004', tagName: '知识', daysAgo: 210, actualCompletion: 0.89, title: '旧兴趣 4' }),
  ];

  const favorites: FavoriteItem[] = [
    createFavorite({
      itemKey: 'variety',
      bvid: 'BVFAVVAR1',
      title: '编程收藏视频',
      folderTitle: '技术夹',
      tagName: '科技',
      favDaysAgo: 240,
    }),
    createFavorite({
      itemKey: 'hidden',
      bvid: 'BVFAVHID1',
      title: '压箱底收藏视频',
      folderTitle: '旧收藏',
      tagName: '游戏',
      favDaysAgo: 360,
    }),
    createFavorite({
      itemKey: 'random',
      bvid: 'BVFAVRND1',
      title: '随机池视频',
      folderTitle: '杂项',
      tagName: '生活',
      favDaysAgo: 120,
    }),
  ];

  const smartIndexByItemKey = new Map<string, SmartFavoriteIndex>([
    ['variety', createSmartIndex('variety', ['科技', '编程'])],
    ['hidden', createSmartIndex('hidden', ['游戏', '攻略'])],
    ['random', createSmartIndex('random', ['生活', '旅行'])],
  ]);

  const data = buildExperimentData(records, favorites, smartIndexByItemKey, NOW_MS);

  assert.deepEqual(data.blindBoxes.map(box => box.id), [
    'variety',
    'hidden_favorite',
    'revive_interest',
    'random_explore',
  ]);

  const [variety, hiddenFavorite, reviveInterest, randomExplore] = data.blindBoxes;

  assert.equal(variety.state, 'ready');
  assert.equal(variety.video?.bvid, 'BVFAVVAR1');
  assert.match(variety.reason, /换口味|主口味|最近 45 天/);

  assert.equal(hiddenFavorite.state, 'ready');
  assert.equal(hiddenFavorite.video?.bvid, 'BVFAVHID1');
  assert.match(hiddenFavorite.reason, /收藏|本地/);

  assert.equal(reviveInterest.state, 'ready');
  assert.equal(reviveInterest.video?.bvid, 'BVKNO002');
  assert.match(reviveInterest.source, /本地历史/);

  assert.equal(randomExplore.state, 'ready');
  assert.ok(randomExplore.video?.bvid);
  assert.notEqual(randomExplore.video?.bvid, variety.video?.bvid);
  assert.notEqual(randomExplore.video?.bvid, hiddenFavorite.video?.bvid);
  assert.notEqual(randomExplore.video?.bvid, reviveInterest.video?.bvid);

  for (const box of data.blindBoxes) {
    assert.equal(box.reason.includes(bannedGuessWord), false);
    assert.ok(box.evidence.length > 0);
    if (box.state === 'ready') {
      assert.ok(box.video);
      assert.match(box.video.url, /^https:\/\/www\.bilibili\.com\/video\//);
      assert.ok(box.video.title.length > 0);
      assert.ok(box.video.authorName.length > 0);
    }
  }
});

test('returns Chinese empty states instead of generic filler when local evidence is insufficient', () => {
  const bannedGuessWord = `猜${'你喜欢'}`;
  const bannedUnconsumedWord = `未${'消费'}`;
  const data = buildExperimentData([], [], new Map(), NOW_MS);

  assert.equal(data.blindBoxes.length, 4);
  for (const box of data.blindBoxes) {
    assert.equal(box.state, 'empty');
    assert.ok(box.emptyTitle);
    assert.ok(box.emptyDescription);
    assert.ok(box.evidence.length > 0);
    assert.equal(box.reason.includes(bannedGuessWord), false);
    assert.equal(box.reason.includes(bannedUnconsumedWord), false);
  }
});

function createRecord(input: {
  bvid: string;
  tagName: string;
  daysAgo: number;
  actualCompletion: number;
  title: string;
}): WatchHistoryRecord {
  const viewedAtSeconds = Math.floor((NOW_MS - input.daysAgo * 86_400_000) / 1000);
  return {
    sessionKey: `${input.bvid}:${viewedAtSeconds}`,
    kid: viewedAtSeconds,
    avid: 1000 + input.daysAgo,
    bvid: input.bvid,
    cid: 2000 + input.daysAgo,
    title: input.title,
    authorName: `${input.tagName}UP`,
    authorMid: input.tagName === '游戏' ? 2001 : 3001,
    tagName: input.tagName,
    tags: [input.tagName],
    cover: `https://example.com/${input.bvid}.jpg`,
    viewAt: viewedAtSeconds,
    progress: Math.round(1800 * input.actualCompletion),
    duration: 1800,
    actualCompletion: input.actualCompletion,
    deviceType: 1,
    isFavorite: false,
    business: 'archive',
    dt: 1800,
    syncedAt: viewedAtSeconds,
  };
}

function createFavorite(input: {
  itemKey: string;
  bvid: string;
  title: string;
  folderTitle: string;
  tagName: string;
  favDaysAgo: number;
}): FavoriteItem {
  const favTime = Math.floor((NOW_MS - input.favDaysAgo * 86_400_000) / 1000);
  return {
    itemKey: input.itemKey,
    mediaId: 1,
    folderTitle: input.folderTitle,
    avid: 9000 + input.favDaysAgo,
    bvid: input.bvid,
    title: input.title,
    intro: `${input.title} 简介`,
    authorName: `${input.tagName}收藏UP`,
    authorMid: 5000 + input.favDaysAgo,
    tagName: input.tagName,
    tags: [input.tagName],
    cover: `https://example.com/${input.bvid}.jpg`,
    duration: 1200,
    pubtime: favTime - 86_400,
    favTime,
    syncedAt: favTime,
  };
}

function createSmartIndex(itemKey: string, path: string[]): SmartFavoriteIndex {
  return {
    itemKey,
    path,
    summary: `${path.join(' / ')} 分类`,
    keywords: path,
    aliases: [],
    searchableText: path.join(' '),
    contentHash: itemKey,
    model: 'test-model',
    status: 'indexed',
    indexedAt: Math.floor(NOW_MS / 1000),
  };
}
