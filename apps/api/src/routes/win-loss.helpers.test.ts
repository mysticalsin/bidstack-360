import { describe, expect, it } from 'vitest';

import { salesCycleDays } from './win-loss.helpers.js';

describe('salesCycleDays', () => {
  it('counts whole days from opening the bid to recording the outcome', () => {
    expect(salesCycleDays(new Date('2026-01-01T09:00:00Z'), new Date('2026-03-02T08:00:00Z'))).toBe(60);
  });

  it('is null when the outcome predates the bid (imported history)', () => {
    expect(salesCycleDays(new Date('2026-03-02T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('counts a same-day close as zero days', () => {
    expect(salesCycleDays(new Date('2026-03-02T08:00:00Z'), new Date('2026-03-02T17:00:00Z'))).toBe(0);
  });
});
