import { describe, expect, it } from 'vitest';

import { pipelineKpiReadiness, type PipelineKpiReport } from './pipeline-kpi';

const emptyBook: PipelineKpiReport = {
  byStage: [],
  totalOpen: 0,
  totalValueOpen: 0,
};

describe('pipelineKpiReadiness', () => {
  it('holds the totals while either read is still in flight', () => {
    // A placeholder, not a zero book: the board skeleton is still up, or the
    // report has not answered, so "No closed bids" would be a guess.
    expect(
      pipelineKpiReadiness({
        opportunitiesLoading: true,
        reportLoading: false,
        report: undefined,
      }),
    ).toBe('loading');
    expect(
      pipelineKpiReadiness({
        opportunitiesLoading: false,
        reportLoading: true,
        report: undefined,
      }),
    ).toBe('loading');
  });

  it('treats a missing report as unavailable once the board has bids', () => {
    expect(
      pipelineKpiReadiness({
        opportunitiesLoading: false,
        reportLoading: false,
        report: undefined,
      }),
    ).toBe('unavailable');
    expect(
      pipelineKpiReadiness({
        opportunitiesLoading: false,
        reportLoading: false,
        report: null,
      }),
    ).toBe('unavailable');
  });

  it('keeps a settled zero book, including an empty stage list', () => {
    // A report that answered with nothing closed is a real answer.
    expect(
      pipelineKpiReadiness({
        opportunitiesLoading: false,
        reportLoading: false,
        report: emptyBook,
      }),
    ).toBe('ready');
  });
});
