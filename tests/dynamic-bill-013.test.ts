import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveLegacyCreatorPauses } from '../src/background/dynamic-bill/migration-plan.ts';
import { planFixedDynamicBillItems } from '../src/background/dynamic-bill/planner.ts';
import type {
  DynamicBillFeedbackRecord,
  DynamicBillRotationRecord,
  FollowedCreator,
  FollowedVideoUpdate,
} from '../src/shared/types/dynamic-bill.ts';
import type { FavoriteItem } from '../src/shared/types/favorite.ts';
import type { WatchHistoryRecord } from '../src/shared/types/watch-event.ts';

const NOW = Date.UTC(2026, 6, 17, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW / 1000);

test('plans fixed 0.13 columns with unique ownership and one latest item per UP', () => {
  const plan = planFixedDynamicBillItems({
    now: NOW,
    creators: [
      creator(1, { followedAtDaysAgo: 400 }),
      creator(2, { special: true }),
      creator(3),
    ],
    updates: [
      update(1, 'old', 2),
      update(1, 'new', 1),
      update(2, 'only', 3),
      update(3, 'only', 4),
    ],
    historyRecords: [],
    favoriteItems: [favorite(1, 'fav')],
    rotationRecords: [],
    pausedCreatorMids: new Set(),
  });

  assert.equal(plan.items.length, 3);
  assert.deepEqual(
    plan.items.map(item => [item.creatorMid, item.column, item.evidence.newVideo.updateKey]),
    [
      [2, 'buried_follow', 'u2-only'],
      [1, 'favorite_related', 'u1-new'],
      [3, 'follow_rotation', 'u3-only'],
    ],
  );
  assert.equal(new Set(plan.items.map(item => item.creatorMid)).size, 3);
  assert.equal(plan.columnEligibleCounts.favorite_related, 1);
  assert.equal(plan.columnEligibleCounts.buried_follow, 1);
  assert.equal(plan.columnEligibleCounts.follow_rotation, 1);
});

test('deduplicates the same favorite BVID across folders without changing ownership', () => {
  const firstFolder = favorite(1, 'shared');
  const secondFolder = {
    ...firstFolder,
    itemKey: `200:${firstFolder.bvid}`,
    mediaId: 200,
    folderTitle: 'Second folder',
  };
  const plan = planFixedDynamicBillItems({
    now: NOW,
    creators: [creator(1)],
    updates: [update(1, 'new', 1)],
    historyRecords: [],
    favoriteItems: [firstFolder, secondFolder],
    rotationRecords: [],
    pausedCreatorMids: new Set(),
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].column, 'favorite_related');
  assert.equal(plan.columnEligibleCounts.favorite_related, 1);
  assert.match(plan.items[0].evidence.facts[0], /有 1 条来自这个 UP 的既有作品/);
});

test('keeps one bill identity when the same update is reclassified across columns', () => {
  const plans = [
    planForOneCreator(creator(1), []),
    planForOneCreator(creator(1, { followedAtDaysAgo: 400 }), []),
    planForOneCreator(creator(1), [favorite(1, 'evidence')]),
  ];

  assert.deepEqual(
    plans.map(plan => plan.items[0].column),
    ['follow_rotation', 'buried_follow', 'favorite_related'],
  );
  assert.deepEqual(
    plans.map(plan => plan.items[0].billKey),
    Array(3).fill('update:u1-new'),
  );
});

test('selects the same latest unwatched update for every equal-time input permutation', () => {
  const tiedUpdates = [
    { ...update(1, 'z', 0), dynamicTime: NOW_SECONDS, pubtime: NOW_SECONDS - 1 },
    { ...update(1, 'b', 0), dynamicTime: NOW_SECONDS, pubtime: NOW_SECONDS },
    { ...update(1, 'a', 0), dynamicTime: NOW_SECONDS, pubtime: NOW_SECONDS },
  ];

  const selectedUpdateKeys = permutations(tiedUpdates).map((updates) => {
    const plan = planFixedDynamicBillItems({
      now: NOW,
      creators: [creator(1)],
      updates,
      historyRecords: [],
      favoriteItems: [],
      rotationRecords: [],
      pausedCreatorMids: new Set(),
    });
    return plan.items[0]?.evidence.newVideo.updateKey;
  });

  assert.deepEqual(selectedUpdateKeys, Array(6).fill('u1-a'));
});

