import { describe, expect, it } from 'vitest';

import { builtinWidgetRows, resolveBuiltinSource } from './builtinWidgetData';

const pipeline = {
  weightedPipeline: 7_060_500,
  byStage: [
    { stage: 's1_ongoing', count: 3, valueSum: 3_700_000 },
    { stage: 'closed_won', count: 8, valueSum: 7_860_000 },
    { stage: 'closed_lost', count: 4, valueSum: 3_660_000 },
    { stage: 's4_negotiation', count: 1, valueSum: 4_800_000 },
  ],
};

describe('builtin dashboard widgets', () => {
  it('binds the seeded untitled-report widgets to the live pipeline', () => {
    // WHY: the seed creates these two widgets with no reportId. Resolving them
    // by title is what stops Analytics from rendering an empty-period message
    // on top of a book of open deals.
    expect(
      resolveBuiltinSource({
        title: 'Weighted Pipeline',
        config: { format: 'currency' },
      }),
    ).toBe('weighted-pipeline');
    expect(
      resolveBuiltinSource({
        title: 'Pipeline by Stage',
        config: { subtitle: 'Open opportunity value grouped by sales stage' },
      }),
    ).toBe('pipeline-by-stage');
  });

  it('lets an explicit source win and leaves report-backed widgets alone', () => {
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
  });

  it('keeps a zero weighted pipeline visible and drops closed stages from the bar', () => {
    // WHY: closed_won inflates "open pipeline by stage" if it is left in the
    // series. A genuine zero weighted value must still be a row so the KPI
    // shows 0 instead of the empty-period copy.
    expect(builtinWidgetRows('weighted-pipeline', { ...pipeline, weightedPipeline: 0 })).toEqual([
      { value: 0 },
    ]);
    expect(builtinWidgetRows('pipeline-by-stage', pipeline)).toEqual([
      { name: 's1 ongoing', value: 3_700_000 },
      { name: 's4 negotiation', value: 4_800_000 },
    ]);
  });
});
