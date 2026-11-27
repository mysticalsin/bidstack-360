/** Which empty sentence the deal activity tab should use. */
export type DealTimelineEmptyKind = 'open' | 'won' | 'lost';

/** The fields the activity tab needs from the deal record. */
export interface DealTimelineRecord {
  stage?: string | null;
  pipelineStage?: { isWon?: boolean; isLost?: boolean } | null;
}

/**
 * Empty sentence for the activity tab.
 *
 * A closed won or closed lost record is already decided. An empty activity
 * list on that record is not a bid that has not started. Won is checked
 * first, the same order as the deal page. A missing record stays on the
 * open sentence.
 */
export function dealTimelineEmptyKind(
  deal: DealTimelineRecord | null | undefined,
): DealTimelineEmptyKind {
  if (!deal) return 'open';
  if (deal.pipelineStage?.isWon === true || deal.stage === 'closed_won') return 'won';
  if (deal.pipelineStage?.isLost === true || deal.stage === 'closed_lost') return 'lost';
  return 'open';
}
