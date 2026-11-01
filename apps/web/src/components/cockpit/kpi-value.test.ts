import { describe, expect, it } from 'vitest';

import { kpiFractionWouldMove } from './kpi-value';

describe('kpiFractionWouldMove', () => {
  it('keeps a label when one fraction digit would move it', () => {
    // WHY: the count-up settled on 7.9 after the tile had already said 7.86.
    expect(kpiFractionWouldMove('7.86', 'en-GB')).toBe(true);
    expect(kpiFractionWouldMove('12.0', 'en-GB')).toBe(true);
    expect(kpiFractionWouldMove('1.5', 'en-GB')).toBe(false);
    expect(kpiFractionWouldMove('12015', 'en-GB')).toBe(false);
  });
});
