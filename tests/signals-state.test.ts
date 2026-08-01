import assert from 'node:assert/strict';
import test from 'node:test';

import { activeTab } from '../dashboard/signals.ts';
import {
  completionPercent,
  quickStats,
  todayPercent,
} from '../popup/signals.ts';

test('dashboard signals retain direct value updates', () => {
  const previous = activeTab.value;

  try {
    activeTab.value = 4;
    assert.equal(activeTab.value, 4);
  } finally {
    activeTab.value = previous;
  }
});

test('popup computed signals react to QuickStats updates', () => {
  const previous = quickStats.value;

  try {
    quickStats.value = {
      todayWatchTime: 45,
      dailyGoal: 60,
      streakDays: 2,
      avgCompletion: 0.734,
      efficiencyScore: 80,
      weeklyWatchTime: 120,
      weeklyLocalPcWatchTime: 90,
      weeklyLocalPcDays: 3,
    };

    assert.equal(completionPercent.value, 73);
    assert.equal(todayPercent.value, 75);
  } finally {
    quickStats.value = previous;
  }
});
