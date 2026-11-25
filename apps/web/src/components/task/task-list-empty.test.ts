import { afterEach, describe, expect, it, vi } from 'vitest';

import { lateCountWhenTodayIsEmpty, showQuickAdd } from './task-list-empty';

// Demo follow-ups are dated May 2026. On 25 Nov 2026 the Today chip matches
// none of them. The loaded page still has those rows, because Today is not a
// server filter. A finished follow-up and one due in December are not the
// late book the empty state should point at.
const NOW = new Date('2026-11-25T18:00:00.000Z');

const PRICING = {
  dueDate: '2026-05-15',
  status: 'in_progress',
};
const RUSH = {
  dueDate: '2026-05-12',
  status: 'open',
};

describe('lateCountWhenTodayIsEmpty', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the May demo follow-ups when Today shows nothing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(
      lateCountWhenTodayIsEmpty('today', 0, [
        PRICING,
        RUSH,
        { dueDate: '2026-05-12', status: 'done' },
        { dueDate: '2026-12-01', status: 'open' },
        { dueDate: null, status: 'open' },
      ]),
    ).toBe(2);
  });

  it('stays quiet when Today already has a row or the filter is not Today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(lateCountWhenTodayIsEmpty('today', 1, [PRICING])).toBe(0);
    expect(lateCountWhenTodayIsEmpty('overdue', 0, [PRICING])).toBe(0);
    expect(lateCountWhenTodayIsEmpty('all', 0, [PRICING])).toBe(0);
  });
});

describe('showQuickAdd', () => {
  it('hides the quick-add on an empty Today view so a new open follow-up is not a silent miss', () => {
    expect(showQuickAdd('today', 0)).toBe(false);
    expect(showQuickAdd('overdue', 0)).toBe(false);
    expect(showQuickAdd('done', 0)).toBe(false);
  });

  it('keeps the quick-add on All, on Open, and on a filter that already lists rows', () => {
    expect(showQuickAdd('all', 0)).toBe(true);
    expect(showQuickAdd('open', 0)).toBe(true);
    expect(showQuickAdd('today', 1)).toBe(true);
  });
});
