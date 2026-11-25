/**
 * Percent a terminal stage is allowed to keep.
 *
 * Demo Closed Won is 100 and Closed Lost is 0. The editor used to save a
 * different percent, including 0 on a won stage. An open stage such as
 * S3 Technical Iteration stays editable.
 */
export function lockedStageProbability(stage: { isWon: boolean; isLost: boolean }): 100 | 0 | null {
  if (stage.isWon) return 100;
  if (stage.isLost) return 0;
  return null;
}
