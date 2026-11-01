import { describe, expect, it } from 'vitest';

import { capDealSample, DASHBOARD_DEAL_SAMPLE } from './dashboard.utils';

describe('capDealSample', () => {
  it('keeps a short book and does not call it truncated', () => {
    // WHY: a small org whose deals all fit must not be told the pipeline is a sample.
    const rows = Array.from({ length: DASHBOARD_DEAL_SAMPLE }, (_, index) => index);
    expect(capDealSample(rows)).toEqual({ rows, capped: false });
  });

  it('stops at 100 and marks the sample when one more deal exists', () => {
    // WHY: the dashboard query reads 101 rows. The 101st proves the pipeline
    // figure is not the whole book.
    const rows = Array.from({ length: DASHBOARD_DEAL_SAMPLE + 1 }, (_, index) => index);
    const capped = capDealSample(rows);
    expect(capped.capped).toBe(true);
    expect(capped.rows).toHaveLength(DASHBOARD_DEAL_SAMPLE);
    expect(capped.rows[0]).toBe(0);
    expect(capped.rows.at(-1)).toBe(DASHBOARD_DEAL_SAMPLE - 1);
  });
});
