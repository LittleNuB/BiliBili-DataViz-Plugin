import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatExperimentLoadError } from '../dashboard/modules/experiments/experiment-copy.ts';
import {
  buildClaimedExperimentData,
  buildExperimentData,
  fetchRandomExploreCandidatePool,
  getSuccessfulBlindBoxDrawBvids,
  selectRelatedVideoSeeds,
} from '../src/background/analytics/suggestions.ts';
import {
  buildCrossRegionSourceFailure,
  buildRecentHighFrequencyRegions,
  buildRelatedVideoSourceFailure,
  fetchCrossRegionCandidatePool,
  pickRandomCandidate,
  selectCrossRegion,
  type CreatorArchiveCandidatePool,
  type CrossRegionCandidatePool,
} from '../src/background/api/video-blind-box-candidates.ts';
import {
  BLIND_BOX_DRAW_HISTORY_LIMIT,
  BLIND_BOX_DRAW_HISTORY_STORAGE_KEY,
  BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY,
  clearBlindBoxDrawHistory,
  collectBlindBoxDrawHistoryUsage,
  getBlindBoxDrawHistoryEpoch,
  getBlindBoxDrawHistoryLocalDataCategoryRegistration,
  getBlindBoxRecentDrawnBvids,
  mergeBlindBoxDrawHistory,
  normalizeBlindBoxDrawHistory,
  readBlindBoxDrawHistoryAfterClear,
  recordBlindBoxDrawnBvids,
  type BlindBoxDrawHistoryStorage,
} from '../src/background/storage/blind-box-draw-history-repo.ts';
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
      bvid: 'BVFAVHID01',
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
  assert.equal(hiddenFavorite.realCandidateLabel, '本卡不使用；固定从本地收藏回访。');
  assert.equal(hiddenFavorite.usesRealBilibiliCandidates, false);
  assert.equal(hiddenFavorite.video?.bvid, 'BVFAVHID01');
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

