import { describe, expect, it } from 'vitest';

import { financialHonesty, recordedProbability } from './intel-honesty';

describe('financial rows do not present the intel payload as a measurement', () => {
  it('labels a missing figure unknown and a stored scalar as a proxy', () => {
    // WHY: seed intel carries market-cap and rating numbers with no source
    // receipt. Printing them (or "Private") reads as a queried financial.
    expect(financialHonesty(null)).toBe('unknown');
    expect(financialHonesty(undefined)).toBe('unknown');
    expect(financialHonesty('')).toBe('unknown');
    expect(financialHonesty(4_800_000_000)).toBe('proxy');
    expect(financialHonesty('A-')).toBe('proxy');
  });

  it('does not echo provider names or a raw object as if that source was queried', () => {
    expect(financialHonesty('Crunchbase, LinkedIn, EU register')).toBe('source not probed');
    expect(financialHonesty({ marketCap: 1, source: 'SEC EDGAR' })).toBe('source not probed');
    expect(financialHonesty(['Apollo', 'Wikidata'])).toBe('source not probed');
  });
});

describe('deal probability is a stored proxy, not a measured likelihood', () => {
  it('keeps a recorded number and hides anything that is not one', () => {
    // WHY: the header used to say "40% likely". The column is an editable
    // stored figure. Absence must not be filled with a new score.
    expect(recordedProbability(40)).toBe(40);
    expect(recordedProbability(0)).toBe(0);
    expect(recordedProbability(null)).toBeNull();
    expect(recordedProbability(undefined)).toBeNull();
    expect(recordedProbability('40')).toBeNull();
    expect(recordedProbability(Number.NaN)).toBeNull();
  });
});
