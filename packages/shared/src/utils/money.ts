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
/** en-US amount rounded to the cent in integer micros. No currency symbol. */
export function formatMicrosAmount(micros: bigint | number): string {
  const value = toBigIntMicros(micros);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const cents = (abs + 5_000n) / 10_000n;
  const units = cents / 100n;
  const frac = cents % 100n;
  const body = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = frac === 0n ? body : `${body}.${frac.toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** Unit text with up to 6 decimal places. No rounding. */
export function microsToUnitsText(micros: bigint | number | string): string {
  const value = typeof micros === 'bigint' ? micros : BigInt(micros);
  const whole = value / MICROS_PER_UNIT;
  const frac = value % MICROS_PER_UNIT;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

/** Parse a unit amount into integer micros. Rejects more than 6 decimal places. */
export function unitsTextToMicros(text: string): bigint | null {
  const trimmed = text.trim().replace(/,/g, '').replace(/^\+/, '');
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole = '0', frac = ''] = trimmed.split('.');
  const padded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * MICROS_PER_UNIT + BigInt(padded);
}

/**
 * Units to integer micros. A digit string keeps the remainder. A number is exact
 * when it is a safe integer of units. A fractional number is kept only while the
 * rounded micros still fit in a safe integer.
 */
export function unitsToMicros(value: number | string): bigint | null {
  if (typeof value === 'string') return unitsTextToMicros(value);
  if (!Number.isFinite(value) || value < 0) return null;
  if (Number.isSafeInteger(value)) return BigInt(value) * MICROS_PER_UNIT;
  const rounded = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(rounded) || rounded < 0) return null;
  return BigInt(rounded);
}

/** A JS number only when every digit of the micros integer survives. */
export function microsToSafeNumber(
  micros: bigint | number | string | null | undefined,
): number | null {
  if (micros == null || micros === '') return null;
  let value: bigint;
  try {
    value = typeof micros === 'bigint' ? micros : BigInt(micros);
  } catch {
    return null;
  }
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

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
