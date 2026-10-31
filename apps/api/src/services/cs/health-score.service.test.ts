import { describe, expect, it } from 'vitest';

import { composeHealthScore } from './health-score.service.js';

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
