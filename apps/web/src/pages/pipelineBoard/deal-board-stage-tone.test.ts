import { describe, expect, it } from 'vitest';

import { dealBoardStageTone } from './deal-board-stage-tone';

describe('dealBoardStageTone', () => {
  it('maps the demo backfill column names off gray, except Lead', () => {
    // WHY: the board was calling stageTone with these names. That map only
    // has s1_lead … closed_lost, so Ongoing through Closed Lost rendered as
    // the same gray pill as an empty Lead column.
    expect(dealBoardStageTone({ name: 'Lead' })).toBe('gray');
    expect(dealBoardStageTone({ name: 'Ongoing' })).toBe('purple');
    expect(dealBoardStageTone({ name: 'Proposal Sent' })).toBe('blue');
    expect(dealBoardStageTone({ name: 'Technical Iteration' })).toBe('teal');
    expect(dealBoardStageTone({ name: 'Negotiation' })).toBe('amber');
    expect(dealBoardStageTone({ name: 'Closed Won' })).toBe('jade');
    expect(dealBoardStageTone({ name: 'Closed Lost' })).toBe('tomato');
  });

  it('keeps the legacy labels on the same tones', () => {
    expect(dealBoardStageTone({ name: 'S1 Lead' })).toBe('gray');
    expect(dealBoardStageTone({ name: 's1_ongoing' })).toBe('purple');
    expect(dealBoardStageTone({ name: 'S2 Sent' })).toBe('blue');
    expect(dealBoardStageTone({ name: 'S3 Technical Iteration' })).toBe('teal');
    expect(dealBoardStageTone({ name: 'S4 Negotiation' })).toBe('amber');
    expect(dealBoardStageTone({ name: 'closed_won' })).toBe('jade');
    expect(dealBoardStageTone({ name: 'closed_lost' })).toBe('tomato');
  });

  it('lets a won or lost flag override a name the map does not know', () => {
    // WHY: a custom stage is not named Closed Won. The flag is what the
    // column actually is. Without it, "Won" stays gray.
    expect(dealBoardStageTone({ name: 'Won', isWon: true })).toBe('jade');
    expect(dealBoardStageTone({ name: 'Lost', isLost: true })).toBe('tomato');
    expect(dealBoardStageTone({ name: 'Negotiation', isLost: true })).toBe('tomato');
  });

  it('does not invent a tone for an unknown open stage', () => {
    expect(dealBoardStageTone({ name: 'Custom Review' })).toBe('gray');
    expect(dealBoardStageTone({ name: 'Negotiation Review' })).toBe('gray');
    expect(dealBoardStageTone({ name: '' })).toBe('gray');
  });
});
