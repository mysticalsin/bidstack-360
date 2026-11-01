import { describe, expect, it } from 'vitest';

import { openPipelineStages, pipelineHeadline } from './pipeline-headline';

describe('openPipelineStages', () => {
  it('keeps closed won and lost out of the open pipeline chart', () => {
    const open = openPipelineStages([
      { stage: 'screening', count: 1, valueSum: 2_700_000 },
      { stage: 'closed_won', count: 4, valueSum: 9_000_000 },
      { stage: 'closed_lost', count: 2, valueSum: 1_000_000 },
    ]);

    expect(open.map((stage) => stage.stage)).toEqual(['screening']);
  });

  it('does not fold closed outcomes into the open pipeline', () => {
    // WHY: "total pipeline" used to add won and lost value into the open book.
    const headline = pipelineHeadline([
      { stage: 'screening', count: 1, valueSum: 2_700_000 },
      { stage: 'closed_won', count: 4, valueSum: 9_000_000 },
      { stage: 'closed_lost', count: 2, valueSum: 1_000_000 },
    ]);
    expect(headline.openValue).toBe(2_700_000);
    expect(headline.openCount).toBe(1);
    expect(headline.wonValue).toBe(9_000_000);
    expect(headline.lostValue).toBe(1_000_000);
    expect(headline.winRate).toBeCloseTo(4 / 6);
  });
});
