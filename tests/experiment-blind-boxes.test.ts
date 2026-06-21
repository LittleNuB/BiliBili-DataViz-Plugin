import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExperimentData } from '../src/background/analytics/suggestions.ts';
import {
  buildVarietyRegionDirections,
  type VarietyRegionCandidatePool,
  type VarietyRegionDirection,
} from '../src/background/api/video-blind-box-candidates.ts';
import type { ExperimentRealCandidatePool } from '../src/shared/types/analytics';
import type { FavoriteItem, SmartFavoriteIndex } from '../src/shared/types/favorite';
import type { WatchHistoryRecord } from '../src/shared/types/watch-event';

const NOW_MS = Date.UTC(2026, 5, 13, 12, 0, 0);

test('builds blind boxes with real random explore and real variety candidate sources', () => {
  const bannedGuessWord = ['猜你', '喜欢'].join('');
  const bannedRankingWord = ['推荐', '排序'].join('');
  const records = createMixedTasteRecords();

  const favorites: FavoriteItem[] = [
    createFavorite({
      itemKey: 'variety-local-only',
      bvid: 'BVFAVVAR1',
      title: '本地收藏不应作为换口味候选',
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
    ['variety-local-only', createSmartIndex('variety-local-only', ['科技', '编程'])],
    ['hidden', createSmartIndex('hidden', ['游戏', '攻略'])],
    ['random', createSmartIndex('random', ['生活', '旅行'])],
  ]);

  const data = buildExperimentData(records, favorites, smartIndexByItemKey, NOW_MS, {
    randomExplorePool: createRelatedPool(),
    varietyRegionPool: createReadyRegionPool(),
  });

  assert.deepEqual(data.blindBoxes.map(box => box.id), [
    'variety',
    'hidden_favorite',
    'revive_interest',
    'random_explore',
  ]);

  const [variety, hiddenFavorite, reviveInterest, randomExplore] = data.blindBoxes;

  assert.equal(variety.state, 'ready');
  assert.equal(variety.statusLabel, '真实候选');
  assert.equal(variety.candidateSource, 'B 站公开分区新视频候选池');
  assert.equal(variety.realCandidateLabel, '已使用真实 B 站候选');
  assert.equal(variety.usesRealBilibiliCandidates, true);
  assert.equal(variety.video?.bvid, 'BV1REAL139A');
  assert.equal(variety.video?.sourceKind, 'bili_region_dynamic');
  assert.notEqual(variety.video?.bvid, 'BVFAVVAR1');
  assert.match(variety.source, /B 站分区新视频/);
  assert.match(variety.reason, /长期看过「知识」/);
  assert.match(variety.reason, /最近 30 天/);
  assert.match(variety.reason, /游戏/);
  assert.ok(variety.evidence.some(line => line.includes('本地历史和收藏只参与选择冷却方向与解释')));

  assert.equal(hiddenFavorite.state, 'ready');
  assert.equal(hiddenFavorite.candidateSource, '本地收藏');
  assert.equal(hiddenFavorite.realCandidateLabel, '未使用真实 B 站候选：这是本地收藏回访。');
  assert.equal(hiddenFavorite.usesRealBilibiliCandidates, false);
  assert.match(hiddenFavorite.source, /^本地收藏/);
  assert.equal(hiddenFavorite.video?.bvid, 'BVFAVHID1');
  assert.equal(hiddenFavorite.video?.sourceKind, 'local_favorite');
  assert.match(hiddenFavorite.reason, /收藏|本地/);

  assert.equal(reviveInterest.state, 'ready');
  assert.equal(reviveInterest.title, '本地兴趣回顾');
  assert.equal(reviveInterest.candidateSource, '本地观看历史');
  assert.equal(reviveInterest.realCandidateLabel, '未使用真实 B 站候选：这是本地历史回顾。');
  assert.equal(reviveInterest.usesRealBilibiliCandidates, false);
  assert.equal(reviveInterest.video?.bvid, 'BVKNO002');
  assert.equal(reviveInterest.video?.sourceKind, 'local_history');
  assert.match(reviveInterest.source, /本地历史/);
  assert.match(reviveInterest.reason, /不是动态账单的兴趣再平衡/);
  assert.match(reviveInterest.reason, /不使用关注新投稿/);

  assert.equal(randomExplore.state, 'ready');
  assert.equal(randomExplore.candidateSource, 'B 站公开视频的相关视频候选池');
  assert.equal(randomExplore.realCandidateLabel, '已使用真实 B 站候选');
  assert.equal(randomExplore.usesRealBilibiliCandidates, true);
  assert.equal(randomExplore.video?.bvid, 'BV1REALRND01');
  assert.equal(randomExplore.video?.sourceKind, 'bilibili_related');
  assert.match(randomExplore.source, /相关视频候选/);
  assert.match(randomExplore.source, /种子视频/);
  assert.match(randomExplore.reason, /公开相关视频候选|随机抽取/);
  assert.notEqual(randomExplore.video?.bvid, variety.video?.bvid);
  assert.notEqual(randomExplore.video?.bvid, hiddenFavorite.video?.bvid);
  assert.notEqual(randomExplore.video?.bvid, reviveInterest.video?.bvid);

  for (const box of data.blindBoxes) {
    assert.equal(box.reason.includes(bannedGuessWord), false);
    assert.equal(box.reason.includes(bannedRankingWord), false);
    assert.ok(box.candidateSource.length > 0);
    assert.ok(box.realCandidateLabel.length > 0);
    assert.ok(box.evidence.length > 0);
    if (box.state === 'ready') {
      assert.ok(box.video);
      assert.match(box.video.url, /^https:\/\/www\.bilibili\.com\/video\//);
      assert.ok(box.video.title.length > 0);
      assert.ok(box.video.authorName.length > 0);
    }
  }
});

test('selects cooled long-term region directions instead of recent high-frequency interests', () => {
  const directions = buildVarietyRegionDirections(createMixedTasteRecords(), { nowMs: NOW_MS });

  assert.ok(directions.length > 0);
  assert.equal(directions[0].regionName, '知识');
  assert.equal(directions[0].label, '知识');
  assert.equal(directions[0].recentPositiveCount, 0);
  assert.ok(directions[0].recentHighLabels.includes('游戏'));
  assert.equal(directions.some(direction => direction.regionName === '游戏'), false);
});

test('returns a clear downgrade when the real region candidate source fails', () => {
  const data = buildExperimentData(
    createMixedTasteRecords(),
    [],
    new Map(),
    NOW_MS,
    {
      randomExplorePool: createRelatedPool(),
      varietyRegionPool: {
        status: 'source_failed',
        sourceLabel: 'B 站分区新视频',
        directions: [createKnowledgeDirection()],
        candidates: [],
        evidence: [
          '长期 180 天里，「知识」有 4 条观看、4 条正向观看。',
          '分区新视频候选源暂时不可用：RATE_LIMITED。',
        ],
        failureReason: 'RATE_LIMITED',
        checkedRegionCount: 1,
        excludedRecentBvidCount: 0,
        excludedInvalidCandidateCount: 0,
      },
    },
  );

  const variety = data.blindBoxes[0];
  assert.equal(variety.id, 'variety');
  assert.equal(variety.state, 'empty');
  assert.equal(variety.statusLabel, '候选源暂不可用');
  assert.equal(variety.candidateSource, 'B 站公开分区新视频候选池');
  assert.match(variety.realCandidateLabel, /未使用真实 B 站候选/);
  assert.equal(variety.usesRealBilibiliCandidates, false);
  assert.equal(variety.source, 'B 站分区新视频');
  assert.match(variety.emptyTitle ?? '', /候选源暂不可用/);
  assert.match(variety.emptyDescription ?? '', /不显示空视频/);
  assert.equal(variety.video, undefined);
});

test('returns Chinese empty states instead of generic filler when local evidence is insufficient', () => {
  const bannedGuessWord = ['猜你', '喜欢'].join('');
  const bannedUnconsumedWord = ['未', '消费'].join('');
  const bannedRankingWord = ['推荐', '排序'].join('');
  const data = buildExperimentData([], [], new Map(), NOW_MS, {
    randomExplorePool: {
      sourceKind: 'bilibili_related',
      sourceLabel: '相关视频候选',
      seedCount: 0,
      candidates: [],
      failures: [],
    },
    varietyRegionPool: {
      status: 'insufficient_local_evidence',
      sourceLabel: 'B 站分区新视频',
      directions: [],
      candidates: [],
      evidence: ['近 180 天本地正向观看 0 条，换口味至少需要 2 条可聚合兴趣证据。'],
      checkedRegionCount: 0,
      excludedRecentBvidCount: 0,
      excludedInvalidCandidateCount: 0,
    },
  });

  assert.equal(data.blindBoxes.length, 4);
  for (const box of data.blindBoxes) {
    assert.equal(box.state, 'empty');
    assert.ok(box.emptyTitle);
    assert.ok(box.emptyDescription);
    assert.ok(box.candidateSource);
    assert.ok(box.realCandidateLabel);
    assert.ok(box.evidence.length > 0);
    assert.equal(box.reason.includes(bannedGuessWord), false);
    assert.equal(box.reason.includes(bannedUnconsumedWord), false);
    assert.equal(box.reason.includes(bannedRankingWord), false);
  }
});

test('does not fall back to a local random video when related candidates fail', () => {
  const records: WatchHistoryRecord[] = [
    createRecord({ bvid: 'BV1LOCAL001', tagName: '游戏', daysAgo: 3, actualCompletion: 0.92, title: '本地种子视频' }),
    createRecord({ bvid: 'BV1LOCAL002', tagName: '游戏', daysAgo: 40, actualCompletion: 0.91, title: '本地备用视频' }),
  ];
  const failedPool: ExperimentRealCandidatePool = {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedCount: 1,
    candidates: [],
    failures: [{
      seedBvid: 'BV1LOCAL001',
      seedTitle: '本地种子视频',
      reason: 'request_failed',
    }],
  };

  const data = buildExperimentData(records, [], new Map(), NOW_MS, failedPool);
  const randomExplore = data.blindBoxes.find(box => box.id === 'random_explore');

  assert.ok(randomExplore);
  assert.equal(randomExplore.state, 'empty');
  assert.equal(randomExplore.video, undefined);
  assert.equal(randomExplore.candidateSource, 'B 站公开视频的相关视频候选池');
  assert.match(randomExplore.realCandidateLabel, /未使用真实 B 站候选/);
  assert.equal(randomExplore.usesRealBilibiliCandidates, false);
  assert.match(randomExplore.source, /相关视频候选/);
  assert.match(randomExplore.emptyDescription ?? '', /不会用本地库存视频冒充/);
  assert.ok(randomExplore.evidence.some(line => line.includes('请求失败')));
});

function createMixedTasteRecords(): WatchHistoryRecord[] {
  return [
    createRecord({ bvid: 'BVREC001', tagName: '游戏', daysAgo: 3, actualCompletion: 0.82, title: '最近游戏 1' }),
    createRecord({ bvid: 'BVREC002', tagName: '游戏', daysAgo: 5, actualCompletion: 0.78, title: '最近游戏 2' }),
    createRecord({ bvid: 'BVREC003', tagName: '游戏', daysAgo: 8, actualCompletion: 0.75, title: '最近游戏 3' }),
    createRecord({ bvid: 'BVREC004', tagName: '游戏', daysAgo: 12, actualCompletion: 0.88, title: '最近游戏 4' }),
    createRecord({ bvid: 'BVREC005', tagName: '游戏', daysAgo: 16, actualCompletion: 0.8, title: '最近游戏 5' }),
    createRecord({ bvid: 'BVREC006', tagName: '游戏', daysAgo: 22, actualCompletion: 0.79, title: '最近游戏 6' }),
    createRecord({ bvid: 'BVKNO001', tagName: '知识', daysAgo: 120, actualCompletion: 0.92, title: '旧兴趣 1' }),
    createRecord({ bvid: 'BVKNO002', tagName: '知识', daysAgo: 145, actualCompletion: 0.94, title: '旧兴趣 2' }),
    createRecord({ bvid: 'BVKNO003', tagName: '知识', daysAgo: 170, actualCompletion: 0.9, title: '旧兴趣 3' }),
    createRecord({ bvid: 'BVKNO004', tagName: '知识', daysAgo: 175, actualCompletion: 0.89, title: '旧兴趣 4' }),
  ];
}

function createReadyRegionPool(): VarietyRegionCandidatePool {
  const direction = createKnowledgeDirection();
  return {
    status: 'ready',
    sourceLabel: 'B 站分区新视频',
    directions: [direction],
    candidates: [
      {
        bvid: 'BV1REAL139A',
        avid: 139001,
        cid: 139002,
        title: '真实分区新视频',
        authorName: '公开知识 UP',
        authorMid: 139003,
        cover: 'https://example.com/real-region.jpg',
        url: 'https://www.bilibili.com/video/BV1REAL139A',
        duration: 900,
        publishedAt: Math.floor(NOW_MS / 1000),
        tagName: '知识',
        sourceKind: 'bili_region_dynamic',
        sourceLabel: 'B 站分区新视频 / 知识',
        regionRid: 36,
        regionName: '知识',
        cooldownLabel: '知识',
      },
    ],
    evidence: [
      '长期 180 天里，「知识」有 4 条观看、4 条正向观看。',
      '近期 30 天里，这个方向正向观看 0 条；按长期节奏预期约 0.7 条。',
      '最近高频口味是：游戏；本次只从冷却方向「知识」分区取新视频候选。',
      '真实候选池返回 1 条可打开视频，已排除最近 90 天本地看过的同 bvid 0 条。',
    ],
    checkedRegionCount: 1,
    excludedRecentBvidCount: 0,
    excludedInvalidCandidateCount: 0,
  };
}

function createKnowledgeDirection(): VarietyRegionDirection {
  return {
    key: 'category:知识:36',
    kind: 'category',
    label: '知识',
    rid: 36,
    regionName: '知识',
    longWatchedCount: 4,
    longPositiveCount: 4,
    recentWatchedCount: 0,
    recentPositiveCount: 0,
    expectedRecentPositive: 0.7,
    cooldownRatio: 0,
    daysSinceLastWatch: 120,
    recentHighLabels: ['游戏'],
    score: 100,
  };
}

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

function createRelatedPool(): ExperimentRealCandidatePool {
  return {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedCount: 2,
    candidates: [{
      sourceKind: 'bilibili_related',
      sourceLabel: '相关视频候选',
      seedBvid: 'BV1SEED0001',
      seedTitle: '种子视频',
      bvid: 'BV1REALRND01',
      avid: 12345,
      cid: 54321,
      title: '真实相关候选视频',
      authorName: '公开候选UP',
      authorMid: 67890,
      cover: 'https://example.com/related.jpg',
      duration: 960,
      pubtime: 1_717_000_000,
      tagName: '科技',
      url: 'https://www.bilibili.com/video/BV1REALRND01',
    }],
    failures: [],
  };
}
