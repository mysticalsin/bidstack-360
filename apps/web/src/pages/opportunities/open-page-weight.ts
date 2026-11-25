import { resolvePipelineStage } from '@/lib/pipeline-stages';

import type { Opportunity } from '@bidstack/shared';

/**
 * A bid still in play on the loaded opportunities page.
 *
 * Demo and other legacy rows store `closed_won` / `closed_lost` on `stage`
 * and leave `pipelineStage` null. A flag-only check treats that as open, so
 * a won bid at probability 100 is added in full to WR (page). The server
 * summary already drops those stages; this page figure has to agree.
 * When a pipeline stage is attached, its won/lost flags win.
 */
export function isOpenPageBid(opp: Opportunity): boolean {
  const stage = resolvePipelineStage(opp);
  return !stage.isWon && !stage.isLost;
}

/** value × probability / 100 for open bids only. */
export function weightedOpenPageValue(opps: readonly Opportunity[]): number {
  return opps.reduce((sum, opp) => {
    if (!isOpenPageBid(opp)) return sum;
    return sum + opp.value * (opp.probability / 100);
  }, 0);
}

/** Unweighted open value. A decided bid is not open pipeline. */
export function openPagePipelineValue(opps: readonly Opportunity[]): number {
  return opps.reduce((sum, opp) => (isOpenPageBid(opp) ? sum + opp.value : sum), 0);
}
