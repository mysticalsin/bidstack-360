import { describe, expect, it } from 'vitest';

import { composeHealthScore, trendFromPrevious } from './health-score.service.js';

describe('composeHealthScore', () => {
  it('does not turn an empty account into a mid health score', () => {
    // WHY: missing activity used to floor at 10, missing tickets at 90,
    // missing NPS at 50, and no departure signal at 100. That composite
    // was a stored health number for an account with no measurements.
    expect(
      composeHealthScore({
        productUsage: null,
        engagement: null,
        supportTickets: null,
        nps: null,
        execSponsorStability: null,
      }),
    ).toBeNull();
  });

  it('uses only the factors that were measured', () => {
    expect(
      composeHealthScore({
        productUsage: null,
        engagement: null,
        supportTickets: null,
        nps: 80,
        execSponsorStability: null,
      }),
    ).toBe(80);
  });
});

describe('trendFromPrevious', () => {
  it('does not call the first score stable', () => {
    // WHY: the column default is STABLE. A single measurement has no direction.
    expect(trendFromPrevious(70, null)).toBeNull();
    expect(trendFromPrevious(70, 70)).toBe('STABLE');
    expect(trendFromPrevious(80, 70)).toBe('IMPROVING');
    expect(trendFromPrevious(60, 70)).toBe('DECLINING');
  });
});
