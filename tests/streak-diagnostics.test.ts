import assert from 'node:assert/strict';
import test from 'node:test';
import { computeStreakFromDateSet, dateKey } from '../src/shared/streak.ts';

test('thirty-day consecutive fixture reports longest streak of 30', () => {
  const dates = new Set(
    Array.from({ length: 30 }, (_, index) => dateKey(offsetDays(index))),
  );

  const streak = computeStreakFromDateSet(dates, dateKey());

  assert.equal(streak.current, 30);
  assert.equal(streak.longest, 30);
});

test('gapped history fixture reports current and longest streak separately', () => {
  const dates = new Set<string>([
    dateKey(offsetDays(0)),
    dateKey(offsetDays(1)),
    dateKey(offsetDays(10)),
    dateKey(offsetDays(11)),
    dateKey(offsetDays(12)),
    dateKey(offsetDays(13)),
    dateKey(offsetDays(14)),
  ]);

  const streak = computeStreakFromDateSet(dates, dateKey());

  assert.equal(streak.current, 2);
  assert.equal(streak.longest, 5);
});

function offsetDays(daysAgo: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
}
