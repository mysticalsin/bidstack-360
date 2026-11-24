import { describe, expect, it } from 'vitest';

import { formatStage, formatMoney, daysUntil, taskDueChip } from './format.js';

describe('formatStage', () => {
  it('humanizes snake_case enum values for display', () => {
    expect(formatStage('closed_won')).toBe('Closed Won');
    expect(formatStage('s1_ongoing')).toBe('S1 Ongoing');
    expect(formatStage('in_progress')).toBe('In Progress');
  });
});

describe('formatMoney', () => {
  it('uses compact notation for sums >= 1M (so dashboard cards stay scannable)', () => {
    const out = formatMoney(1_240_000, 'EUR');
    expect(out).toMatch(/1\.24\s*M/);
  });

  it('uses zero-decimal notation under 1M', () => {
    const out = formatMoney(320_000, 'EUR');
    expect(out).toMatch(/320,000/);
  });
});

describe('daysUntil', () => {
  it('returns null for missing input (so callers can omit "due in" labels)', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
  });

  it('returns negative integer for past dates (overdue UX)', () => {
    const past = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    expect(daysUntil(past)).toBeLessThan(0);
  });
});

describe('taskDueChip', () => {
  it('keeps a normal overdue count', () => {
    expect(taskDueChip(-4, '2026-11-17')).toEqual({ kind: 'count', days: 4 });
  });

  it('names the date when a year-0001 task would read as hundreds of thousands of days late', () => {
    // WHY: sweep 09's synthetic due date 0001-01-01 rendered "739940d late".
    // The date is real. The day count is not a useful sentence.
    expect(taskDueChip(-739_940, '0001-01-01')).toEqual({ kind: 'since', when: '0001-01-01' });
  });
});
