import { describe, expect, it } from 'vitest';

import { describeSparkline } from './sparkline-geometry';

describe('describeSparkline', () => {
  it('does not round a point to the next compact digit', () => {
    // WHY: one compact digit made 7,860,000 sound like 7.9 million to a screen reader.
    const summary = describeSparkline([7_860_000, 12_015_000]);
    expect(summary).toContain('7.86');
    expect(summary).not.toMatch(/7\.9/);
    expect(summary).toContain('12,015,000');
    expect(summary).not.toMatch(/12\.0/);
  });

  it('keeps an exact million compact', () => {
    expect(describeSparkline([1_500_000, 2_000_000])).toMatch(/1\.5/);
  });
});
