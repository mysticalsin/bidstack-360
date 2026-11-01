const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Sum integer micros. Null when the total cannot be a JavaScript number without drifting. */
export function sumMicrosAsNumber(values: ReadonlyArray<bigint | null | undefined>): number | null {
  let total = 0n;
  for (const value of values) total += value ?? 0n;
  if (total > SAFE || total < -SAFE) return null;
  return Number(total);
}
