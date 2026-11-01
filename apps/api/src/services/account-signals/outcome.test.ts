import { describe, expect, it } from 'vitest';

import { capMomentumDeals, closedAtOf, openBookMicros, recordedOutcome, toMomentumOpp, type OppRow } from './load';

const row = (over: Partial<OppRow>): OppRow => ({
  id: 'o1',
  companyId: 'c1',
  name: 'Bid',
  stage: 's3_technical_iteration',
  valueMicros: 1_000_000n,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  closedAt: null,
  ...over,
});

describe('recordedOutcome', () => {
  it('counts a live lost stage as lost even when the enum still looks open', () => {
    // WHY: momentum and the account timeline only read closed_lost, so a
    // custom lost stage stayed in the open book and never appeared as a loss.
    const deal = row({
      pipelineStage: { isWon: false, isLost: true, deletedAt: null },
    });
    expect(recordedOutcome(deal)).toBe('lost');
    expect(closedAtOf(deal)?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(toMomentumOpp(deal).outcome).toBe('lost');
  });

  it('lets lost win when a live stage is marked both won and lost', () => {
    const deal = row({
      stage: 'closed_won',
      pipelineStage: { isWon: true, isLost: true, deletedAt: null },
    });
    expect(recordedOutcome(deal)).toBe('lost');
  });

  it('does not close a deal whose stage row was deleted', () => {
    const deal = row({
      pipelineStage: { isWon: false, isLost: true, deletedAt: new Date('2026-02-01T00:00:00.000Z') },
    });
    expect(recordedOutcome(deal)).toBe('open');
    expect(closedAtOf(deal)).toBeNull();
  });

  it('still closes the enum lost and won stages', () => {
    expect(recordedOutcome(row({ stage: 'closed_lost' }))).toBe('lost');
    expect(recordedOutcome(row({ stage: 'closed_won' }))).toBe('won');
  });

  it('stops the momentum page at 1000 when one more deal exists', () => {
    // WHY: one query of 1000 deals across several accounts was shown as each account's book.
    const rows = Array.from({ length: 1001 }, (_, index) => index);
    const capped = capMomentumDeals(rows);
    expect(capped.capped).toBe(true);
    expect(capped.rows).toHaveLength(1000);
    expect(capMomentumDeals(rows.slice(0, 1000)).capped).toBe(false);
  });

  it('leaves a live lost stage out of the open pipeline total', () => {
    // WHY: the portfolio tile added every deal whose enum was not closed_*.
    const lost = row({
      valueMicros: 2_000_000_000_000n,
      pipelineStage: { isWon: false, isLost: true, deletedAt: null },
    });
    const open = row({ stage: 's2_sent', valueMicros: 1_000_000_000_000n });
    const won = row({ stage: 'closed_won', valueMicros: 500n });
    expect(openBookMicros(lost) + openBookMicros(open) + openBookMicros(won)).toBe(1_000_000_000_000n);
  });
});