test('excludes same-video BVIDs from all available history without changing deterministic selection', () => {
  const tiedUpdates = [
    { ...update(1, 'watched', 0), dynamicTime: NOW_SECONDS, pubtime: NOW_SECONDS },
    { ...update(1, 'b', 0), dynamicTime: NOW_SECONDS, pubtime: NOW_SECONDS },
    { ...update(1, 'c', 0), dynamicTime: NOW_SECONDS, pubtime: NOW_SECONDS },
  ];
  const oldWatch = history(1, 'BV1-watched', NOW_SECONDS - 60 * 86_400);

  for (const updates of permutations(tiedUpdates)) {
    const plan = planFixedDynamicBillItems({
      now: NOW,
      creators: [creator(1)],
      updates,
      historyRecords: [oldWatch],
      favoriteItems: [],
      rotationRecords: [],
      pausedCreatorMids: new Set(),
    });

    assert.equal(plan.items[0]?.evidence.newVideo.updateKey, 'u1-b');
    assert.equal(plan.excludedRecentSameVideoCount, 1);
    assert.match(
      plan.items[0].evidence.facts.join('\n'),
      /可用本地观看记录中未发现同一新视频。/,
    );
    assert.doesNotMatch(plan.items[0].evidence.facts.join('\n'), /BV1-b/);
    assert.doesNotMatch(plan.items[0].evidence.facts.join('\n'), /最近 30 天未发现/);
  }
});

test('planner visible facts use titles or natural untitled copy without raw BVID', () => {
  const untitledUpdate = {
    ...update(2, 'untitled', 2),
    title: '',
    bvid: 'BV2-raw-visible-leak',
  };
  const plan = planFixedDynamicBillItems({
    now: NOW,
    creators: [creator(1), creator(2)],
    updates: [
      update(1, 'titled', 1),
      untitledUpdate,
    ],
    historyRecords: [],
    favoriteItems: [],
    rotationRecords: [],
    pausedCreatorMids: new Set(),
  });

  assert.equal(plan.items.length, 2);
  const titledFacts = plan.items.find(item => item.creatorMid === 1)?.evidence.facts.join('\n') ?? '';
  const untitledFacts = plan.items.find(item => item.creatorMid === 2)?.evidence.facts.join('\n') ?? '';

  assert.match(titledFacts, /新视频《Video 1 titled》/);
  assert.match(untitledFacts, /新视频《视频标题暂缺》/);
  assert.doesNotMatch(`${titledFacts}\n${untitledFacts}`, /BV\d|raw-visible-leak/);
  assert.match(`${titledFacts}\n${untitledFacts}`, /可用本地观看记录中未发现同一新视频。/);
});

test('uses one global rotation record and caps a column at five items', () => {
  const creatorIds = [10, 11, 12, 13, 14, 15];
  const plan = planFixedDynamicBillItems({
    now: NOW,
    creators: creatorIds.map(id => creator(id)),
    updates: creatorIds.map((id, index) => update(id, 'only', index + 1)),
    historyRecords: [],
    favoriteItems: [],
    rotationRecords: [
      rotation(10, NOW - 100_000),
      rotation(11, NOW - 500_000),
      rotation(12, NOW - 300_000),
      rotation(13, NOW - 900_000),
      rotation(14, NOW - 700_000),
      rotation(15, NOW - 50_000),
    ],
    pausedCreatorMids: new Set(),
  });

  const rotationItems = plan.items.filter(item => item.column === 'follow_rotation');
  assert.equal(rotationItems.length, 5);
  assert.deepEqual(rotationItems.map(item => item.creatorMid), [13, 14, 11, 12, 10]);
  assert.equal(rotationItems.some(item => item.creatorMid === 15), false);
});

test('excludes paused creators and known watched same videos before column ownership', () => {
  const plan = planFixedDynamicBillItems({
    now: NOW,
    creators: [creator(1), creator(2), creator(3)],
    updates: [
      update(1, 'paused', 1),
      update(2, 'watched', 2),
      update(3, 'ready', 3),
    ],
    historyRecords: [
      history(2, 'BV2-watched', NOW_SECONDS - 5 * 86_400),
    ],
    favoriteItems: [],
    rotationRecords: [],
    pausedCreatorMids: new Set([1]),
  });

  assert.deepEqual(plan.items.map(item => item.creatorMid), [3]);
  assert.equal(plan.excludedByFeedbackCount, 1);
  assert.equal(plan.excludedRecentSameVideoCount, 1);
});

