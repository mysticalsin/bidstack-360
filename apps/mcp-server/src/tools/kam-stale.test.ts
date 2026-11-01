import { describe, expect, it } from 'vitest';

import { staleBefore } from './kam-tools.js';

describe('staleBefore', () => {
  it('counts an initiative 14 UTC dates old as stale in the afternoon', () => {
    // WHY: subtracting 14 periods of 24 hours from 15:00 left the 18:00
    // activity from 14 UTC dates earlier inside the fresh window, so Dust's
    // KPI under-counted stale initiatives.
    const now = Date.parse('2026-11-15T15:00:00.000Z');
    const cutoff = staleBefore(14, now);
    expect(new Date('2026-11-01T18:00:00.000Z').getTime() < cutoff.getTime()).toBe(true);
    expect(new Date('2026-11-02T00:00:00.000Z').getTime() < cutoff.getTime()).toBe(false);
  });
});
