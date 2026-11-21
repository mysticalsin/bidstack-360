/**
 * One classification for whether a deal is open, won, or lost.
 *
 * Lost wins when the stored stage or a live stage says lost.
 * A soft-deleted stage row does not close the deal.
 * Won applies only when the deal is not lost.
 *
 * The list sends the stage name ("Closed Lost", "Price lost"). The database
 * stores the enum (`closed_lost`) plus the live flags. Both shapes use this
 * function. `lostOutcomeWhere` is the same rule as a query, for enum rows.
 */

export type StageOutcome = 'won' | 'lost' | 'open';

export interface StageClassification {
  stage?: string | null;
  pipelineStage?: {
    isWon?: boolean;
    isLost?: boolean;
    deletedAt?: string | Date | null;
  } | null;
}

function stageToken(stage: string | null | undefined): string {
  return (stage ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function liveStage(deal: StageClassification) {
  const stage = deal.pipelineStage;
  if (!stage || stage.deletedAt) return null;
  return stage;
}

export function stageOutcome(deal: StageClassification): StageOutcome {
  const live = liveStage(deal);
  const token = stageToken(deal.stage);
  if (token === 'closed lost' || live?.isLost === true) return 'lost';
  if (token === 'closed won' || live?.isWon === true) return 'won';
  return 'open';
}

/** A stored row matches this iff `stageOutcome` is `lost`. */
export function lostOutcomeWhere() {
  return {
    OR: [
      { stage: 'closed_lost' as const },
      { pipelineStage: { is: { deletedAt: null, isLost: true } } },
    ],
  };
}

/** Still in play or already won. A live lost stage is not current activity. */
export function excludeLostOutcomeWhere() {
  return { NOT: lostOutcomeWhere() };
}
