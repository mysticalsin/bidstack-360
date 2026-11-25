import { describe, expect, it } from 'vitest';

import { pipelineColumnConversion } from './pipeline-column-conversion';

describe('pipelineColumnConversion', () => {
  it('does not call an empty lead column 100% converted', () => {
    // WHY: demo S1 Lead holds no bids. Every other open or won card sits
    // later, so advanced / (0 + advanced) is 100. That is not a lead
    // conversion. An empty column has no rate.
    expect(
      pipelineColumnConversion({
        stageCount: 0,
        laterCount: 7,
        isClosed: false,
        pageContinues: false,
      }),
    ).toBeNull();
  });

  it('keeps the snapshot rate when this column still holds bids', () => {
    // WHY: S1 Ongoing holds 3 demo bids and 4 sit further along, excluding
    // the loss. That share is the rate the chip already meant to show.
    expect(
      pipelineColumnConversion({
        stageCount: 3,
        laterCount: 4,
        isClosed: false,
        pageContinues: false,
      }),
    ).toBe(57);
  });

  it('is zero when nothing has moved past a column that still has bids', () => {
    expect(
      pipelineColumnConversion({
        stageCount: 1,
        laterCount: 0,
        isClosed: false,
        pageContinues: false,
      }),
    ).toBe(0);
  });

  it('does not invent a rate from a partial board page', () => {
    // WHY: the column count already says the cards are not every bid.
    // A percent beside that sentence would still read as the stage rate.
    expect(
      pipelineColumnConversion({
        stageCount: 3,
        laterCount: 4,
        isClosed: false,
        pageContinues: true,
      }),
    ).toBeNull();
  });

  it('does not rate a won or lost column', () => {
    expect(
      pipelineColumnConversion({
        stageCount: 1,
        laterCount: 2,
        isClosed: true,
        pageContinues: false,
      }),
    ).toBeNull();
  });
});
