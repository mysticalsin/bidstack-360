import { describe, expect, it } from 'vitest';

import { pipelineColumnKpis } from './pipeline-column-kpis';

describe('pipelineColumnKpis', () => {
  it('sums an open column into value and open pipeline', () => {
    // WHY: a focused open stage is those cards. A second stage's bid is not
    // in the list the board passed in, so it cannot inflate the open count.
    const kpis = pipelineColumnKpis({
      stageName: 'Qualification',
      isClosed: false,
      values: [2_500],
      pageContinues: false,
    });
    expect(kpis).toEqual({
      stageName: 'Qualification',
      value: 2_500,
      openValue: 2_500,
      dealCount: 1,
      openCount: 1,
      pageContinues: false,
    });
  });

  it('keeps a won column out of open pipeline', () => {
    const kpis = pipelineColumnKpis({
      stageName: 'Closed Won',
      isClosed: true,
      values: [410_000],
      pageContinues: false,
    });
    expect(kpis.openValue).toBe(0);
    expect(kpis.openCount).toBe(0);
    expect(kpis.dealCount).toBe(1);
    expect(kpis.value).toBe(410_000);
  });

  it('is zero when the column has no cards', () => {
    const kpis = pipelineColumnKpis({
      stageName: 'Proposal Sent',
      isClosed: false,
      values: [],
      pageContinues: true,
    });
    expect(kpis.value).toBe(0);
    expect(kpis.openValue).toBe(0);
    expect(kpis.dealCount).toBe(0);
    expect(kpis.openCount).toBe(0);
    expect(kpis.pageContinues).toBe(true);
  });
});
