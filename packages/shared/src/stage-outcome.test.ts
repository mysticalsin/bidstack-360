import { describe, expect, it } from 'vitest';

import { lostOutcomeWhere, stageOutcome, type StageClassification, type StageOutcome } from './stage-outcome';

const FLAGS = [false, true] as const;

/** The rule the predicate and the SQL filter both have to follow. */
function expectedOutcome(deal: StageClassification): StageOutcome {
  const live = deal.pipelineStage && !deal.pipelineStage.deletedAt ? deal.pipelineStage : null;
  const token = (deal.stage ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (token === 'closed lost' || live?.isLost === true) return 'lost';
  if (token === 'closed won' || live?.isWon === true) return 'won';
  return 'open';
}

describe('stageOutcome', () => {
  it('keeps a live lost stage lost, and a deleted stage row open', () => {
    // WHY: charts and totals that only compare the name with closed_lost
    // leave a custom lost stage in the open book. Deleting the stage row
    // must not close the deal.
    expect(
      stageOutcome({
        stage: 'Price lost',
        pipelineStage: { isWon: false, isLost: true, deletedAt: null },
      }),
    ).toBe('lost');
    expect(
      stageOutcome({
        stage: 's2_sent',
        pipelineStage: { isLost: true, deletedAt: '2026-02-01T00:00:00.000Z' },
      }),
    ).toBe('open');
  });

  it('lets lost win when a live stage is marked both won and lost', () => {
    expect(
      stageOutcome({
        stage: 'closed_won',
        pipelineStage: { isWon: true, isLost: true, deletedAt: null },
      }),
    ).toBe('lost');
  });

  it('matches the lost filter for every stored flag combination', () => {
    // WHY: a second copy of this rule in the query would drift. Lost is the
    // enum or a live isLost flag. A deleted stage row is not that flag.
    const stages = ['s2_sent', 'closed_lost', 'closed_won', 's4_negotiation'] as const;
    for (const stage of stages) {
      for (const isWon of FLAGS) {
        for (const isLost of FLAGS) {
          for (const deleted of FLAGS) {
            const deal: StageClassification = {
              stage,
              pipelineStage: {
                isWon,
                isLost,
                deletedAt: deleted ? new Date('2026-02-01T00:00:00.000Z') : null,
              },
            };
            const outcome = expectedOutcome(deal);
            expect(stageOutcome(deal)).toBe(outcome);
            const whereLost =
              stage === 'closed_lost' || (!deleted && isLost);
            expect(outcome === 'lost').toBe(whereLost);
          }
        }
      }
    }
    expect(lostOutcomeWhere()).toEqual({
      OR: [
        { stage: 'closed_lost' },
        { pipelineStage: { is: { deletedAt: null, isLost: true } } },
      ],
    });
  });
});
