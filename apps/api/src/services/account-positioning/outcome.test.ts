import { describe, expect, it } from 'vitest';

import { positioningDealOutcome } from './load';

describe('positioningDealOutcome', () => {
  it('keeps a live lost stage out of the open pipeline', () => {
    // WHY: the open set was the enum list, so a lost stage on s3 stayed open and never counted as a loss.
    const deal = {
      stage: 's3_technical_iteration',
      pipelineStage: { isWon: false, isLost: true, deletedAt: null },
    };
    expect(positioningDealOutcome(deal)).toBe('lost');
  });

  it('lets lost win when the live stage is both won and lost', () => {
    expect(
      positioningDealOutcome({
        stage: 'closed_won',
        pipelineStage: { isWon: true, isLost: true, deletedAt: null },
      }),
    ).toBe('lost');
  });

  it('does not close a deal whose stage row was deleted', () => {
    expect(
      positioningDealOutcome({
        stage: 's3_technical_iteration',
        pipelineStage: { isWon: false, isLost: true, deletedAt: new Date('2026-02-01T00:00:00.000Z') },
      }),
    ).toBe('open');
  });
});
