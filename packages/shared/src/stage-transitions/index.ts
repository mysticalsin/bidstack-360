// Opportunity stage-transition graph — the "hard state machine" the Amaris
// playbook requires (Bid Office is activated by a stage change, and a bid can't
// jump the pipeline or advance past a negative decision). Pure logic; the API
// route supplies the stage nodes + standing decision and enforces the result
// under a staged mode flag (off | warn | enforce).

export interface StageNode {
  id: string;
  orderIndex: number;
  isWon: boolean;
  isLost: boolean;
}

/** A stage is terminal when it is a won or lost outcome. */
export function isTerminal(s: StageNode): boolean {
  return s.isWon || s.isLost;
}

function activeSorted(all: readonly StageNode[]): StageNode[] {
  return all.filter((s) => !isTerminal(s)).sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Legal moves: stay put, step exactly one stage forward or back among the active
 * (non-terminal) stages, close to any terminal, or reopen from a terminal back
 * to an active stage. Anything else (skipping stages) is illegal. Fail-OPEN when
 * a node can't be located in the pipeline (unknown stage → don't block).
 */
export function isLegalStageTransition(
  from: StageNode | null,
  to: StageNode,
  all: readonly StageNode[],
): boolean {
  if (!from) return true;
  if (from.id === to.id) return true;
  if (isTerminal(to)) return true; // can always close (won/lost)
  if (isTerminal(from)) return true; // reopening a closed deal to active is allowed

  const active = activeSorted(all);
  const fi = active.findIndex((s) => s.id === from.id);
  const ti = active.findIndex((s) => s.id === to.id);
  if (fi === -1 || ti === -1) return true; // unknown stage → fail-open
  return Math.abs(ti - fi) === 1;
}

/**
 * Whether a move advances the pursuit forward (deeper into the funnel or won).
 * Closing lost is NOT forward. Used to decide whether the bid-decision gate
 * applies (you can always retreat or abandon a no-bid; you can't push it on).
 */
export function isForwardMove(
  from: StageNode | null,
  to: StageNode,
  all: readonly StageNode[],
): boolean {
  if (to.isLost) return false;
  if (!from) return true;
  if (to.isWon) return true;
  if (isTerminal(from)) return false; // reopening isn't "forward advancement"

  const active = activeSorted(all);
  const fi = active.findIndex((s) => s.id === from.id);
  const ti = active.findIndex((s) => s.id === to.id);
  if (fi === -1 || ti === -1) return false;
  return ti > fi;
}

export type StandingDecision = 'positive' | 'negative' | 'none';

/**
 * Resolve the standing bid decision from the most recent governance signal.
 * A recorded Go/No-Go or Bid/No-Bid GateDecision wins (most recent); otherwise
 * the latest BidScore recommendation, where an overridden no_bid counts as a
 * deliberate proceed (positive). Everything else is 'none'.
 */
export function resolveStandingDecision(input: {
  latestGate?: { gate: string; outcome: string; decidedAt: Date } | null;
  latestBidScore?: {
    recommendation: string;
    overrideJustification: string | null;
    createdAt: Date;
  } | null;
}): StandingDecision {
  const g = input.latestGate;
  const b = input.latestBidScore;

  const gateSignal: StandingDecision | null =
    g && (g.gate === 'go_no_go' || g.gate === 'bid_no_bid')
      ? g.outcome === 'no_go' || g.outcome === 'no_bid'
        ? 'negative'
        : g.outcome === 'go' || g.outcome === 'bid'
          ? 'positive'
          : null
      : null;

  const scoreSignal: StandingDecision | null = b
    ? b.recommendation === 'no_bid' && !b.overrideJustification
      ? 'negative'
      : 'positive'
    : null;

  // Most recent signal wins when both exist.
  if (gateSignal && scoreSignal) {
    return (g!.decidedAt >= b!.createdAt ? gateSignal : scoreSignal) ?? 'none';
  }
  return gateSignal ?? scoreSignal ?? 'none';
}
