import { describe, it, expect } from 'vitest';

import {
  isLegalStageTransition,
  isForwardMove,
  resolveStandingDecision,
  type StageNode,
} from './index.js';

const S = (id: string, orderIndex: number, extra: Partial<StageNode> = {}): StageNode => ({
  id,
  orderIndex,
  isWon: false,
  isLost: false,
  ...extra,
});

// A representative pipeline: lead → sent → negotiation → (won | lost)
const lead = S('lead', 0);
const sent = S('sent', 1);
const nego = S('nego', 2);
const won = S('won', 3, { isWon: true });
const lost = S('lost', 4, { isLost: true });
const ALL = [lead, sent, nego, won, lost];

describe('isLegalStageTransition', () => {
  it('allows a one-step forward or back move', () => {
    expect(isLegalStageTransition(lead, sent, ALL)).toBe(true);
    expect(isLegalStageTransition(nego, sent, ALL)).toBe(true);
  });

  it('blocks skipping an active stage', () => {
    expect(isLegalStageTransition(lead, nego, ALL)).toBe(false); // lead → nego skips sent
  });

  it('always allows closing to a terminal, and reopening from one', () => {
    expect(isLegalStageTransition(lead, won, ALL)).toBe(true);
    expect(isLegalStageTransition(lead, lost, ALL)).toBe(true);
    expect(isLegalStageTransition(won, lead, ALL)).toBe(true);
  });

  it('is a no-op for same stage and fail-open with no current stage', () => {
    expect(isLegalStageTransition(sent, sent, ALL)).toBe(true);
    expect(isLegalStageTransition(null, nego, ALL)).toBe(true);
  });
});

describe('isForwardMove', () => {
  it('detects forward advancement and won, but not lost or backward', () => {
    expect(isForwardMove(lead, sent, ALL)).toBe(true);
    expect(isForwardMove(sent, won, ALL)).toBe(true);
    expect(isForwardMove(nego, sent, ALL)).toBe(false); // backward
    expect(isForwardMove(sent, lost, ALL)).toBe(false); // abandoning is not forward
  });
});

describe('resolveStandingDecision', () => {
  const t = (s: string) => new Date(s);

  it('is none with no signals', () => {
    expect(resolveStandingDecision({})).toBe('none');
  });

  it('reads a Bid/No-Bid gate decision', () => {
    expect(
      resolveStandingDecision({ latestGate: { gate: 'bid_no_bid', outcome: 'no_bid', decidedAt: t('2026-01-01') } }),
    ).toBe('negative');
    expect(
      resolveStandingDecision({ latestGate: { gate: 'go_no_go', outcome: 'go', decidedAt: t('2026-01-01') } }),
    ).toBe('positive');
  });

  it('treats a no_bid BidScore as negative unless overridden', () => {
    expect(
      resolveStandingDecision({
        latestBidScore: { recommendation: 'no_bid', overrideJustification: null, createdAt: t('2026-01-01') },
      }),
    ).toBe('negative');
    expect(
      resolveStandingDecision({
        latestBidScore: { recommendation: 'no_bid', overrideJustification: 'strategic logo', createdAt: t('2026-01-01') },
      }),
    ).toBe('positive');
  });

  it('lets the most recent signal win when a gate and a score disagree', () => {
    // score says no_bid (Jan), a later gate says go (Feb) → positive
    expect(
      resolveStandingDecision({
        latestGate: { gate: 'go_no_go', outcome: 'go', decidedAt: t('2026-02-01') },
        latestBidScore: { recommendation: 'no_bid', overrideJustification: null, createdAt: t('2026-01-01') },
      }),
    ).toBe('positive');
    // gate says no_go (Jan), a later score says bid (Feb) → positive
    expect(
      resolveStandingDecision({
        latestGate: { gate: 'go_no_go', outcome: 'no_go', decidedAt: t('2026-01-01') },
        latestBidScore: { recommendation: 'bid', overrideJustification: null, createdAt: t('2026-02-01') },
      }),
    ).toBe('positive');
  });
});
