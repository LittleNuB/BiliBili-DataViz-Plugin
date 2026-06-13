import assert from 'node:assert/strict';
import test from 'node:test';
import type { WatchHistoryRecord } from '../src/shared/types/watch-event.ts';
import {
  buildHistoryCoverage,
  buildPreferenceWindowOptions,
  buildPreferenceWindowSummary,
} from '../src/background/analytics/preference-windows.ts';

test('daily windows keep empty dates between earliest and latest records', () => {
  const records = [
    makeRecord('2026-06-10', 1800, '动画', ['番剧']),
    makeRecord('2026-06-13', 1200, '音乐', ['翻唱']),
  ];
  const coverage = buildHistoryCoverage(records[0], records[1], records.length, records);

  const dailyWindows = buildPreferenceWindowOptions(records, coverage, 'daily');

  assert.equal(dailyWindows.length, 4);
  const emptyDay = dailyWindows.find(window => window.startDate === '2026-06-11');
  assert.ok(emptyDay);
  assert.equal(emptyDay.recordCount, 0);
  assert.equal(emptyDay.totalWatchTime, 0);
});

test('weekly and monthly windows use natural boundaries and mark partial local coverage', () => {
  const records = [
    makeRecord('2026-06-10', 1800, '动画', ['番剧']),
    makeRecord('2026-06-13', 1200, '音乐', ['翻唱']),
  ];
  const coverage = buildHistoryCoverage(records[0], records[1], records.length, records);

  const weeklyWindow = buildPreferenceWindowOptions(records, coverage, 'weekly')[0];
  const monthlyWindow = buildPreferenceWindowOptions(records, coverage, 'monthly')[0];

  assert.equal(weeklyWindow.startDate, '2026-06-08');
  assert.equal(weeklyWindow.endDate, '2026-06-14');
  assert.equal(weeklyWindow.partialCoverage, true);
  assert.equal(monthlyWindow.startDate, '2026-06-01');
  assert.equal(monthlyWindow.endDate, '2026-06-30');
  assert.equal(monthlyWindow.partialCoverage, true);
});

test('empty windows return explicit no-record state', () => {
  const records = [
    makeRecord('2026-06-10', 1800, '动画', ['番剧']),
    makeRecord('2026-06-13', 1200, '音乐', ['翻唱']),
  ];
  const coverage = buildHistoryCoverage(records[0], records[1], records.length, records);
  const emptyWindow = buildPreferenceWindowOptions(records, coverage, 'daily')
    .find(window => window.startDate === '2026-06-11');

  assert.ok(emptyWindow);
  const summary = buildPreferenceWindowSummary(records, emptyWindow);

  assert.equal(summary.state, 'empty');
  assert.equal(summary.stateReason, 'no_records');
  assert.deepEqual(summary.categories, []);
  assert.deepEqual(summary.topTags, []);
});

test('low-sample windows stay available but do not become ready charts', () => {
  const records = [
    makeRecord('2026-06-10', 1800, '动画', ['番剧']),
    makeRecord('2026-06-13', 1200, '音乐', ['翻唱']),
  ];
  const coverage = buildHistoryCoverage(records[0], records[1], records.length, records);
  const weeklyWindow = buildPreferenceWindowOptions(records, coverage, 'weekly')[0];

  const summary = buildPreferenceWindowSummary(records, weeklyWindow);

  assert.equal(summary.window.recordCount, 2);
  assert.equal(summary.state, 'insufficient_sample');
  assert.equal(summary.stateReason, 'too_few_records');
  assert.equal(summary.categories.length, 2);
});

test('records without effective watch time stay in empty state', () => {
  const records = [
    makeRecord('2026-06-12', 0, '游戏', ['实况']),
    makeRecord('2026-06-12', 0, '游戏', ['攻略']),
    makeRecord('2026-06-12', 0, '知识', ['科普']),
  ];
  const coverage = buildHistoryCoverage(records[0], records[2], records.length, records);
  const dailyWindow = buildPreferenceWindowOptions(records, coverage, 'daily')[0];

  const summary = buildPreferenceWindowSummary(records, dailyWindow);

  assert.equal(summary.window.recordCount, 3);
  assert.equal(summary.window.totalWatchTime, 0);
  assert.equal(summary.state, 'empty');
  assert.equal(summary.stateReason, 'no_watch_time');
});

function makeRecord(
  day: string,
  progress: number,
  tagName: string,
  tags: string[],
): WatchHistoryRecord {
  const [year, month, date] = day.split('-').map(Number);
  return {
    sessionKey: `${day}-${tagName}`,
    kid: year * 10000 + month * 100 + date,
    avid: year * 10000 + month * 100 + date,
    bvid: `BV${year}${month}${date}${tagName}`,
    cid: month * 100 + date,
    title: `${tagName} ${day}`,
    authorName: '测试UP',
    authorMid: 42,
    tagName,
    tags,
    cover: '',
    viewAt: Math.floor(new Date(year, month - 1, date, 12, 0, 0, 0).getTime() / 1000),
    progress,
    duration: Math.max(progress, 600),
    actualCompletion: 1,
    deviceType: 1,
    isFavorite: false,
    business: 'archive',
    dt: 0,
    syncedAt: Date.now(),
  };
}