test('derives idempotent 0.13 pauses from unexpired legacy creator feedback only', () => {
  const records: DynamicBillFeedbackRecord[] = [
    legacyFeedback('creator', '1', NOW - 10 * 86_400_000),
    legacyFeedback('creator', '1', NOW - 5 * 86_400_000),
    legacyFeedback('creator', '2', NOW - 40 * 86_400_000),
    legacyFeedback('topic', 'category:game', NOW - 1_000),
    legacyFeedback('creator', 'bad', 0),
  ];

  const pauses = deriveLegacyCreatorPauses(records, NOW);

  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].creatorMid, 1);
  assert.equal(pauses[0].startedAt, NOW - 5 * 86_400_000);
  assert.equal(pauses[0].expiresAt, NOW + 25 * 86_400_000);
  assert.equal(pauses[0].source, 'migration');
});

function creator(
  mid: number,
  options: { followedAtDaysAgo?: number; special?: boolean; observed?: boolean } = {},
): FollowedCreator {
  const firstSeenAt = options.observed ? NOW - 40 * 86_400_000 : NOW;
  return {
    mid,
    name: `UP ${mid}`,
    face: '',
    sign: '',
    followedAt: options.followedAtDaysAgo
      ? NOW_SECONDS - options.followedAtDaysAgo * 86_400
      : undefined,
    followAgeKnown: options.followedAtDaysAgo !== undefined,
    special: options.special === true,
    attribute: 0,
    tagId: 0,
    isActive: true,
    firstSeenAt,
    syncedAt: firstSeenAt,
    lastSeenAt: NOW,
  };
}

function planForOneCreator(
  followedCreator: FollowedCreator,
  favoriteItems: FavoriteItem[],
) {
  return planFixedDynamicBillItems({
    now: NOW,
    creators: [followedCreator],
    updates: [update(1, 'new', 1)],
    historyRecords: [],
    favoriteItems,
    rotationRecords: [],
    pausedCreatorMids: new Set(),
  });
}

function update(authorMid: number, key: string, daysAgo: number): FollowedVideoUpdate {
  return {
    updateKey: `u${authorMid}-${key}`,
    dynamicId: `d${authorMid}-${key}`,
    bvid: `BV${authorMid}-${key}`,
    avid: authorMid,
    title: `Video ${authorMid} ${key}`,
    intro: '',
    cover: '',
    duration: 600,
    pubtime: NOW_SECONDS - daysAgo * 86_400,
    dynamicTime: NOW_SECONDS - daysAgo * 86_400,
    authorMid,
    authorName: `UP ${authorMid}`,
    authorFace: '',
    tagName: '知识',
    tags: ['测试'],
    syncedAt: NOW,
  };
}

function favorite(authorMid: number, key: string): FavoriteItem {
  return {
    itemKey: `100:${key}`,
    mediaId: 100,
    folderTitle: 'Default',
    avid: authorMid,
    bvid: `BVFAV${authorMid}-${key}`,
    title: `Favorite ${authorMid}`,
    intro: '',
    authorName: `UP ${authorMid}`,
    authorMid,
    tagName: '知识',
    tags: [],
    cover: '',
    duration: 600,
    pubtime: 0,
    favTime: 0,
    syncedAt: NOW,
  };
}

function history(authorMid: number, bvid: string, viewAt: number): WatchHistoryRecord {
  return {
    sessionKey: `${bvid}:${viewAt}`,
    kid: viewAt,
    avid: authorMid,
    bvid,
    cid: 1,
    title: `History ${authorMid}`,
    authorName: `UP ${authorMid}`,
    authorMid,
    tagName: '知识',
    tags: [],
    cover: '',
    viewAt,
    progress: 400,
    duration: 600,
    actualCompletion: 0.8,
    deviceType: 2,
    isFavorite: false,
    business: 'archive',
    dt: 0,
    syncedAt: NOW,
  };
}

function rotation(creatorMid: number, lastShownAt: number): DynamicBillRotationRecord {
  return {
    creatorMid,
    creatorName: `UP ${creatorMid}`,
    lastShownAt,
    lastBillKey: `old:${creatorMid}`,
    lastColumn: 'follow_rotation',
    updatedAt: lastShownAt,
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    return permutations(rest).map(permutation => [value, ...permutation]);
  });
}

function legacyFeedback(
  scope: DynamicBillFeedbackRecord['scope'],
  key: string,
  createdAt: number,
): DynamicBillFeedbackRecord {
  const creatorMid = Number(key);
  return {
    scope,
    key,
    label: key,
    billKey: `legacy:${key}`,
    column: scope === 'topic' ? 'variety' : 'buried_follow',
    creatorMid: Number.isFinite(creatorMid) ? creatorMid : 0,
    creatorName: Number.isFinite(creatorMid) ? `UP ${creatorMid}` : '',
    createdAt,
  };
}
