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

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Sum integer micros. Null when the total cannot be a JavaScript number without drifting. */
export function sumMicrosAsNumber(values: ReadonlyArray<bigint | null | undefined>): number | null {
  let total = 0n;
  for (const value of values) total += value ?? 0n;
  if (total > SAFE || total < -SAFE) return null;
  return Number(total);
}
