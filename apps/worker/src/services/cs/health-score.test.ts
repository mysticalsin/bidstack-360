import { describe, expect, it } from 'vitest';

import { healthScoreFromSignals } from './index.js';

describe('healthScoreFromSignals', () => {
  it('does not start an account at 70 when nothing was measured', () => {
    // WHY: the nightly job used 70 plus a subscription bonus, and treated a
    // missing NPS as 0. An account with no survey and no open cases is not healthy.
    expect(healthScoreFromSignals({ openCases: 0, criticalCases: 0, npsScore: null })).toBeNull();
  });

  it('keeps a recorded NPS and a recorded case count', () => {
    const npsOnly = healthScoreFromSignals({ openCases: 0, criticalCases: 0, npsScore: 100 });
    expect(npsOnly).toBe(100);
    const cases = healthScoreFromSignals({ openCases: 2, criticalCases: 0, npsScore: null });
    expect(cases).toBe(92);
  });
});
