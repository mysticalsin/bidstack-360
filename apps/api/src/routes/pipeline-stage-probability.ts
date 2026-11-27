export type ProtectedStageProbabilityDecision =
  | { ok: true }
  | { ok: false; statusCode: 400; message: string };

/**
 * A won stage stays at 100. A lost stage stays at 0.
 * Demo Closed Won is 100 and Closed Lost is 0. An open stage is unchanged.
 * Won wins when a row is marked both, so a corrupt flag cannot store 0 on a win.
 */
export function protectedStageProbabilityDecision(
  stage: { isWon: boolean; isLost: boolean },
  nextProbability: number,
): ProtectedStageProbabilityDecision {
  if (stage.isWon) {
    if (nextProbability !== 100) {
      return { ok: false, statusCode: 400, message: 'A won stage stays at 100.' };
    }
    return { ok: true };
  }
  if (stage.isLost) {
    if (nextProbability !== 0) {
      return { ok: false, statusCode: 400, message: 'A lost stage stays at 0.' };
    }
    return { ok: true };
  }
  return { ok: true };
}
