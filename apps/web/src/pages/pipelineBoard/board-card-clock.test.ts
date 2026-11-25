import { describe, expect, it } from 'vitest';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { boardCardClockStopped } from './board-card-clock';

function opp(patch: Partial<Opportunity>): Opportunity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'OP-0005',
    customer: 'Stellantis',
    name: 'EV Fleet Telematics',
    stage: 'closed_won',
    pipelineStageId: null,
    pipelineStage: null,
    value: 620_000,
    probability: 100,
    dueDate: '2099-12-31',
    owner: null,
    industry: 'Automotive',
    logo: null,
    country: 'IT',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...patch,
  };
}

const WON: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Won',
  probability: 100,
  color: '#22c55e',
  isWon: true,
  isLost: false,
};

describe('boardCardClockStopped', () => {
  it('stops the clock on the demo won and lost bids', () => {
    // WHY: seed-org-data stores dueDate 45 days out on closed_won Stellantis
    // and closed_lost Spotify. The board was counting those dates down.
    expect(boardCardClockStopped(opp({ stage: 'closed_won' }))).toBe(true);
    expect(boardCardClockStopped(opp({ stage: 'closed_lost', code: 'OP-0006' }))).toBe(true);
  });

  it('keeps the clock on an open demo bid', () => {
    expect(boardCardClockStopped(opp({ stage: 's1_ongoing', code: 'OP-0004' }))).toBe(false);
  });

  it('stops the clock from the stage flag when the name is not Closed Won', () => {
    // WHY: a custom win is named Won. The legacy name check does not see it.
    expect(
      boardCardClockStopped(
        opp({
          stage: 's4_negotiation',
          pipelineStageId: WON.id,
          pipelineStage: WON,
        }),
      ),
    ).toBe(true);
    expect(
      boardCardClockStopped(
        opp({
          stage: 's4_negotiation',
          pipelineStageId: WON.id,
          pipelineStage: { ...WON, name: 'Lost', isWon: false, isLost: true },
        }),
      ),
    ).toBe(true);
  });
});
