import { describe, expect, it } from 'vitest';

import { capDealSample, DASHBOARD_DEAL_SAMPLE } from './dashboard.utils';

describe('capDealSample', () => {
  it('keeps a book of 100 and marks a book of 101', () => {
    // WHY: the dashboard reads 101 deals. The 101st proves the pipeline
    // figure is not the whole book. A book that fits must not be called a sample.
    const exact = Array.from({ length: DASHBOARD_DEAL_SAMPLE }, (_, index) => index);
    expect(capDealSample(exact)).toEqual({ rows: exact, capped: false });

    const over = Array.from({ length: DASHBOARD_DEAL_SAMPLE + 1 }, (_, index) => index);
    const capped = capDealSample(over);
    expect(capped.capped).toBe(true);
    expect(capped.rows).toHaveLength(DASHBOARD_DEAL_SAMPLE);
    expect(capped.rows[0]).toBe(0);
    expect(capped.rows.at(-1)).toBe(DASHBOARD_DEAL_SAMPLE - 1);
  });

  it('caps at 100 for every length, and only when the extra row exists', () => {
    // WHY: the label is a property of the sample size, not of one fixture.
    for (const length of [0, 1, 99, 100, 101, 250]) {
      const rows = Array.from({ length }, (_, index) => index);
      const sample = capDealSample(rows);
      expect(sample.rows).toHaveLength(Math.min(length, DASHBOARD_DEAL_SAMPLE));
      expect(sample.capped).toBe(length > DASHBOARD_DEAL_SAMPLE);
      expect(sample.rows).toEqual(rows.slice(0, DASHBOARD_DEAL_SAMPLE));
    }
  });
});
