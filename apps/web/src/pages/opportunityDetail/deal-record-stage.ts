import { formatStage } from '@/lib/format';
import type { PipelineStage } from '@bidstack/shared';

/** A configured pipeline stage, the column the deal board actually groups by. */
export interface DealRecordStage {
  id: string;
  key: string;
  name: string;
  orderIndex: number;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
}

export interface DealRecordStageSource {
  stage: string | null;
  pipelineStageId: string | null;
  pipelineStage: { id: string; name: string; isWon: boolean; isLost: boolean } | null;
}

/**
 * Stages in board order, labeled with the column name.
 * Demo backfill names the column "Technical Iteration", not "S3 Technical Iteration".
 */
export function dealRecordStageChoices(
  stages: DealRecordStage[],
): Array<{ value: string; label: string }> {
  return [...stages]
    .sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name))
    .map((stage) => ({ value: stage.id, label: stage.name }));
}

function toneKey(stage: { key: string; isWon: boolean; isLost: boolean }): string {
  if (stage.isWon) return 'closed_won';
  if (stage.isLost) return 'closed_lost';
  return stage.key;
}

/**
 * What the record shows for the current stage.
 * Once a pipeline stage is linked, the wire `stage` is that column's name.
 * The select value has to be the stage id, or the control opens on the first
 * legacy enum (S1 Lead) for a bid that is not in that column.
 */
export function dealRecordStagePresentation(
  opportunity: DealRecordStageSource,
  stages: DealRecordStage[],
): { value: string; label: string; toneKey: string } {
  const match =
    stages.find((stage) => stage.id === opportunity.pipelineStageId) ??
    stages.find((stage) => stage.key === opportunity.stage) ??
    null;
  if (match) {
    return { value: match.id, label: match.name, toneKey: toneKey(match) };
  }
  if (opportunity.pipelineStage) {
    return {
      value: opportunity.pipelineStageId ?? opportunity.stage ?? '',
      label: opportunity.pipelineStage.name,
      toneKey: opportunity.pipelineStage.isWon
        ? 'closed_won'
        : opportunity.pipelineStage.isLost
          ? 'closed_lost'
          : (opportunity.stage ?? ''),
    };
  }
  const raw = opportunity.stage ?? '';
  return { value: raw, label: raw ? formatStage(raw) : '—', toneKey: raw };
}

/**
 * The move the stage control should post.
 * A configured id goes to POST /stage as pipelineStageId, which is what the
 * board groups on. A value that is not one of those ids stays the legacy enum
 * for an org that has no pipeline stages.
 */
export function dealRecordStageMove(
  stages: DealRecordStage[],
  value: string,
): { pipelineStageId: string; pipelineStage?: PipelineStage } {
  const stage = stages.find((item) => item.id === value);
  if (!stage) return { pipelineStageId: value };
  return {
    pipelineStageId: stage.id,
    pipelineStage: {
      id: stage.id,
      name: stage.name,
      probability: stage.probability,
      color: stage.color,
      isWon: stage.isWon,
      isLost: stage.isLost,
    },
  };
}
