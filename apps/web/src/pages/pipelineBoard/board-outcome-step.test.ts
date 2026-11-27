import { describe, expect, it } from 'vitest';

import { boardArrowStep, isOppositeClosedOutcome } from './board-outcome-step';

const LEAD = { id: 'lead', isWon: false, isLost: false };
const NEGOTIATION = { id: 'negotiation', isWon: false, isLost: false };
const WON = { id: 'won', isWon: true, isLost: false };
const LOST = { id: 'lost', isWon: false, isLost: true };

const DEMO = [LEAD, NEGOTIATION, WON, LOST];

describe('deal board outcome arrow', () => {
  it('keeps a won bid out of the lost column on the right arrow', () => {
    // WHY: demo Closed Won is the column immediately left of Closed Lost.
    // Stellantis is the win. The right arrow is the next stage, and the next
    // column is the loss. That files the win as lost.
    expect(boardArrowStep(DEMO, WON.id, 'right')).toEqual({ kind: 'blocked' });
    expect(isOppositeClosedOutcome(WON, LOST)).toBe(true);
  });

  it('keeps a lost bid out of the won column on the left arrow', () => {
    // WHY: Spotify is the loss. The left arrow is the previous column, which
    // is Closed Won. That files the loss as a win.
    expect(boardArrowStep(DEMO, LOST.id, 'left')).toEqual({ kind: 'blocked' });
    expect(isOppositeClosedOutcome(LOST, WON)).toBe(true);
  });

  it('still closes the last open stage into Closed Won', () => {
    // WHY: Negotiation's next column is the win. That arrow is a close, and
    // IKEA is allowed to move there. Blocking every enter into a closed
    // column would trap the open book.
    expect(boardArrowStep(DEMO, NEGOTIATION.id, 'right')).toEqual({
      kind: 'move',
      id: WON.id,
    });
  });

  it('still reopens a win onto the open stage on its left', () => {
    // WHY: the column left of Closed Won is Negotiation, an open stage.
    // Leaving the win for that stage reopens the bid. It does not relabel it lost.
    expect(boardArrowStep(DEMO, WON.id, 'left')).toEqual({
      kind: 'move',
      id: NEGOTIATION.id,
    });
  });

  it('stays put at the ends of the board', () => {
    expect(boardArrowStep(DEMO, LEAD.id, 'left')).toEqual({ kind: 'stay' });
    expect(boardArrowStep(DEMO, LOST.id, 'right')).toEqual({ kind: 'stay' });
    expect(boardArrowStep(DEMO, 'missing', 'right')).toEqual({ kind: 'stay' });
  });
});
