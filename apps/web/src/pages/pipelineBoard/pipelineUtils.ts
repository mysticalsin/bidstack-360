// WHY separate: getStageId is used by the page orchestrator (byStage grouping,
// handleKey, handleDrop). The card resolves the stage itself so it can read
// isWon/isLost, not only the display name.
import { resolvePipelineStage } from '@/lib/pipeline-stages';
import type { Opportunity } from '@bidstack/shared';

export function getStageId(opp: Opportunity): string {
  return resolvePipelineStage(opp).id;
}
