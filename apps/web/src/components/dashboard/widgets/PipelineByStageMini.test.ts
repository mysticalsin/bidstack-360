import { describe, expect, it } from 'vitest';

import { openPipelineStages } from './PipelineByStageMini';

describe('openPipelineStages', () => {
  it('keeps closed won and lost out of the open pipeline chart', () => {
    const open = openPipelineStages([
      { stage: 'screening', count: 1, valueSum: 2_700_000 },
      { stage: 'closed_won', count: 4, valueSum: 9_000_000 },
      { stage: 'closed_lost', count: 2, valueSum: 1_000_000 },
    ]);

    expect(open.map((stage) => stage.stage)).toEqual(['screening']);
  });
});
