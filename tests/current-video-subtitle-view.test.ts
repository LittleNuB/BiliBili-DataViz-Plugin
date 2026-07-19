import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeSubtitleLineAtTime,
  buildCurrentVideoSubtitleJumpPreview,
  buildCurrentVideoSubtitleViewingSource,
  buildSubtitleExportFilename,
  formatSubtitleSrt,
  formatSubtitleTxt,
  navigateCurrentVideoSubtitleSearchResult,
  reduceCurrentVideoSubtitleFollowState,
  searchCurrentVideoSubtitleLines,
  selectDefaultSubtitleViewingSource,
  shouldShowSubtitleViewingSourceSwitcher,
  validateSubtitleViewingIdentity,
  type CurrentVideoSubtitleFollowState,
} from '../src/shared/current-video-subtitle-view.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';

test('subtitle search is local to the viewed source with Chinese contiguous and English case-insensitive matches', () => {
  const bilibili = source('bilibili_subtitle', 'B站字幕', [
    [0, 2, '开场介绍子代理架构'],
    [2, 4, 'Tool Use helps with local actions'],
  ]);
  const local = source('local_transcript', '本地转录', [
    [0, 2, '本地完成稿提到子 代理中间有空格'],
    [2, 4, 'tool use local-only line'],
  ]);

  const chinese = searchCurrentVideoSubtitleLines(bilibili, '子代理');
  assert.equal(chinese.results.length, 1);
  assert.equal(chinese.results[0].text, '开场介绍子代理架构');

  const chineseNotContiguous = searchCurrentVideoSubtitleLines(local, '子代理');
  assert.equal(chineseNotContiguous.results.length, 0);
  assert.match(chineseNotContiguous.message, /没有匹配/);

  const english = searchCurrentVideoSubtitleLines(bilibili, 'tool use');
  assert.equal(english.results.length, 1);
  assert.equal(english.results[0].timeRangeLabel, '0:02-0:04');

  const localOnly = searchCurrentVideoSubtitleLines(local, 'local-only');
  assert.equal(localOnly.results.length, 1);
  assert.equal(searchCurrentVideoSubtitleLines(bilibili, 'local-only').results.length, 0);

  const next = navigateCurrentVideoSubtitleSearchResult({
    query: 'line',
    results: [
      { ...localOnly.results[0], resultId: 'one' },
      { ...localOnly.results[0], resultId: 'two' },
    ],
    activeIndex: 0,
    message: '找到 2 处匹配。',
  }, 'next');
  assert.equal(next.activeIndex, 1);
  assert.equal(navigateCurrentVideoSubtitleSearchResult(next, 'next').activeIndex, 0);
  assert.equal(navigateCurrentVideoSubtitleSearchResult(next, 'previous').activeIndex, 0);
});

