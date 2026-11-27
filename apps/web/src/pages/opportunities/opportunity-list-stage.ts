import type { OpportunityStage } from '@bidstack/shared';

import { isLegacyOpportunityStage, isPipelineStageIdUuid } from '@/lib/pipeline-stages';

export interface OpportunityStageListQuery {
  pipelineStageId?: string;
  stage?: OpportunityStage;
}

/**
 * The list chip stores a pipeline stage id. Demo stages are UUIDs, and the
 * seed writes the stage key (s3_technical_iteration on OP-2041) with a null
 * pipelineStageId. A UUID query matches no seeded bid, so the chip looks
 * selected and the list is empty. When the catalog key is a legacy enum,
 * ask for that key. A custom stage with no enum key still asks for the id.
 */
export function opportunityStageListQuery(
  stageFilter: string | null,
  stageKeyById: ReadonlyMap<string, string>,
): OpportunityStageListQuery {
  if (!stageFilter) return {};
  if (isLegacyOpportunityStage(stageFilter)) return { stage: stageFilter };
  if (!isPipelineStageIdUuid(stageFilter)) return {};
  const key = stageKeyById.get(stageFilter)?.trim();
  if (key && isLegacyOpportunityStage(key)) return { stage: key };
  return { pipelineStageId: stageFilter };
}
