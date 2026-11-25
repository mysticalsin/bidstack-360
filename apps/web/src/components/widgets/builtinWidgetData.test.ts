import { describe, expect, it } from 'vitest';

import { builtinWidgetRows, resolveBuiltinSource } from './builtinWidgetData';

const pipeline = {
  weightedPipeline: 7_060_500,
  byStage: [
    { stage: 's1_ongoing', count: 3, valueSum: 3_700_000 },
    { stage: 'closed_won', count: 8, valueSum: 7_860_000 },
    { stage: 'closed_lost', count: 4, valueSum: 3_660_000 },
    { stage: 's4_negotiation', count: 1, valueSum: 4_800_000 },
    { stage: 's3_technical_iteration', count: 2, valueSum: 1_240_000 },
  ],
};

describe('builtin dashboard widgets', () => {
  it('binds the seeded untitled-report widgets to the live pipeline', () => {
    // WHY: the demo seed creates these two widgets with no reportId. Resolving
    // them by title is what stops Analytics from saying the period is empty
    // on top of a book of open deals.
    expect(
      resolveBuiltinSource({
        title: 'Weighted Pipeline',
        config: { format: 'currency', subtitle: 'Open opportunities, probability-weighted' },
      }),
    ).toBe('weighted-pipeline');
    expect(
      resolveBuiltinSource({
        title: 'Pipeline by Stage',
        config: { subtitle: 'Open opportunity value grouped by sales stage' },
      }),
    ).toBe('pipeline-by-stage');
  });

  it('lets an explicit source win and leaves a saved report in charge', () => {
    // WHY: a saved report owns its series. Overlaying the pipeline snapshot
    // would hide the query the widget was pointed at.
    expect(
      resolveBuiltinSource({
        title: 'Something else',
        config: { source: 'weighted-pipeline' },
      }),
    ).toBe('weighted-pipeline');
    expect(
      resolveBuiltinSource({
        title: 'Weighted Pipeline',
        reportId: 'rep-1',
        config: { source: 'weighted-pipeline' },
      }),
    ).toBeNull();
    expect(
      resolveBuiltinSource({
        title: 'Win rate',
        config: {},
      }),
    ).toBeNull();
  });

  it('keeps a zero weighted pipeline visible and charts open stages in pipeline order', () => {
    // WHY: closed_won inflates "open pipeline by stage" if it stays in the
    // series. A genuine zero weighted value must still be a row so the KPI
    // shows 0 instead of the empty-period copy. Stage captions match the
    // rest of the book (S1 Ongoing), in stage order, not groupBy order.
    expect(builtinWidgetRows('weighted-pipeline', { ...pipeline, weightedPipeline: 0 })).toEqual([
      { value: 0 },
    ]);
    expect(builtinWidgetRows('pipeline-by-stage', pipeline)).toEqual([
      { name: 'S1 Ongoing', value: 3_700_000 },
      { name: 'S3 Technical Iteration', value: 1_240_000 },
      { name: 'S4 Negotiation', value: 4_800_000 },
    ]);
  });

  it('charts no bars when every stage is already closed', () => {
    expect(
      builtinWidgetRows('pipeline-by-stage', {
        weightedPipeline: 0,
        byStage: [{ stage: 'closed_won', count: 2, valueSum: 500_000 }],
      }),
    ).toEqual([]);
  });
});
