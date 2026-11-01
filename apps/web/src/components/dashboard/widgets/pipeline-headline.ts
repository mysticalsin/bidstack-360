const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

/** Closed won and lost are outcomes. The pipeline chart is the open book. */
export function openPipelineStages<T extends { stage: string }>(stages: readonly T[]): T[] {
  return stages.filter((stage) => !CLOSED_STAGES.has(stage.stage));
}

export interface PipelineStagePoint {
  stage: string;
  count: number;
  valueSum: number;
}

/**
 * Headline numbers for the whole recorded book.
 * Open value excludes closed won and lost. Win rate is a count ratio.
 */
export function pipelineHeadline(byStage: readonly PipelineStagePoint[]): {
  openValue: number;
  openCount: number;
  wonValue: number;
  lostValue: number;
  winRate: number | null;
} {
  const open = openPipelineStages(byStage);
  const won = byStage.find((stage) => stage.stage === 'closed_won');
  const lost = byStage.find((stage) => stage.stage === 'closed_lost');
  const closed = (won?.count ?? 0) + (lost?.count ?? 0);
  return {
    openValue: open.reduce((sum, stage) => sum + stage.valueSum, 0),
    openCount: open.reduce((sum, stage) => sum + stage.count, 0),
    wonValue: won?.valueSum ?? 0,
    lostValue: lost?.valueSum ?? 0,
    winRate: closed > 0 ? (won?.count ?? 0) / closed : null,
  };
}
