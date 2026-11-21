import { describe, expect, it } from 'vitest';

import { formatMicrosCompact } from './dashboard.utils.js';

describe('cockpit revenue compact', () => {
  it('keeps a revenue figure when one compact digit would move it', () => {
    // WHY: 7,860,000 became 7.9M, and a dollar sign invented a currency
    // the company row does not store. Supersedes PR #67.
    expect(formatMicrosCompact(2_000_000_000_000)).toBe('2M unspecified');
    expect(formatMicrosCompact(7_860_000_000_000)).toBe('7.86M unspecified');
    expect(formatMicrosCompact(12_015_000_000_000)).toBe('12,015,000 unspecified');
    expect(formatMicrosCompact(9_007_199_254_740_991)).toBe('9,007,199,254.74 unspecified');
    expect(formatMicrosCompact(2_000_000_000_000)).not.toMatch(/[$€]|EUR|USD/);
  });
});
