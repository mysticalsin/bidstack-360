import { describe, expect, it } from 'vitest';

import { recencyBadge, recencyOf, recencyTitle } from './recency';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('meeting recency', () => {
  it('green within 30 days, amber to 90, grey after, none when never met', () => {
    expect(recencyOf(ago(0), NOW)).toBe('recent');
    expect(recencyOf(ago(30), NOW)).toBe('recent');
    expect(recencyOf(ago(31), NOW)).toBe('warm');
    expect(recencyOf(ago(90), NOW)).toBe('warm');
    expect(recencyOf(ago(91), NOW)).toBe('stale');
    expect(recencyOf(null, NOW)).toBe('never');
    expect(recencyOf('not a date', NOW)).toBe('never');
    expect(recencyOf(ago(3), 0)).toBe('never'); // no reference time yet
  });
  it('badges say "Met recently" or how many weeks ago; grey and never get none', () => {
    expect(recencyBadge(ago(4), NOW)).toBe('Met recently');
    expect(recencyBadge(ago(45), NOW)).toBe('Met 6 wk ago');
    expect(recencyBadge(ago(32), NOW)).toBe('Met 5 wk ago');
    expect(recencyBadge(ago(200), NOW)).toBeNull();
    expect(recencyBadge(null, NOW)).toBeNull();
  });
  it('tooltip carries the last meeting date', () => {
    expect(recencyTitle('2026-10-12T10:00:00Z')).toMatch(/^Last met .*2026/);
    expect(recencyTitle(null)).toBe('Not met yet');
  });
});
