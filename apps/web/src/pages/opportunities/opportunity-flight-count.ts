import type { Opportunity } from '@bidstack/shared';

import { resolvePipelineStage } from '@/lib/pipeline-stages';

export interface FlightCounts {
  inFlight: number;
  closed: number;
}

/**
 * Open rows versus won or lost rows on this page.
 *
 * The opportunities subtitle says "bids in flight". Demo seed-org-data keeps
 * Stellantis (closed_won) and Spotify (closed_lost) on that page with the open
 * book, and those rows leave pipelineStage null. resolvePipelineStage is the
 * same read the row uses, so an attached won/lost flag still beats a stale
 * stage string.
 */
export function countBidsInFlight(rows: readonly Opportunity[]): FlightCounts {
  let inFlight = 0;
  let closed = 0;
  for (const row of rows) {
    const stage = resolvePipelineStage(row);
    if (stage.isWon || stage.isLost) closed += 1;
    else inFlight += 1;
  }
  return { inFlight, closed };
}
