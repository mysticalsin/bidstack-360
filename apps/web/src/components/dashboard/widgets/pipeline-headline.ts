import { microsToUnits } from '@bidstack/shared';

import { microsSharePercent, recordedMicros } from '@/components/dashboard/unspecified-currency';

const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

/** Closed won and lost are outcomes. The pipeline chart is the open book. */
export function openPipelineStages<T extends { stage: string }>(stages: readonly T[]): T[] {
  return stages.filter((stage) => !CLOSED_STAGES.has(stage.stage));
}

export interface PipelineStagePoint {
  stage: string;
  count: number;
  valueSum: number;
  /** Integer micros. Bar length uses this when the unit number has collapsed. */
  valueSumMicros?: string;
}

/** Bar length as a share of the largest stage. Micros win over the unit number. */
export function stageBarShares(stages: readonly PipelineStagePoint[]): number[] {
  const amounts = stages.map((stage) => recordedMicros(stage.valueSum, stage.valueSumMicros));
  const max = amounts.reduce((best, amount) => (amount > best ? amount : best), 0n);
  if (max <= 0n) return amounts.map(() => 0);
  return amounts.map((amount) => microsSharePercent(amount, max));
}

/**
 * Headline numbers for the whole recorded book.
 * Open value excludes closed won and lost. Win rate is a count ratio.
 */
function stageMicros(stage: PipelineStagePoint | undefined): bigint {
  if (!stage) return 0n;
  return recordedMicros(stage.valueSum, stage.valueSumMicros);
}

export function pipelineHeadline(byStage: readonly PipelineStagePoint[]): {
  openValue: number;
  openMicros: bigint;
  openCount: number;
  wonValue: number;
  wonMicros: bigint;
  lostValue: number;
  lostMicros: bigint;
  winRate: number | null;
} {
  const open = openPipelineStages(byStage);
  const won = byStage.find((stage) => stage.stage === 'closed_won');
  const lost = byStage.find((stage) => stage.stage === 'closed_lost');
  const closed = (won?.count ?? 0) + (lost?.count ?? 0);
  const openMicros = open.reduce((sum, stage) => sum + stageMicros(stage), 0n);
  const wonMicros = stageMicros(won);
  const lostMicros = stageMicros(lost);
  return {
    openMicros,
    openValue: microsToUnits(openMicros),
    openCount: open.reduce((sum, stage) => sum + stage.count, 0),
    wonMicros,
    wonValue: microsToUnits(wonMicros),
    lostMicros,
    lostValue: microsToUnits(lostMicros),
    winRate: closed > 0 ? (won?.count ?? 0) / closed : null,
  };
}
