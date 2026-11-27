import { resolvePipelineStage } from '@/lib/pipeline-stages';
import type { Opportunity } from '@bidstack/shared';

/**
 * Whether the deal-board due clock has stopped.
 *
 * Demo seed writes a due date 45 days out on every bid, including Stellantis
 * (closed won) and Spotify (closed lost). That date stays on the record. It
 * is not a live deadline once the board stage is won or lost. A stage named
 * Won is still a win when the stage flag says so. An open bid keeps the clock.
 */
export function boardCardClockStopped(opp: Opportunity): boolean {
  const stage = resolvePipelineStage(opp);
  return (
    stage.isWon ||
    stage.isLost ||
    stage.name === 'Closed Won' ||
    stage.name === 'Closed Lost'
  );
}
