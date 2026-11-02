/**
 * Money utilities for the repo-wide micros convention: amounts are stored as
 * integer micros (unit × 1e6) in Prisma `BigInt` columns (see CLAUDE.md
 * "Money"). Both API and web must agree on how a micros `BigInt` becomes a
 * display/wire `number` — this module is the single place that decides.
 *
 * WHY a dedicated module: the pattern scattered across routes/services,
 * `Number(bigint) / 1_000_000`, silently loses precision once the bigint
 * exceeds `Number.MAX_SAFE_INTEGER` (2^53 - 1 micros, ≈ $9.007B) — the
 * BigInt→Number conversion rounds *before* the division ever runs, so the
 * division "corrects" a value that is already wrong. Accumulating several
 * rows into a JS `number` (`reduce`/`+=`) compounds the same rounding error
 * on every addition. These helpers keep BigInt arithmetic all the way
 * through and convert to `Number` only once, at the boundary — matching the
 * whole/remainder split already used by `apps/web/src/lib/format.ts`
 * (`formatMoneyMicros`) so API responses and the UI never disagree.
 */

const MICROS_PER_UNIT = 1_000_000n;

function toBigIntMicros(micros: bigint | number): bigint {
  return typeof micros === 'bigint' ? micros : BigInt(Math.trunc(micros));
}

/**
 * Converts integer micros to a floating-point unit amount (e.g. dollars).
 *
 * Safe range: exact for any realistic financial amount. The value is split
 * into a whole-unit part and a sub-unit remainder *before* either half is
 * converted to `Number`, so precision only degrades once the whole-unit part
 * itself exceeds `Number.MAX_SAFE_INTEGER` units (~9e15 units / ~9e21
 * micros) — nine orders of magnitude beyond where the naive
 * `Number(micros) / 1_000_000` starts corrupting values (~$9.007B).
 */
export function microsToUnits(micros: bigint | number): number {
  const value = toBigIntMicros(micros);
  const whole = value / MICROS_PER_UNIT;
  const remainder = value % MICROS_PER_UNIT;
  return Number(whole) + Number(remainder) / 1_000_000;
}

/**
 * Sums micros values using BigInt accumulation throughout — the running
 * total never passes through `Number`, so no amount of rows or magnitude of
 * individual values can compound float error into the total. `null`/
 * `undefined` entries (e.g. an unset Prisma `_sum`) count as zero.
 */
export function sumMicros(values: ReadonlyArray<bigint | number | null | undefined>): bigint {
  let total = 0n;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total += toBigIntMicros(value);
  }
  return total;
}
