import { describe, expect, it } from 'vitest';

import { convertOpportunityMicros } from './leads.write.routes.js';

describe('convertOpportunityMicros', () => {
  it('keeps a digit string when the JSON number collapses', () => {
    // WHY: BigInt(Math.trunc(number)) stored the collapsed value, one unit low.
    const micros = '9007199254740993';
    expect(Number(micros)).toBe(9007199254740992);
    expect(convertOpportunityMicros(micros)).toBe(9007199254740993n);
    expect(convertOpportunityMicros(750_000_000)).toBe(750_000_000n);
    expect(convertOpportunityMicros(undefined)).toBe(0n);
    expect(() => convertOpportunityMicros(Number(micros))).toThrow(/JSON number/);
  });
});
