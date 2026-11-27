import { describe, expect, it } from 'vitest';

import { lockedStageProbability } from './stage-probability-lock';

describe('lockedStageProbability', () => {
  it('keeps a won stage at 100, including demo Closed Won', () => {
    // WHY: Closed Won is stored at 100. The editor treated 0 as a typed
    // percent, so clearing or typing 0 saved a won stage as no probability.
    expect(lockedStageProbability({ isWon: true, isLost: false })).toBe(100);
    expect(lockedStageProbability({ isWon: true, isLost: true })).toBe(100);
  });

  it('keeps a lost stage at 0', () => {
    // WHY: Closed Lost is 0 on purpose. A typed 40 would mark a loss as open pipeline.
    expect(lockedStageProbability({ isWon: false, isLost: true })).toBe(0);
  });

  it('leaves an open stage editable', () => {
    // WHY: Demo S3 Technical Iteration is 60 and an admin may change it.
    // The lock is only the terminal stages.
    expect(lockedStageProbability({ isWon: false, isLost: false })).toBeNull();
  });
});
