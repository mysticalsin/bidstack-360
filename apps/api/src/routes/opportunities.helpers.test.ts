import { describe, expect, it } from 'vitest';

import { stageMoveDiff } from './opportunities.helpers';

describe('stageMoveDiff', () => {
  it('records a lost move so a patch cannot drop the stage event', () => {
    expect(
      stageMoveDiff(
        { stage: 's4_negotiation', pipelineStageId: 'stage-old' },
        { stage: 'closed_lost', pipelineStageId: 'stage-lost' },
      ),
    ).toEqual({
      fromStage: 's4_negotiation',
      toStage: 'closed_lost',
      fromPipelineStageId: 'stage-old',
      toPipelineStageId: 'stage-lost',
    });
  });

  it('does not emit an event when the stage is unchanged', () => {
    expect(
      stageMoveDiff(
        { stage: 's2_sent', pipelineStageId: 'stage-1' },
        { stage: 's2_sent', pipelineStageId: 'stage-1' },
      ),
    ).toBeNull();
  });
});