test('subtitle export formats TXT and SRT from real rows with safe Chinese filenames', () => {
  const bilibili = source('bilibili_subtitle', 'B站字幕', [
    [4.25, 8.5, '第二句字幕'],
    [0, 3.2, '第一句字幕'],
  ]);

  const txt = formatSubtitleTxt(bilibili, {
    title: '测试视频:BVID CID fallback transcript confidence sourceHash segmentId subtitle_url',
    partTitle: '第/一?P sourceHash',
  });
  assert.match(txt, /^测试视频 - 第\/一\?P 字幕全文（B站字幕）/);
  assert.doesNotMatch(txt.split('\n', 1)[0], /fallback|transcript|confidence|sourceHash|segmentId|subtitle_url|BVID|CID/i);
  assert.match(txt, /\[0:00-0:03\] 第一句字幕/);
  assert.match(txt, /\[0:04-0:08\] 第二句字幕/);

  const srt = formatSubtitleSrt(bilibili);
  assert.equal(srt, [
    '1',
    '00:00:00,000 --> 00:00:03,200',
    '第一句字幕',
    '',
    '2',
    '00:00:04,250 --> 00:00:08,500',
    '第二句字幕',
    '',
  ].join('\n'));

  const filename = buildSubtitleExportFilename({
    title: '测试视频:BVID fallback transcript confidence sourceHash segmentId subtitle_url / 第*一集',
    partTitle: 'P1<CID>',
    sourceLabel: 'B站字幕',
    extension: 'srt',
  });
  assert.equal(filename, '测试视频 第 一集-P1-B站字幕-字幕全文.srt');
  assert.doesNotMatch(filename, /fallback|transcript|confidence|sourceHash|segmentId|subtitle_url|BVID|CID|[<>:"/\\|?*]/i);
});

test('subtitle source drops invalid timelines instead of fabricating a zero-second start', () => {
  const result = buildCurrentVideoSubtitleViewingSource({
    bvid: 'BV1SubtitleView',
    cid: 123,
    page: 1,
    source: 'bilibili_subtitle',
    sourceType: 'bilibili_player_wbi_v2',
    language: 'zh-CN',
    lines: [
      { startSeconds: Number.NaN, endSeconds: 2, text: '非法空值时间' },
      { startSeconds: -1, endSeconds: 2, text: '非法负数时间' },
      { startSeconds: 2, endSeconds: Number.POSITIVE_INFINITY, text: '非法无限时间' },
      { startSeconds: 3.25, endSeconds: 5.5, text: '真实时间行' },
    ],
  });

  assert.ok(result);
  assert.equal(result.lineCount, 1);
  assert.equal(result.lines[0].startSeconds, 3.25);
  assert.equal(result.lines[0].endSeconds, 5.5);
  assert.equal(result.lines[0].text, '真实时间行');
});

test('subtitle viewing source identity is isolated from video, part, and source selection state', () => {
  const bilibili = source('bilibili_subtitle', 'B站字幕', [[0, 2, '同一分 P']]);
  const local = source('local_transcript', '本地转录', [[0, 2, '本地完成稿']]);
  const wrongPart = source('bilibili_subtitle', 'B站字幕', [[0, 2, '其他分 P']], { page: 2 });
  const context = videoContext();

  assert.equal(validateSubtitleViewingIdentity(context, bilibili), true);
  assert.equal(validateSubtitleViewingIdentity(context, wrongPart), false);
  assert.equal(shouldShowSubtitleViewingSourceSwitcher([bilibili]), false);
  assert.equal(shouldShowSubtitleViewingSourceSwitcher([bilibili, local]), true);
  assert.equal(
    selectDefaultSubtitleViewingSource([bilibili, local], local.identity.sourceIdentityKey)?.identity.sourceIdentityKey,
    local.identity.sourceIdentityKey,
  );

  const primarySelection = bilibili.identity.sourceIdentityKey;
  const viewed = selectDefaultSubtitleViewingSource([bilibili, local], local.identity.sourceIdentityKey);
  assert.equal(viewed?.identity.sourceIdentityKey, local.identity.sourceIdentityKey);
  assert.equal(primarySelection, bilibili.identity.sourceIdentityKey);
});

test('subtitle follow pauses on manual/search navigation and resumes at current playback', () => {
  const bilibili = source('bilibili_subtitle', 'B站字幕', [
    [0, 2, '第一句'],
    [2, 4, '第二句'],
    [4, 6, '第三句'],
  ]);
  const initial: CurrentVideoSubtitleFollowState = {
    mode: 'following',
    activeLineId: null,
    pausedReason: null,
  };

  const atThree = reduceCurrentVideoSubtitleFollowState(initial, { type: 'playback_tick', currentSeconds: 3 }, bilibili.lines);
  assert.equal(atThree.activeLineId, bilibili.lines[1].lineId);
  assert.equal(activeSubtitleLineAtTime(bilibili.lines, 8)?.lineId, bilibili.lines[2].lineId);

  const paused = reduceCurrentVideoSubtitleFollowState(atThree, { type: 'manual_scroll' }, bilibili.lines);
  assert.equal(paused.mode, 'paused');
  assert.equal(paused.pausedReason, 'manual_scroll');
  assert.equal(
    reduceCurrentVideoSubtitleFollowState(paused, { type: 'playback_tick', currentSeconds: 5 }, bilibili.lines).activeLineId,
    bilibili.lines[1].lineId,
  );

  const searchPaused = reduceCurrentVideoSubtitleFollowState(paused, {
    type: 'search_navigation',
    lineId: bilibili.lines[0].lineId,
  }, bilibili.lines);
  assert.equal(searchPaused.pausedReason, 'search_navigation');
  assert.equal(searchPaused.activeLineId, bilibili.lines[0].lineId);

  const resumed = reduceCurrentVideoSubtitleFollowState(searchPaused, { type: 'resume_follow', currentSeconds: 5 }, bilibili.lines);
  assert.equal(resumed.mode, 'following');
  assert.equal(resumed.pausedReason, null);
  assert.equal(resumed.activeLineId, bilibili.lines[2].lineId);
});

test('subtitle jump preview binds exact source text and real time range without seeking', () => {
  const bilibili = source('bilibili_subtitle', 'B站字幕', [[12.345, 15.75, '精确字幕原文']]);
  const preview = buildCurrentVideoSubtitleJumpPreview(bilibili, bilibili.lines[0]);
  assert.equal(preview.canJump, true);
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.targetSeconds, 12.345);
  assert.equal(preview.targetTimeLabel, '0:12');
  assert.equal(preview.timeRangeLabel, '0:12-0:15');
  assert.equal(preview.sourceText, '精确字幕原文');
  assert.equal(preview.sourceIdentityKey, bilibili.identity.sourceIdentityKey);
  assert.match(preview.lineBindingKey, /^[a-f0-9]{64}$/);

  const mutatedLine = { ...bilibili.lines[0], sourceIdentityKey: 'other-source' };
  const blocked = buildCurrentVideoSubtitleJumpPreview(bilibili, mutatedLine);
  assert.equal(blocked.canJump, false);
  assert.equal(blocked.targetSeconds, null);
});

function source(
  kind: 'bilibili_subtitle' | 'local_transcript',
  label: 'B站字幕' | '本地转录',
  rows: Array<[number, number, string]>,
  overrides: { bvid?: string; cid?: number; page?: number } = {},
) {
  const result = buildCurrentVideoSubtitleViewingSource({
    bvid: overrides.bvid ?? 'BV1SubtitleView',
    cid: overrides.cid ?? 123,
    page: overrides.page ?? 1,
    source: kind,
    sourceType: kind === 'bilibili_subtitle' ? 'bilibili_player_wbi_v2' : 'local_transcript',
    language: 'zh-CN',
    lines: rows.map(([startSeconds, endSeconds, text], index) => ({
      lineId: `${label}-${index + 1}`,
      startSeconds,
      endSeconds,
      text,
    })),
  });
  assert.ok(result);
  return result;
}

function videoContext(): CurrentVideoContext {
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1SubtitleView/',
    collectedAt: 1000,
    bvid: 'BV1SubtitleView',
    aid: 1,
    cid: 123,
    title: '字幕测试视频',
    authorName: '测试 UP',
    authorMid: 1,
    durationSeconds: 60,
    currentPart: {
      page: 1,
      title: '主视频',
      total: 1,
    },
    parts: [],
    chapters: [],
    description: {
      availability: 'available',
      text: null,
      length: null,
    },
    sources: {
      metadata: 'available',
      description: 'available',
      pages: 'available',
      chapters: 'unavailable',
      transcript: 'available',
      contentText: 'available',
    },
    warnings: [],
  };
}
