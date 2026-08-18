import { describe, it, expect } from 'vitest';

import {
  canonicalStageNodes,
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

  // REGRESSION — the close-then-reopen laundering bypass. Reopening used to
  // return false here, so the two-move sequence "close to lost, reopen at the
  // last stage" cleared the standing-decision gate entirely: move 1 is legal
  // and not forward (closing lost), move 2 is legal (from is terminal) and used
  // to be not-forward (from is terminal). A killed bid could reach negotiation
  // in two allowed requests while a no-go was on record.
  it('treats reopening a closed bid as forward advancement', () => {
    expect(isForwardMove(lost, lead, ALL)).toBe(true);
    expect(isForwardMove(lost, nego, ALL)).toBe(true);
    expect(isForwardMove(won, nego, ALL)).toBe(true);
  });
});

describe('canonicalStageNodes', () => {
  // REGRESSION — the "no PipelineStage row" bypass. When an org had no default
  // pipeline (or no row for the requested key) the route resolved zero nodes
  // and skipped every gate, so a bare `{ stage: 's4_negotiation' }` body walked
  // straight past both rules. The canonical enum graph is the fallback.
  it('exposes the product stage enum in funnel order with terminals flagged', () => {
    const nodes = canonicalStageNodes();
    expect(nodes.map((n) => n.id)).toEqual([
      's1_lead',
      's1_ongoing',
      's2_sent',
      's3_technical_iteration',
      's4_negotiation',
      'closed_won',
      'closed_lost',
    ]);
    expect(nodes.find((n) => n.id === 'closed_won')?.isWon).toBe(true);
    expect(nodes.find((n) => n.id === 'closed_lost')?.isLost).toBe(true);
  });

  it('still blocks a multi-stage jump when used as the graph', () => {
    const nodes = canonicalStageNodes();
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    expect(isLegalStageTransition(at('s1_lead'), at('s4_negotiation'), nodes)).toBe(false);
    expect(isLegalStageTransition(at('s1_lead'), at('s1_ongoing'), nodes)).toBe(true);
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
