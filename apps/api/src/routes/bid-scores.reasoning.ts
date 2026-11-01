type ScoreStage = {
  isWon: boolean;
  isLost: boolean;
  deletedAt: Date | null;
};

export type ScoreOpportunity = {
  stage: string;
  probability: number;
  valueMicros: bigint | number;
  pipelineStage?: ScoreStage | null;
};

/** Lost wins. A deleted stage does not close the deal. A stored 0 is not a measured chance. */
export function applyOpportunityCalibration(
  criteria: Record<string, number>,
  opp: ScoreOpportunity,
): { criteria: Record<string, number>; line: string } {
  const next = { ...criteria };
  const live = opp.pipelineStage && opp.pipelineStage.deletedAt == null ? opp.pipelineStage : null;
  const lost = opp.stage === 'closed_lost' || live?.isLost === true;
  const won = !lost && (opp.stage === 'closed_won' || live?.isWon === true);
  if (!lost && !won && opp.probability > 70) {
    next.relationship = Math.min(5, (next.relationship ?? 3) + 1);
  }
  // Large stored amount. The deal has no currency, so this is not a euro threshold.
  if (Number(opp.valueMicros) > 10_000_000_000_000) {
    next.deal_size = 5;
  }
  const probability = opp.probability === 0 ? 'not recorded' : `${opp.probability}%`;
  const outcome = lost ? 'lost' : won ? 'won' : 'open';
  return {
    criteria: next,
    line: `Opportunity stage: ${opp.stage}, outcome: ${outcome}, probability: ${probability}.`,
  };
}
