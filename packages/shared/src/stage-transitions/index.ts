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
 *
 * Reopening a CLOSED opportunity counts as forward. It used to return false
 * here, which handed anyone a two-request bypass of the whole gate: close to
 * lost (always legal, never forward), then reopen straight to the last stage
 * (legal because from is terminal, not forward because from is terminal). A
 * killed bid re-entering the pipeline is exactly the move the gate exists for.
 */
export function isForwardMove(
  from: StageNode | null,
  to: StageNode,
  all: readonly StageNode[],
): boolean {
  if (to.isLost) return false;
  if (!from) return true;
  if (to.isWon) return true;
  if (isTerminal(from)) return true; // reopening a closed bid re-enters the funnel

  const active = activeSorted(all);
  const fi = active.findIndex((s) => s.id === from.id);
  const ti = active.findIndex((s) => s.id === to.id);
  if (fi === -1 || ti === -1) return false;
  return ti > fi;
}

/**
 * The product's canonical stage enum, in funnel order. Used as the fallback
 * graph when an org has no PipelineStage rows for the move (no default
 * pipeline, or a stage key with no row): without it the route resolved no
 * nodes and skipped the gate entirely, so a plain `{ stage: 's4_negotiation' }`
 * body walked past every rule. Ordering only — the real pipeline wins whenever
 * its rows resolve.
 */
export const CANONICAL_STAGE_ORDER: readonly string[] = [
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
];

/** StageNodes synthesized from CANONICAL_STAGE_ORDER, keyed by the stage enum. */
export function canonicalStageNodes(): StageNode[] {
  return CANONICAL_STAGE_ORDER.map((key, i) => ({
    id: key,
    orderIndex: i,
    isWon: key === 'closed_won',
    isLost: key === 'closed_lost',
  }));
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

  // Whitelist, not "anything that isn't no_bid". A permissive else-branch meant
  // any BidScore row — including one with an unrecognized recommendation —
  // registered as a positive signal and, being the newest, silently cleared a
  // recorded no-go. Only the three real BidRecommendationValue values speak.
  const scoreSignal: StandingDecision | null = b
    ? b.recommendation === 'no_bid'
      ? b.overrideJustification
        ? 'positive' // a justified override is a deliberate proceed
        : 'negative'
      : b.recommendation === 'bid' || b.recommendation === 'proceed_with_caution'
        ? 'positive'
        : null
    : null;

  // Most recent signal wins when both exist.
  if (gateSignal && scoreSignal) {
    return (g!.decidedAt >= b!.createdAt ? gateSignal : scoreSignal) ?? 'none';
  }
  return gateSignal ?? scoreSignal ?? 'none';
}
