import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatStage, formatMoney, daysUntil } from './format.js';

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

  // A task dueDate is a calendar day (YYYY-MM-DD), the same contract as
  // due_date < today's UTC date on the dashboard overdue count. Elapsed
  // milliseconds round a due-today follow-up to -1 after 12:00 UTC, so Needs
  // you says 0 overdue tasks and the list it opens says the follow-up is late.
  it('keeps a date-only due day at 0 for the whole UTC day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T18:00:00.000Z'));
    expect(daysUntil('2026-11-25')).toBe(0);
    expect(daysUntil('2026-11-24')).toBe(-1);
    expect(daysUntil('2026-11-26')).toBe(1);
  });

  it('still rounds a timestamp by elapsed time so a results clock is unchanged', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T18:00:00.000Z'));
    expect(daysUntil('2026-11-25T00:00:00.000Z')).toBe(-1);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
