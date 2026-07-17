import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildExperimentData } from '../src/background/analytics/suggestions.ts';
import {
  buildCrossRegionSourceFailure,
  buildRecentHighFrequencyRegions,
  buildRelatedVideoSourceFailure,
  selectCrossRegion,
  type CreatorArchiveCandidatePool,
  type CrossRegionCandidatePool,
} from '../src/background/api/video-blind-box-candidates.ts';
import type {
  ExperimentBlindBox,
  ExperimentRealCandidatePool,
  ExperimentRealVideoCandidate,
  ExperimentVideoCandidate,
} from '../src/shared/types/analytics';
import type { FavoriteItem, SmartFavoriteIndex } from '../src/shared/types/favorite';
import type { WatchHistoryRecord } from '../src/shared/types/watch-event';

const NOW_MS = Date.UTC(2026, 5, 13, 12, 0, 0);

test('builds fixed blind boxes with source labels for all four 0.13 sources', () => {
  const records = createRecentRegionRecords();
  const favorites: FavoriteItem[] = [
    createFavorite({
      itemKey: 'hidden',
      bvid: 'BVFAVHID1',
      title: '压箱底收藏视频',
      folderTitle: '旧收藏',
      tagName: '游戏',
      favDaysAgo: 360,
    }),
  ];
  const smartIndexByItemKey = new Map<string, SmartFavoriteIndex>([
    ['hidden', createSmartIndex('hidden', ['游戏', '攻略'])],
  ]);

  const data = buildExperimentData(records, favorites, smartIndexByItemKey, NOW_MS, {
    randomExplorePool: createRelatedPool(),
    crossRegionPool: createReadyCrossRegionPool(),
    creatorArchivePool: createReadyCreatorArchivePool(),
  });

  assert.deepEqual(data.blindBoxes.map(box => box.id), [
    'random_explore',
    'cross_region',
    'hidden_favorite',
    'creator_archive',
  ]);

  const [randomExplore, crossRegion, hiddenFavorite, creatorArchive] = data.blindBoxes;

  assert.equal(randomExplore.title, '随机探索');
  assert.equal(randomExplore.state, 'ready');
  assert.equal(randomExplore.candidateSource, 'B 站公开视频的相关视频候选池');
  assert.equal(randomExplore.realCandidateLabel, '已使用真实 B 站候选');
  assert.equal(randomExplore.usesRealBilibiliCandidates, true);
  assert.equal(randomExplore.video?.bvid, 'BV1REALRND01');
  assert.equal(randomExplore.video?.sourceKind, 'bilibili_related');
  assert.match(randomExplore.source, /种子视频/);
  assert.match(randomExplore.reason, /公开相关视频候选|随机抽取/);

  assert.equal(crossRegion.title, '跨区漫游');
  assert.equal(crossRegion.state, 'ready');
  assert.equal(crossRegion.candidateSource, 'B 站公开分区新视频候选池');
  assert.equal(crossRegion.realCandidateLabel, '已使用真实 B 站候选');
  assert.equal(crossRegion.usesRealBilibiliCandidates, true);
  assert.equal(crossRegion.video?.bvid, 'BV1REAL139A');
  assert.equal(crossRegion.video?.sourceKind, 'bili_region_dynamic');
  assert.match(crossRegion.reason, /最近最多 7 天/);
  assert.match(crossRegion.reason, /游戏/);
  assert.ok(crossRegion.evidence.some(line => line.includes('固定公开分区目录')));

  assert.equal(hiddenFavorite.title, '冷门收藏');
  assert.equal(hiddenFavorite.state, 'ready');
  assert.equal(hiddenFavorite.candidateSource, '本地收藏');
  assert.equal(hiddenFavorite.realCandidateLabel, '未使用真实 B 站候选：这是本地收藏回访。');
  assert.equal(hiddenFavorite.usesRealBilibiliCandidates, false);
  assert.equal(hiddenFavorite.video?.bvid, 'BVFAVHID1');
  assert.equal(hiddenFavorite.video?.sourceKind, 'local_favorite');

  assert.equal(creatorArchive.title, 'UP 主考古');
  assert.equal(creatorArchive.state, 'ready');
  assert.equal(creatorArchive.candidateSource, '已关注 UP 的公开较早投稿');
  assert.equal(creatorArchive.realCandidateLabel, '已使用真实 B 站候选');
  assert.equal(creatorArchive.usesRealBilibiliCandidates, true);
  assert.equal(creatorArchive.video?.bvid, 'BV1ARCOLD1');
  assert.equal(creatorArchive.video?.sourceKind, 'bili_space_archive');
  assert.match(creatorArchive.reason, /公开较早投稿/);
  assert.match(creatorArchive.reason, /排除最近 7 天新投稿/);

  for (const box of data.blindBoxes) {
    assertNoForbiddenVisibleText(visibleBlindBoxText(box));
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

test('uses the injected random source to draw from every fixed candidate pool', () => {
  const firstDraw = buildRandomContractData(() => 0);
  const lastDraw = buildRandomContractData(() => 0.999999);

  assert.deepEqual(firstDraw.blindBoxes.map(box => box.video?.bvid), [
    'BV1RANDOM001',
    'BV1REGION001',
    'BV1FAVORIT01',
    'BV1ARCHIVE01',
  ]);
  assert.deepEqual(lastDraw.blindBoxes.map(box => box.video?.bvid), [
    'BV1RANDOM002',
    'BV1REGION002',
    'BV1FAVORIT02',
    'BV1ARCHIVE02',
  ]);
  assert.notDeepEqual(
    firstDraw.blindBoxes.map(box => box.video?.bvid),
    lastDraw.blindBoxes.map(box => box.video?.bvid),
  );
});

test('cross-region selection uses recent valid watches and ignores invalid records', () => {
  const records = [
    ...createRecentRegionRecords(),
    createRecord({ bvid: 'not-a-bv', tagName: '知识', daysAgo: 1, actualCompletion: 0.95, title: '无效 BV' }),
    createRecord({ bvid: 'BV1INVDUR1', tagName: '知识', daysAgo: 1, actualCompletion: 0.95, title: '无效时长', duration: 0 }),
    createRecord({ bvid: 'BV1INVPRG1', tagName: '知识', daysAgo: 1, actualCompletion: 0.95, title: '无效进度', progress: -1 }),
    createRecord({ bvid: 'BV1INVCMP1', tagName: '知识', daysAgo: 1, actualCompletion: 1.2, title: '无效完成度' }),
    createRecord({ bvid: 'BV1OLDWAT1', tagName: '知识', daysAgo: 8, actualCompletion: 0.95, title: '超过七天' }),
    createRecord({ bvid: 'BV1FUTURE01', tagName: '知识', daysAgo: -1, actualCompletion: 0.95, title: '未来观看一' }),
    createRecord({ bvid: 'BV1FUTURE02', tagName: '知识', daysAgo: -2, actualCompletion: 0.95, title: '未来观看二' }),
  ];

  const highFrequency = buildRecentHighFrequencyRegions(records, NOW_MS);
  assert.deepEqual(highFrequency.map(region => [region.rid, region.regionName, region.count]), [
    [4, '游戏', 2],
  ]);

  const selection = selectCrossRegion(records, { nowMs: NOW_MS, random: () => 0 });
  assert.equal(selection.hasRecentRegionEvidence, true);
  assert.equal(selection.selectedRegion?.rid, 1);
  assert.equal(selection.candidateRegions.some(region => region.rid === 4), false);
});

test('cross-region picks from the full public directory when recent evidence is absent', () => {
  const firstSelection = selectCrossRegion([], { nowMs: NOW_MS, random: () => 0 });
  const lastSelection = selectCrossRegion([], { nowMs: NOW_MS, random: () => 0.999999 });

  assert.equal(firstSelection.hasRecentRegionEvidence, false);
  assert.deepEqual(firstSelection.highFrequencyRegions, []);
  assert.equal(firstSelection.selectedRegion?.regionName, '动画');
  assert.equal(lastSelection.selectedRegion?.regionName, '资讯');
  assert.notEqual(firstSelection.selectedRegion?.rid, lastSelection.selectedRegion?.rid);
});

test('sanitizes raw runtime errors from cross-region candidate source failures', () => {
  const failedPool = buildCrossRegionSourceFailure(
    createRecentRegionRecords(),
    NOW_MS,
    new ReferenceError('document is not defined'),
  );
  const data = buildExperimentData([], [], new Map(), NOW_MS, {
    randomExplorePool: emptyRelatedPool(),
    crossRegionPool: failedPool,
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const crossRegion = data.blindBoxes.find(box => box.id === 'cross_region');

  assert.ok(crossRegion);
  assert.equal(crossRegion.state, 'empty');
  assert.match(crossRegion.emptyDescription ?? '', /没有取得可打开的分区新视频/);
  assert.equal(JSON.stringify(failedPool).includes('source_failed'), false);
  assert.equal(JSON.stringify(crossRegion).includes('document is not defined'), false);
  assert.equal(JSON.stringify(crossRegion).includes('ReferenceError'), false);
});

test('does not fall back to a local random video when related candidates fail', () => {
  const records: WatchHistoryRecord[] = [
    createRecord({ bvid: 'BV1LOCAL001', tagName: '游戏', daysAgo: 3, actualCompletion: 0.92, title: '本地种子视频' }),
    createRecord({ bvid: 'BV1LOCAL002', tagName: '游戏', daysAgo: 40, actualCompletion: 0.91, title: '本地备用视频' }),
  ];
  const failedPool = buildRelatedVideoSourceFailure(
    [{ bvid: 'BV1LOCAL001', title: '本地种子视频' }],
    new ReferenceError('document is not defined'),
  );

  const data = buildExperimentData(records, [], new Map(), NOW_MS, {
    randomExplorePool: failedPool,
    crossRegionPool: emptyCrossRegionPool(),
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const randomExplore = data.blindBoxes.find(box => box.id === 'random_explore');

  assert.ok(randomExplore);
  assert.equal(randomExplore.state, 'empty');
  assert.equal(randomExplore.video, undefined);
  assert.equal(randomExplore.candidateSource, 'B 站公开视频的相关视频候选池');
  assert.match(randomExplore.realCandidateLabel, /未使用真实 B 站候选/);
  assert.equal(randomExplore.usesRealBilibiliCandidates, false);
  assert.match(randomExplore.source, /相关视频候选/);
  assert.match(randomExplore.emptyDescription ?? '', /不会用本地库存视频冒充/);
  assert.equal(JSON.stringify(randomExplore).includes('document is not defined'), false);
});

test('returns natural Chinese empty states for all four fixed cards', () => {
  const data = buildExperimentData([], [], new Map(), NOW_MS, {
    randomExplorePool: emptyRelatedPool(),
    crossRegionPool: emptyCrossRegionPool(),
    creatorArchivePool: emptyCreatorArchivePool(),
  });

  assert.equal(data.blindBoxes.length, 4);
  assert.deepEqual(data.blindBoxes.map(box => box.title), [
    '随机探索',
    '跨区漫游',
    '冷门收藏',
    'UP 主考古',
  ]);
  for (const box of data.blindBoxes) {
    assert.equal(box.state, 'empty');
    assert.ok(box.emptyTitle);
    assert.ok(box.emptyDescription);
    assert.ok(box.candidateSource);
    assert.ok(box.realCandidateLabel);
    assert.ok(box.evidence.length > 0);
    assertNoForbiddenVisibleText(visibleBlindBoxText(box));
  }
});

test('keeps blind-box candidate helpers out of service-worker dynamic preload', () => {
  const source = readFileSync(new URL('../src/background/analytics/suggestions.ts', import.meta.url), 'utf8');
  const mockSource = readFileSync(new URL('./experiment-blind-boxes.mock.html', import.meta.url), 'utf8');

  assert.equal(source.includes("await import('../api/video-blind-box-candidates.ts')"), false);
  assert.match(source, /from ['"]\.\.\/api\/video-blind-box-candidates\.ts['"]/);
  assertNoForbiddenVisibleText(htmlVisibleText(mockSource));
});

function buildRandomContractData(random: () => number) {
  const favorites = [
    createFavorite({
      itemKey: 'favorite-first',
      bvid: 'BV1FAVORIT01',
      title: '第一条冷门收藏',
      folderTitle: '旧收藏',
      tagName: '知识',
      favDaysAgo: 240,
    }),
    createFavorite({
      itemKey: 'favorite-last',
      bvid: 'BV1FAVORIT02',
      title: '第二条冷门收藏',
      folderTitle: '旧收藏',
      tagName: '生活',
      favDaysAgo: 480,
    }),
  ];

  return buildExperimentData([], favorites, new Map(), NOW_MS, {
    random,
    randomExplorePool: createRelatedPool([
      createRelatedCandidate('BV1RANDOM001', '第一条相关视频'),
      createRelatedCandidate('BV1RANDOM002', '第二条相关视频'),
    ]),
    crossRegionPool: createReadyCrossRegionPool([
      createRegionCandidate('BV1REGION001', '第一条分区视频'),
      createRegionCandidate('BV1REGION002', '第二条分区视频'),
    ]),
    creatorArchivePool: createReadyCreatorArchivePool([
      createArchiveCandidate('BV1ARCHIVE01', '第一条较早投稿'),
      createArchiveCandidate('BV1ARCHIVE02', '第二条较早投稿'),
    ]),
  });
}

function visibleBlindBoxText(box: ExperimentBlindBox): string {
  return [
    box.title,
    box.teaser,
    box.candidateSource,
    box.realCandidateLabel,
    box.source,
    box.reason,
    box.statusLabel,
    box.emptyTitle,
    box.emptyDescription,
    ...box.evidence,
    box.video?.title,
    box.video?.authorName,
    box.video?.sourceLabel,
  ].filter((value): value is string => typeof value === 'string').join('\n');
}

function htmlVisibleText(source: string): string {
  return source
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function assertNoForbiddenVisibleText(value: string): void {
  const bannedGuessWord = ['猜你', '喜欢'].join('');
  const bannedUnconsumedWord = ['未', '消费'].join('');
  const bannedRankingWord = ['推荐', '排序'].join('');
  assert.equal(value.includes(bannedGuessWord), false);
  assert.equal(value.includes(bannedUnconsumedWord), false);
  assert.equal(value.includes(bannedRankingWord), false);
  for (const rawTerm of [
    'bvid',
    'BV 号',
    'BV号',
    'BV 种子',
    'fallback',
    'transcript',
    'confidence',
    'sourceHash',
    'segmentId',
    'subtitle_url',
    'source_failed',
    'document is not defined',
    'ReferenceError',
  ]) {
    assert.equal(value.toLocaleLowerCase().includes(rawTerm.toLocaleLowerCase()), false, rawTerm);
  }
}

function createRecentRegionRecords(): WatchHistoryRecord[] {
  return [
    createRecord({ bvid: 'BV1GAME001', tagName: '游戏', daysAgo: 1, actualCompletion: 0.82, title: '最近游戏 1' }),
    createRecord({ bvid: 'BV1GAME002', tagName: '游戏', daysAgo: 3, actualCompletion: 0.78, title: '最近游戏 2' }),
    createRecord({ bvid: 'BV1LOW0001', tagName: '知识', daysAgo: 2, actualCompletion: 0.2, title: '低完成知识', progress: 60 }),
  ];
}

function createReadyCrossRegionPool(
  candidates: ExperimentVideoCandidate[] = [createRegionCandidate('BV1REAL139A', '真实分区新视频')],
): CrossRegionCandidatePool {
  return {
    status: 'ready',
    sourceLabel: 'B 站分区新视频',
    selectedRegion: { rid: 36, regionName: '知识', labels: ['知识'] },
    highFrequencyRegions: [{ rid: 4, regionName: '游戏', count: 2 }],
    candidates,
    evidence: [
      '最近最多 7 天有效观看中，高频分区是：游戏 2 次；本轮从这些分区之外随机选择「知识」。',
      '跨区漫游只使用仓库维护的固定公开分区目录和 B 站分区新视频接口，本轮候选分区为「知识」。',
      '真实候选池返回 1 条可打开视频；本切片不使用最近抽取记录去重，也不改用本地历史或收藏补位。',
    ],
    checkedRegionCount: 1,
    excludedInvalidCandidateCount: 0,
  };
}

function createRegionCandidate(bvid: string, title: string): ExperimentVideoCandidate {
  return {
    bvid,
    avid: 139001,
    cid: 139002,
    title,
    authorName: '公开知识 UP',
    authorMid: 139003,
    cover: 'https://example.com/real-region.jpg',
    url: `https://www.bilibili.com/video/${bvid}`,
    duration: 900,
    publishedAt: Math.floor(NOW_MS / 1000),
    tagName: '知识',
    sourceKind: 'bili_region_dynamic',
    sourceLabel: 'B 站分区新视频 / 知识',
    regionRid: 36,
    regionName: '知识',
  };
}

function emptyCrossRegionPool(): CrossRegionCandidatePool {
  return {
    status: 'empty',
    sourceLabel: 'B 站分区新视频',
    selectedRegion: { rid: 1, regionName: '动画', labels: ['动画'] },
    highFrequencyRegions: [],
    candidates: [],
    evidence: [
      '最近最多 7 天没有达到门槛的高频分区证据，本轮从固定公开分区目录随机选择「动画」。',
      '这次分区新视频候选池没有留下可打开视频。',
    ],
    checkedRegionCount: 1,
    excludedInvalidCandidateCount: 0,
  };
}

function createReadyCreatorArchivePool(
  candidates: ExperimentVideoCandidate[] = [createArchiveCandidate('BV1ARCOLD1', '公开较早投稿')],
): CreatorArchiveCandidatePool {
  return {
    status: 'ready',
    sourceLabel: 'UP 主公开较早投稿',
    seedCount: 1,
    candidates,
    evidence: [
      '本轮从已同步关注快照中选取 1 位 UP，只请求每位 UP 的公开投稿第一页。',
      '已排除最近 7 天投稿 1 条，避免和动态账单的新投稿重复。',
      '公开较早投稿候选池留下 1 条可打开视频。',
    ],
    failures: [],
    checkedCreatorCount: 1,
    excludedRecentSubmissionCount: 1,
    excludedInvalidCandidateCount: 0,
  };
}

function createArchiveCandidate(bvid: string, title: string): ExperimentVideoCandidate {
  return {
    bvid,
    avid: 88001,
    title,
    authorName: '考古 UP',
    authorMid: 88002,
    cover: 'https://example.com/archive.jpg',
    url: `https://www.bilibili.com/video/${bvid}`,
    duration: 600,
    pubtime: Math.floor((NOW_MS - 40 * 86_400_000) / 1000),
    publishedAt: Math.floor((NOW_MS - 40 * 86_400_000) / 1000),
    tagName: '生活',
    sourceKind: 'bili_space_archive',
    sourceLabel: 'UP 主公开较早投稿 / 考古 UP',
  };
}

function emptyCreatorArchivePool(): CreatorArchiveCandidatePool {
  return {
    status: 'no_followed_creator',
    sourceLabel: 'UP 主公开较早投稿',
    seedCount: 0,
    candidates: [],
    evidence: ['本地尚无已同步的已关注 UP 快照，暂时不能请求公开较早投稿。'],
    failures: [],
    checkedCreatorCount: 0,
    excludedRecentSubmissionCount: 0,
    excludedInvalidCandidateCount: 0,
  };
}

function createRecord(input: {
  bvid: string;
  tagName: string;
  daysAgo: number;
  actualCompletion: number;
  title: string;
  progress?: number;
  duration?: number;
}): WatchHistoryRecord {
  const duration = input.duration ?? 1800;
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
    progress: input.progress ?? Math.round(duration * input.actualCompletion),
    duration,
    actualCompletion: input.actualCompletion,
    deviceType: 1,
    isFavorite: false,
    business: 'archive',
    dt: duration,
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

function createRelatedPool(
  candidates: ExperimentRealVideoCandidate[] = [createRelatedCandidate('BV1REALRND01', '真实相关候选视频')],
): ExperimentRealCandidatePool {
  return {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedCount: 2,
    candidates,
    failures: [],
  };
}

function createRelatedCandidate(bvid: string, title: string): ExperimentRealVideoCandidate {
  return {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedBvid: 'BV1SEED0001',
    seedTitle: '种子视频',
    bvid,
    avid: 12345,
    cid: 54321,
    title,
    authorName: '公开候选UP',
    authorMid: 67890,
    cover: 'https://example.com/related.jpg',
    duration: 960,
    pubtime: 1_717_000_000,
    tagName: '科技',
    url: `https://www.bilibili.com/video/${bvid}`,
  };
}

function emptyRelatedPool(): ExperimentRealCandidatePool {
  return {
    sourceKind: 'bilibili_related',
    sourceLabel: '相关视频候选',
    seedCount: 0,
    candidates: [],
    failures: [],
  };
}
