export const POSITIONING_DEAL_SAMPLE = 500;

/** Keep the latest page and say when one more row proved the page is not the book. */
export function capDealSample<T>(
  rows: readonly T[],
  limit = POSITIONING_DEAL_SAMPLE,
): {
  rows: T[];
  capped: boolean;
} {
  if (rows.length <= limit) return { rows: [...rows], capped: false };
  return { rows: rows.slice(0, limit), capped: true };
}

/**
 * Reference wins. Lost wins when the enum or a live stage says lost.
 * A soft-deleted stage row does not close the deal. Same shape as the
 * removed `wonOutcomeWhere` helper.
 */
export function referenceWinWhere() {
  return {
    NOT: {
      OR: [{ stage: 'closed_lost' as const }, { pipelineStage: { is: { deletedAt: null, isLost: true } } }],
    },
    OR: [
      { stage: 'closed_won' as const },
      { pipelineStage: { is: { deletedAt: null, isWon: true, isLost: false } } },
    ],
  };
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MILLION = 1_000_000n;

/**
 * Open deals for an aggregate. Lost wins, then a live won stage, same as
 * `recordedOutcome`. A soft-deleted stage row does not close the deal.
 */
export function openDealWhere() {
  return {
    NOT: {
      OR: [
        { stage: 'closed_lost' as const },
        { pipelineStage: { is: { deletedAt: null, isLost: true } } },
        { stage: 'closed_won' as const },
        { pipelineStage: { is: { deletedAt: null, isWon: true } } },
      ],
    },
  };
}

/** Sum integer micros. Null when the total cannot be a JavaScript number without drifting. */
export function sumMicrosAsNumber(values: ReadonlyArray<bigint | null | undefined>): number | null {
  let total = 0n;
  for (const value of values) total += value ?? 0n;
  if (total > SAFE || total < -SAFE) return null;
  return Number(total);
}

/**
 * Currency units for a micros total. Null only when the units themselves
 * do not fit in one JavaScript number. A total past the safe integer in
 * micros, such as EUR 10bn, still fits here.
 */
export function openTotalUnits(micros: bigint): number | null {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MILLION;
  if (whole > SAFE) return null;
  const units = Number(whole) + Number(abs % MILLION) / 1_000_000;
  return negative ? -units : units;
}
