// WHY separate: getStageId/getStageName are used in both the page orchestrator
// (byStage grouping, handleKey, handleDrop toasts) and inside PipelineCard
// (aria-label, isStalled logic). Centralising avoids duplication.
import { resolvePipelineStage } from '@/lib/pipeline-stages';
import type { Opportunity } from '@bidstack/shared';

export function getStageId(opp: Opportunity): string {
  return resolvePipelineStage(opp).id;
}

export function getStageName(opp: Opportunity): string {
  return resolvePipelineStage(opp).name;
}
