import { describe, expect, it } from 'vitest';

import { annotatePulseRead, capMomentumDeals, closedAtOf, openBookMicros, pageIsCapped, recordedOutcome, toMomentumOpp, type OppRow } from './load';

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

  it('calls a full page a sample only when another row exists', () => {
    // WHY: take 1001 is rejected by the query guard, so the extra row is a count.
    expect(pageIsCapped(1000, 1001)).toBe(true);
    expect(pageIsCapped(1000, 1000)).toBe(false);
    expect(pageIsCapped(4, 4)).toBe(false);
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

describe('annotatePulseRead', () => {
  it('names the page on the lines that used it', () => {
    // WHY: the account pulse printed 7.86M as the open book when only the latest 1,000 deals were loaded.
    const drivers = annotatePulseRead(
      [
        { key: 'pipeline', detail: '7.86M open pipeline, all opened in the last 90 days' },
        { key: 'winloss', detail: '2 won, 1 lost in the last 6 months' },
        { key: 'meetings', detail: '3 meetings in 60 days (1 before), last today' },
        { key: 'news', detail: 'News mixed: 1 positive, 0 negative in 90 days' },
        { key: 'hiring', detail: 'Headcount +8% in 12 months' },
      ],
      { dealsCapped: true, newsCapped: true },
    );
    expect(drivers.find((driver) => driver.key === 'pipeline')?.detail).toContain('Latest 1,000 deals.');
    expect(drivers.find((driver) => driver.key === 'winloss')?.detail).toContain('Latest 1,000 deals.');
    expect(drivers.find((driver) => driver.key === 'news')?.detail).toContain('Latest 1,000 news items.');
    expect(drivers.find((driver) => driver.key === 'meetings')?.detail).toBe('3 meetings in 60 days (1 before), last today');
    expect(drivers.find((driver) => driver.key === 'hiring')?.detail).toBe('Headcount +8% in 12 months');
    const posts = annotatePulseRead(
      [{ key: 'hiring', detail: '4 roles posted in 30 days (1 before), headcount +8% in 12 months' }],
      { postingsCapped: true },
    );
    // WHY: the page limit was stuck on the end, so headcount looked like it came from those posts.
    expect(posts[0]?.detail).toBe(
      '4 roles posted in 30 days (1 before), from the latest 1,000 job posts. Headcount +8% in 12 months',
    );
    const headcountOnly = annotatePulseRead(
      [{ key: 'hiring', detail: 'Headcount +8% in 12 months' }],
      { postingsCapped: true },
    );
    expect(headcountOnly[0]?.detail).toBe('Headcount +8% in 12 months');
    const open = annotatePulseRead(
      [{ key: 'pipeline', detail: '2M open pipeline, flat over 90 days' }],
      {},
    );
    expect(open[0]?.detail).toBe('2M open pipeline, flat over 90 days');
  });
});