test('keeps out-of-range and non-finite random values inside every candidate pool', () => {
  const sharedPool = ['first', 'last'] as const;
  const cases = [
    { label: '-1', value: -1, expected: 'first' },
    { label: '1', value: 1, expected: 'last' },
    { label: 'NaN', value: Number.NaN, expected: 'first' },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY, expected: 'first' },
  ] as const;
  const allowedByBox = [
    new Set(['BV1RANDOM001', 'BV1RANDOM002']),
    new Set(['BV1REGION001', 'BV1REGION002']),
    new Set(['BV1FAVORIT01', 'BV1FAVORIT02']),
    new Set(['BV1ARCHIVE01', 'BV1ARCHIVE02']),
  ];

  for (const item of cases) {
    assert.equal(pickRandomCandidate(sharedPool, () => item.value), item.expected, item.label);
    const data = buildRandomContractData(() => item.value);
    data.blindBoxes.forEach((box, index) => {
      assert.ok(box.video, `${item.label}: ${box.id} returned undefined`);
      assert.equal(allowedByBox[index].has(box.video.bvid), true, `${item.label}: ${box.id}`);
    });
  }
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

test('fetches cross-region candidates from newlist data.archives and drops videos without titles', async () => {
  const requests: Array<{ endpoint: string; params: Record<string, string> }> = [];
  const missingTitleBvid = 'BV1xx411c7mD';
  const visibleCandidateBvid = 'BV1mK4y1C7Bz';

  const pool = await fetchCrossRegionCandidatePool([], {
    nowMs: NOW_MS,
    pageSize: 10,
    random: () => 0,
    request: async (endpoint, params) => {
      requests.push({ endpoint, params });
      return {
        archives: [
          {
            bvid: missingTitleBvid,
            owner: { mid: 1001, name: '缺标题候选 UP' },
            duration: 180,
            pubdate: 1_752_000_000,
            tname: '动画',
          },
          {
            bvid: visibleCandidateBvid,
            title: '可展示的新分区视频',
            owner: { mid: 1002, name: '公开分区 UP' },
            duration: 240,
            pubdate: 1_752_000_100,
            tname: '动画',
          },
        ],
      };
    },
  });

  assert.deepEqual(requests, [{
    endpoint: '/x/web-interface/newlist',
    params: { rid: '1', pn: '1', ps: '10' },
  }]);
  assert.equal(pool.status, 'ready');
  assert.equal(pool.excludedInvalidCandidateCount, 1);
  assert.deepEqual(pool.candidates.map(candidate => candidate.bvid), [visibleCandidateBvid]);

  const data = buildExperimentData([], [], new Map(), NOW_MS, {
    random: () => 0,
    randomExplorePool: emptyRelatedPool(),
    crossRegionPool: pool,
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const visibleText = data.blindBoxes.map(visibleBlindBoxText).join('\n');
  assert.equal(visibleText.includes(missingTitleBvid), false);
  assert.match(visibleText, /可展示的新分区视频/);
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
  assert.match(crossRegion.emptyDescription ?? '', /没有从 B 站接口取得可打开的分区新视频/);
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

test('uses only valid recent related seeds and skips the related request when none qualify', async () => {
  const validAtCutoff = createRecord({
    bvid: 'BV1Q541167Qg',
    tagName: '知识',
    daysAgo: 90,
    actualCompletion: 0.8,
    title: '截止日内视频',
  });
  const validNow = createRecord({
    bvid: 'BV1mK4y1C7Bz',
    tagName: '动画',
    daysAgo: 0,
    actualCompletion: 0.8,
    title: '当前时刻视频',
  });
  const validSeeds = selectRelatedVideoSeeds([validAtCutoff, validNow], NOW_MS);
  assert.deepEqual(validSeeds.map(seed => seed.bvid), ['BV1mK4y1C7Bz', 'BV1Q541167Qg']);

  const invalidTime = createRecord({
    bvid: 'BV1ab411c7EF',
    tagName: '游戏',
    daysAgo: 1,
    actualCompletion: 0.9,
    title: '无效时间视频',
  });
  invalidTime.viewAt = Number.NaN;
  const ineligibleRecords = [
    createRecord({ bvid: 'BV1cd411c7GH', tagName: '游戏', daysAgo: 91, actualCompletion: 0.9, title: '过期视频' }),
    createRecord({ bvid: 'BV1ef411c7JK', tagName: '游戏', daysAgo: -1, actualCompletion: 0.9, title: '未来视频' }),
    createRecord({ bvid: 'not-a-bvid', tagName: '游戏', daysAgo: 1, actualCompletion: 0.9, title: '无效身份视频' }),
    invalidTime,
  ];

  assert.deepEqual(selectRelatedVideoSeeds(ineligibleRecords, NOW_MS), []);
  let requestCount = 0;
  const pool = await fetchRandomExploreCandidatePool(
    ineligibleRecords,
    NOW_MS,
    async () => {
      requestCount += 1;
      return createRelatedPool();
    },
  );

  assert.equal(requestCount, 0);
  assert.equal(pool.seedCount, 0);
  const data = buildExperimentData(ineligibleRecords, [], new Map(), NOW_MS, {
    randomExplorePool: pool,
    crossRegionPool: emptyCrossRegionPool(),
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const randomExplore = data.blindBoxes.find(box => box.id === 'random_explore');
  assert.equal(randomExplore?.state, 'empty');
  assert.equal(randomExplore?.emptyTitle, '当前没有可用于探索的近期视频');
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

test('distinguishes no seed, no real candidates, upstream failure, and unopenable candidates', async () => {
  const noSeedPool = await fetchRandomExploreCandidatePool([], NOW_MS, async () => createRelatedPool());
  const noSeedData = buildExperimentData([], [], new Map(), NOW_MS, {
    randomExplorePool: noSeedPool,
    crossRegionPool: emptyCrossRegionPool(),
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const noSeed = noSeedData.blindBoxes.find(box => box.id === 'random_explore');
  assert.equal(noSeed?.state, 'empty');
  assert.equal(noSeed?.statusLabel, '没有可用种子');
  assert.equal(noSeed?.emptyTitle, '当前没有可用于探索的近期视频');
  assert.match(noSeed?.emptyDescription ?? '', /没有合格种子/);

  const noRealCandidateData = buildExperimentData(createRecentRegionRecords(), [], new Map(), NOW_MS, {
    randomExplorePool: {
      sourceKind: 'bilibili_related',
      sourceLabel: '相关视频候选',
      seedCount: 1,
      candidates: [],
      failures: [{ seedBvid: 'BV1SEED0001', seedTitle: '种子视频', reason: 'empty_response' }],
      failureKind: 'no_real_candidates',
    },
    crossRegionPool: emptyCrossRegionPool(),
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const noRealCandidate = noRealCandidateData.blindBoxes.find(box => box.id === 'random_explore');
  assert.equal(noRealCandidate?.state, 'empty');
  assert.equal(noRealCandidate?.statusLabel, '没有真实候选');
  assert.match(noRealCandidate?.emptyDescription ?? '', /没有返回真实相关视频候选/);

  const upstreamFailureData = buildExperimentData([], [], new Map(), NOW_MS, {
    randomExplorePool: emptyRelatedPool(),
    crossRegionPool: buildCrossRegionSourceFailure(
      createRecentRegionRecords(),
      NOW_MS,
      new Error('API Error: -404 raw failure'),
    ),
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const upstreamFailure = upstreamFailureData.blindBoxes.find(box => box.id === 'cross_region');
  assert.equal(upstreamFailure?.state, 'empty');
  assert.equal(upstreamFailure?.statusLabel, '接口暂时失败');
  assert.match(upstreamFailure?.emptyDescription ?? '', /没有从 B 站接口取得可打开的分区新视频/);
  assertNoForbiddenVisibleText(visibleBlindBoxText(upstreamFailure!));

  const unopenablePool = await fetchCrossRegionCandidatePool([], {
    nowMs: NOW_MS,
    random: () => 0,
    request: async () => ({
      archives: [
        {
          bvid: 'not-a-bvid',
          title: '身份无效的分区候选',
          owner: { mid: 1001, name: '无效 UP' },
          duration: 120,
        },
        {
          bvid: 'BV1mK4y1C7Bz',
          title: '',
          owner: { mid: 1002, name: '缺标题 UP' },
          duration: 240,
        },
      ],
    }),
  });
  const unopenableData = buildExperimentData([], [], new Map(), NOW_MS, {
    randomExplorePool: emptyRelatedPool(),
    crossRegionPool: unopenablePool,
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const unopenable = unopenableData.blindBoxes.find(box => box.id === 'cross_region');
  assert.equal(unopenablePool.failureKind, 'no_openable_candidates');
  assert.equal(unopenable?.state, 'empty');
  assert.equal(unopenable?.statusLabel, '候选不可打开');
  assert.match(unopenable?.emptyDescription ?? '', /返回了候选，但没有留下可打开的视频/);
  assertNoForbiddenVisibleText(visibleBlindBoxText(unopenable!));
});

test('cold favorites report reachable unopenable local records without implying an upstream failure', () => {
  const data = buildExperimentData([], [createFavorite({
    itemKey: 'unopenable-local-favorite',
    bvid: 'not-a-bvid',
    title: '缺少可打开身份的收藏',
    folderTitle: '旧收藏',
    tagName: '知识',
    favDaysAgo: 180,
  })], new Map(), NOW_MS, {
    randomExplorePool: emptyRelatedPool(),
    crossRegionPool: emptyCrossRegionPool(),
    creatorArchivePool: emptyCreatorArchivePool(),
  });
  const coldFavorite = data.blindBoxes.find(box => box.id === 'hidden_favorite');

  assert.equal(coldFavorite?.title, '冷门收藏');
  assert.equal(coldFavorite?.state, 'empty');
  assert.equal(coldFavorite?.statusLabel, '候选不可打开');
  assert.equal(coldFavorite?.candidateSource, '本地收藏');
  assert.equal(coldFavorite?.realCandidateLabel, '本卡不使用；固定从本地收藏回访。');
  assert.equal(coldFavorite?.usesRealBilibiliCandidates, false);
  assert.match(coldFavorite?.emptyDescription ?? '', /本地收藏/);
  assert.doesNotMatch(visibleBlindBoxText(coldFavorite!), /接口|没有真实候选/);
  assertNoForbiddenVisibleText(visibleBlindBoxText(coldFavorite!));
});

test('shared recent draw history prefers unseen candidates across all four cards', () => {
  const data = buildRandomContractData(() => 0, {
    recentDrawnBvids: ['BV1RANDOM001', 'BV1REGION001', 'BV1FAVORIT01', 'BV1ARCHIVE01'],
  });

  assert.deepEqual(data.blindBoxes.map(box => box.video?.bvid), [
    'BV1RANDOM002',
    'BV1REGION002',
    'BV1FAVORIT02',
    'BV1ARCHIVE02',
  ]);
});

test('all-repeated valid pools draw from the full valid pool instead of becoming empty', () => {
  const data = buildRandomContractData(() => 0.999999, {
    recentDrawnBvids: [
      'BV1RANDOM001',
      'BV1RANDOM002',
      'BV1REGION001',
      'BV1REGION002',
      'BV1FAVORIT01',
      'BV1FAVORIT02',
      'BV1ARCHIVE01',
      'BV1ARCHIVE02',
    ],
  });

  assert.equal(data.blindBoxes.every(box => box.state === 'ready'), true);
  assert.deepEqual(data.blindBoxes.map(box => box.video?.bvid), [
    'BV1RANDOM002',
    'BV1REGION002',
    'BV1FAVORIT02',
    'BV1ARCHIVE02',
  ]);
});

test('records only successful openable blind-box draws', () => {
  const data = buildRandomContractData(() => 0);
  const readyBox = data.blindBoxes[0];
  const invalidBox: ExperimentBlindBox = {
    ...readyBox,
    video: readyBox.video ? {
      ...readyBox.video,
      bvid: 'not-a-bvid',
      url: 'https://www.bilibili.com/video/not-a-bvid',
    } : undefined,
  };
  const emptyBox: ExperimentBlindBox = {
    ...readyBox,
    state: 'empty',
    video: readyBox.video,
  };

  assert.deepEqual(getSuccessfulBlindBoxDrawBvids([
    ...data.blindBoxes,
    invalidBox,
    emptyBox,
    data.blindBoxes[0],
  ]), [
    'BV1RANDOM001',
    'BV1REGION001',
    'BV1FAVORIT01',
    'BV1ARCHIVE01',
  ]);
});

test('blind-box draw history keeps the latest 50 normalized BVIDs and clears with readback', async () => {
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: Array.from({ length: 55 }, (_, index) => testBvid(index)),
  });
  const newest = ['BV1LATEST01', 'BV1LATEST02'];
  const merged = mergeBlindBoxDrawHistory(
    Array.from({ length: 55 }, (_, index) => testBvid(index)),
    [...newest, 'not-a-bvid', testBvid(1)],
  );

  assert.equal(merged.length, BLIND_BOX_DRAW_HISTORY_LIMIT);
  assert.deepEqual(merged.slice(0, 3), ['BV1LATEST01', 'BV1LATEST02', testBvid(1)]);
  assert.equal(normalizeBlindBoxDrawHistory(['bad', 'BV1LATEST01', 'BV1LATEST01']).length, 1);

  const afterRecord = await recordBlindBoxDrawnBvids(newest, storage);
  assert.equal(afterRecord.length, BLIND_BOX_DRAW_HISTORY_LIMIT);
  assert.deepEqual(afterRecord.slice(0, 2), newest);

  const usage = await collectBlindBoxDrawHistoryUsage(storage);
  assert.equal(usage.count, BLIND_BOX_DRAW_HISTORY_LIMIT);
  assert.ok(usage.usageBytes > 0);

  const clearedCount = await clearBlindBoxDrawHistory(storage);
  assert.equal(clearedCount, BLIND_BOX_DRAW_HISTORY_LIMIT);
  assert.deepEqual(await readBlindBoxDrawHistoryAfterClear(storage), {
    count: 0,
    usageBytes: 0,
    empty: true,
  });
});

test('blind-box lifecycle counts timestamp metadata and does not accept an orphan timestamp as empty', async () => {
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_UPDATED_AT_STORAGE_KEY]: NOW_MS,
  });

  const usage = await collectBlindBoxDrawHistoryUsage(storage);
  assert.equal(usage.count, 0);
  assert.ok(usage.usageBytes > 0);
  assert.equal((await readBlindBoxDrawHistoryAfterClear(storage)).empty, false);

  assert.equal(await clearBlindBoxDrawHistory(storage), 0);
  assert.deepEqual(await readBlindBoxDrawHistoryAfterClear(storage), {
    count: 0,
    usageBytes: 0,
    empty: true,
  });
});

test('overlapping blind-box history records retain both batches in newest-first order', async () => {
  const firstGetStarted = createDeferred<void>();
  const releaseFirstGet = createDeferred<void>();
  let getCalls = 0;
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1EXISTING1'],
  }, {
    afterGetSnapshot: async call => {
      getCalls = call;
      if (call === 1) {
        firstGetStarted.resolve();
        await releaseFirstGet.promise;
      }
    },
  });

  const firstRecord = recordBlindBoxDrawnBvids(['BV1FIRST001'], storage);
  await firstGetStarted.promise;
  const secondRecord = recordBlindBoxDrawnBvids(['BV1SECOND01'], storage);
  await Promise.resolve();
  const getCallsBeforeRelease = getCalls;
  releaseFirstGet.resolve();

  const [firstResult, secondResult] = await Promise.all([firstRecord, secondRecord]);
  assert.equal(getCallsBeforeRelease, 1, 'the second read must wait for the first mutation');
  assert.deepEqual(firstResult, ['BV1FIRST001', 'BV1EXISTING1']);
  assert.deepEqual(secondResult, ['BV1SECOND01', 'BV1FIRST001', 'BV1EXISTING1']);
  assert.deepEqual(await getBlindBoxRecentDrawnBvids(storage), secondResult);
});

test('concurrent blind-box generations claim from latest history and avoid duplicate BVIDs', async () => {
  const storage = createMemoryStorage();
  const drawHistoryEpoch = getBlindBoxDrawHistoryEpoch();
  const generate = () => buildClaimedExperimentData([], [], new Map(), NOW_MS, {
    random: () => 0,
    randomExplorePool: createRelatedPool([
      createRelatedCandidate('BV1CONCUR01', '并发候选一'),
      createRelatedCandidate('BV1CONCUR02', '并发候选二'),
    ]),
    crossRegionPool: emptyCrossRegionPool(),
    creatorArchivePool: emptyCreatorArchivePool(),
  }, drawHistoryEpoch, storage);

  const [first, second] = await Promise.all([generate(), generate()]);
  const firstBvid = first.blindBoxes.find(box => box.id === 'random_explore')?.video?.bvid;
  const secondBvid = second.blindBoxes.find(box => box.id === 'random_explore')?.video?.bvid;

  assert.deepEqual(new Set([firstBvid, secondBvid]), new Set(['BV1CONCUR01', 'BV1CONCUR02']));
  assert.notEqual(firstBvid, secondBvid);
  assert.deepEqual(await getBlindBoxRecentDrawnBvids(storage), [secondBvid, firstBvid]);
});

test('blind-box history clear waits for an earlier record and removes its completed result', async () => {
  const setStarted = createDeferred<void>();
  const releaseSet = createDeferred<void>();
  let removeCalls = 0;
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1BASE0001'],
  }, {
    beforeSet: async () => {
      setStarted.resolve();
      await releaseSet.promise;
    },
    beforeRemove: () => {
      removeCalls += 1;
    },
  });

  const record = recordBlindBoxDrawnBvids(['BV1RECORD01'], storage);
  await setStarted.promise;
  const clear = clearBlindBoxDrawHistory(storage);
  await Promise.resolve();
  const removeCallsBeforeRelease = removeCalls;
  releaseSet.resolve();

  assert.deepEqual(await record, ['BV1RECORD01', 'BV1BASE0001']);
  assert.equal(await clear, 2);
  assert.equal(removeCallsBeforeRelease, 0, 'clear must wait for the earlier write');
  assert.deepEqual(await getBlindBoxRecentDrawnBvids(storage), []);
});

test('blind-box generation started before clear does not repopulate history after delayed candidates finish', async () => {
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1BEFORECLR'],
  });
  const releaseCandidates = createDeferred<void>();
  const drawHistoryEpoch = getBlindBoxDrawHistoryEpoch();
  const generation = (async () => {
    await releaseCandidates.promise;
    return buildClaimedExperimentData([], [], new Map(), NOW_MS, {
      random: () => 0,
      randomExplorePool: createRelatedPool([
        createRelatedCandidate('BV1AFTERCLR1', '清理后的迟到候选'),
      ]),
      crossRegionPool: emptyCrossRegionPool(),
      creatorArchivePool: emptyCreatorArchivePool(),
    }, drawHistoryEpoch, storage);
  })();

  assert.equal(await clearBlindBoxDrawHistory(storage), 1);
  releaseCandidates.resolve();
  const data = await generation;

  assert.equal(data.blindBoxes.find(box => box.id === 'random_explore')?.video?.bvid, 'BV1AFTERCLR1');
  assert.deepEqual(await collectBlindBoxDrawHistoryUsage(storage), {
    count: 0,
    usageBytes: 0,
  });
  assert.deepEqual(await getBlindBoxRecentDrawnBvids(storage), []);
});

test('a rejected blind-box history write does not poison the next mutation', async () => {
  let rejectNextWrite = true;
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1STABLE001'],
  }, {
    beforeSet: () => {
      if (rejectNextWrite) {
        rejectNextWrite = false;
        throw new Error('synthetic storage write failure');
      }
    },
  });

  await assert.rejects(
    recordBlindBoxDrawnBvids(['BV1FAILED001'], storage),
    /synthetic storage write failure/,
  );
  const next = await recordBlindBoxDrawnBvids(['BV1RECOVER01'], storage);

  assert.deepEqual(next, ['BV1RECOVER01', 'BV1STABLE001']);
  assert.deepEqual(await getBlindBoxRecentDrawnBvids(storage), next);
});

test('blind-box history reads and counts wait for prior mutations without deadlock', async () => {
  const setStarted = createDeferred<void>();
  const releaseSet = createDeferred<void>();
  let getCalls = 0;
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1BEFORE001'],
  }, {
    afterGetSnapshot: call => {
      getCalls = call;
    },
    beforeSet: async () => {
      setStarted.resolve();
      await releaseSet.promise;
    },
  });

  const record = recordBlindBoxDrawnBvids(['BV1AFTER001'], storage);
  await setStarted.promise;
  const read = getBlindBoxRecentDrawnBvids(storage);
  const usage = collectBlindBoxDrawHistoryUsage(storage);
  const readback = readBlindBoxDrawHistoryAfterClear(storage);
  await Promise.resolve();
  const getCallsBeforeRelease = getCalls;
  releaseSet.resolve();

  await record;
  assert.equal(getCallsBeforeRelease, 1, 'public reads must wait for the pending write');
  assert.deepEqual(await read, ['BV1AFTER001', 'BV1BEFORE001']);
  const expectedListBytes = JSON.stringify({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1AFTER001', 'BV1BEFORE001'],
  }).length;
  const usageResult = await usage;
  assert.equal(usageResult.count, 2);
  assert.ok(usageResult.usageBytes > expectedListBytes);
  const readbackResult = await readback;
  assert.equal(readbackResult.count, 2);
  assert.equal(readbackResult.usageBytes, usageResult.usageBytes);
  assert.equal(readbackResult.empty, false);
});

test('blind-box draw history is registered for per-category clear and clear-all orchestration', async () => {
  const storage = createMemoryStorage({
    [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1LATEST01', 'BV1LATEST02'],
  });
  const category = getBlindBoxDrawHistoryLocalDataCategoryRegistration(storage);

  assert.equal(category.includeInClearAll, true);
  assert.deepEqual(await category.collectUsage(), {
    count: 2,
    usageBytes: JSON.stringify({ [BLIND_BOX_DRAW_HISTORY_STORAGE_KEY]: ['BV1LATEST01', 'BV1LATEST02'] }).length,
  });
  assert.deepEqual(await category.clear(), {
    cleared: { blindBoxDrawHistory: 2 },
  });
  assert.deepEqual(await category.readAfterClear(), {
    count: 0,
    usageBytes: 0,
    empty: true,
  });
});

test('formats experiment load errors without exposing runtime messages or raw fields', () => {
  const failures: unknown[] = [
    new Error('sourceHash=internal-hash'),
    new Error('API Error: -404 data null'),
    new ReferenceError('document is not defined'),
    'fallback transcript confidence segmentId subtitle_url',
    { message: 'window is not defined; bvid=BV1xx411c7mD' },
  ];

  for (const failure of failures) {
    const visibleMessage = formatExperimentLoadError(failure);
    assert.equal(visibleMessage, '盲盒暂时无法生成，请刷新后重试。');
    assertNoForbiddenVisibleText(visibleMessage);
  }
});

test('mock QA fixture keeps the four failure states and local favorite source contract distinct', () => {
  const mockSource = readFileSync(new URL('./experiment-blind-boxes.mock.html', import.meta.url), 'utf8');
  const mockVisibleText = htmlVisibleText(mockSource);

  assert.match(mockSource, /import \{ h, render \} from 'preact'/);
  assert.match(mockSource, /import \{ ExperimentsPage \} from '\/dashboard\/modules\/experiments\/ExperimentsPage\.tsx'/);
  assert.match(mockSource, /globalThis\.chrome\s*=\s*\{/);
  assert.match(mockSource, /sendMessage:\s*async message/);
  assert.match(mockSource, /message\?\.action !== 'GET_EXPERIMENT_DATA'/);
  assert.match(mockSource, /render\(h\(ExperimentsPage, \{\}\), document\.getElementById\('app'\)\)/);
  assert.doesNotMatch(mockSource, /<article\b/);
  assert.match(mockSource, /createReadyExperimentData/);
  assert.match(mockSource, /createFailureExperimentData/);
  assert.match(mockSource, /没有可用种子/);
  assert.match(mockSource, /没有真实候选/);
  assert.match(mockSource, /接口暂时失败/);
  assert.match(mockSource, /候选打不开/);
  assert.match(mockSource, /本卡不使用；固定从本地收藏回访。/);
  assert.doesNotMatch(mockSource, /隐藏收藏/);
  assertNoForbiddenVisibleText(mockVisibleText);
});

test('keeps blind-box candidate helpers out of service-worker dynamic preload', () => {
  const source = readFileSync(new URL('../src/background/analytics/suggestions.ts', import.meta.url), 'utf8');

  assert.equal(source.includes("await import('../api/video-blind-box-candidates.ts')"), false);
  assert.match(source, /from ['"]\.\.\/api\/video-blind-box-candidates\.ts['"]/);
});

function buildRandomContractData(
  random: () => number,
  options: { recentDrawnBvids?: string[] } = {},
) {
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
    recentDrawnBvids: options.recentDrawnBvids,
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
    'API Error',
    'document is not defined',
    'window is not defined',
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
      '真实候选池返回 1 条可打开视频；抽取时会优先避开最近抽中过的视频，但不会改用本地历史或收藏补位。',
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

interface MemoryStorageHooks {
  afterGetSnapshot?: (call: number) => void | Promise<void>;
  beforeSet?: (items: Record<string, unknown>, call: number) => void | Promise<void>;
  beforeRemove?: (keys: string[], call: number) => void | Promise<void>;
}

function createMemoryStorage(
  initial: Record<string, unknown> = {},
  hooks: MemoryStorageHooks = {},
): BlindBoxDrawHistoryStorage {
  const values = new Map<string, unknown>(Object.entries(initial));
  let getCalls = 0;
  let setCalls = 0;
  let removeCalls = 0;
  return {
    get: async keys => {
      getCalls += 1;
      const snapshot = Object.fromEntries(keys.map(key => [key, values.get(key)]));
      await hooks.afterGetSnapshot?.(getCalls);
      return snapshot;
    },
    set: async items => {
      setCalls += 1;
      await hooks.beforeSet?.(items, setCalls);
      for (const [key, value] of Object.entries(items)) {
        values.set(key, value);
      }
    },
    remove: async keys => {
      removeCalls += 1;
      await hooks.beforeRemove?.(keys, removeCalls);
      for (const key of keys) {
        values.delete(key);
      }
    },
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(currentResolve => {
    resolve = currentResolve;
  });
  return { promise, resolve };
}

function testBvid(index: number): string {
  return `BVTEST${String(index).padStart(6, '0')}`;
}
