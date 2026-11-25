import { isLegacyOpportunityStage, isPipelineStageIdUuid } from '@/lib/pipeline-stages';
import type { PipelineStage } from '@bidstack/shared';

/**
 * Demo columns are titled Lead, Ongoing, Proposal Sent, Technical Iteration,
 * and Negotiation. A bid can store that title and no stage row. The title is
 * not the legacy label (S2 Sent) and not the enum (s2_sent). Matching it to
 * the one configured column of the same name keeps the bid on that column.
 */
export function normalizeStageTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function inventedStageTitle(stage: PipelineStage): boolean {
  return !isPipelineStageIdUuid(stage.id) && !isLegacyOpportunityStage(stage.id);
}

export function omitInventedDuplicateTitles(
  stages: readonly PipelineStage[],
  configured: readonly PipelineStage[],
): PipelineStage[] {
  const configuredCount = new Map<string, number>();
  for (const stage of configured) {
    const key = normalizeStageTitle(stage.name);
    if (!key) continue;
    configuredCount.set(key, (configuredCount.get(key) ?? 0) + 1);
  }
  return stages.filter((stage) => {
    if (!inventedStageTitle(stage)) return true;
    return configuredCount.get(normalizeStageTitle(stage.name)) !== 1;
  });
}

export function columnIdForStageTitle(
  stageText: string | null | undefined,
  stages: readonly PipelineStage[],
): string | undefined {
  if (!stageText) return undefined;
  const key = normalizeStageTitle(stageText);
  if (!key) return undefined;
  const matches = stages.filter((stage) => normalizeStageTitle(stage.name) === key);
  return matches.length === 1 ? matches[0]!.id : undefined;
}
