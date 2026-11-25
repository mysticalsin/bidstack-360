export interface BoardOutcomeStage {
  id: string;
  isWon: boolean;
  isLost: boolean;
}

export type BoardArrowStep = { kind: 'move'; id: string } | { kind: 'stay' } | { kind: 'blocked' };

function isClosedOutcome(stage: BoardOutcomeStage): boolean {
  return stage.isWon || stage.isLost;
}

/**
 * Won and lost are both closed, and they are not the same outcome.
 * A step from one to the other files the bid under the other result.
 */
export function isOppositeClosedOutcome(from: BoardOutcomeStage, to: BoardOutcomeStage): boolean {
  if (!isClosedOutcome(from) || !isClosedOutcome(to)) return false;
  return from.isWon !== to.isWon || from.isLost !== to.isLost;
}

/**
 * Next column for the left/right arrow on a deal-board card.
 *
 * Adjacent open columns still move. Closing into the next outcome column
 * still moves. The other outcome column is not that step: Closed Won sits
 * beside Closed Lost on the demo board, and the arrow would swap them.
 * The end of the board stays put, with no error.
 */
export function boardArrowStep(
  stages: readonly BoardOutcomeStage[],
  fromId: string,
  direction: 'left' | 'right',
): BoardArrowStep {
  const index = stages.findIndex((stage) => stage.id === fromId);
  if (index < 0) return { kind: 'stay' };
  const nextIndex = direction === 'right' ? index + 1 : index - 1;
  if (nextIndex < 0 || nextIndex >= stages.length) return { kind: 'stay' };
  const from = stages[index];
  const to = stages[nextIndex];
  if (!from || !to) return { kind: 'stay' };
  if (isOppositeClosedOutcome(from, to)) return { kind: 'blocked' };
  return { kind: 'move', id: to.id };
}
