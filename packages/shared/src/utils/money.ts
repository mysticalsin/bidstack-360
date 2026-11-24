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

const UNITS_RE = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

/**
 * Converts a unit amount (dollars, euros, …) to integer micros.
 *
 * WHY a string parse: `BigInt(Math.round(units * 1_000_000))` multiplies in
 * IEEE-754 first. Past ~$9.007B the product is not a safe integer, so the
 * stored micros are already wrong. `toFixed(6)` (number input) or a decimal
 * string (exact input) is split into whole + fraction, then combined with
 * BigInt — the same whole/remainder split as `microsToUnits`, inverted.
 */
export function unitsToMicros(units: string | number): bigint {
  const raw = typeof units === 'number' ? unitsToFixedMicrosString(units) : units.trim();
  if (!UNITS_RE.test(raw)) {
    throw new Error('Invalid money units');
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const dot = unsigned.indexOf('.');
  const wholePart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracPart = dot === -1 ? '' : unsigned.slice(dot + 1);
  const micros = BigInt(wholePart) * MICROS_PER_UNIT + BigInt(fracPart.padEnd(6, '0'));
  return negative ? -micros : micros;
}

const IMPORT_BLANK = /^(?:n\/?a|tbd|—|-)$/i;
const IMPORT_CODE = /^(?:EUR|USD|GBP|CHF|JPY|CAD)\s*/i;

/**
 * CSV money cell → integer micros.
 *
 * Accepts the shapes a spreadsheet actually writes: `1,200,000.50`,
 * `1.234,56`, `1,50`, `€2 500`, `(1,234.50)`, and a leading `'` that an
 * export added so Excel would not treat the cell as a formula. Returns null
 * for a blank or a non-number so the caller can skip the field instead of
 * storing zero. The split into whole and fraction is BigInt, same as
 * `unitsToMicros`, because `Number(text) * 1e6` is already wrong at a
 * trillion and a cent.
 */
export function parseImportMoney(raw: string): bigint | null {
  let s = raw.trim().replace(/^\uFEFF/, '');
  if (s.startsWith("'") && /^'[=+\-@\t\r(]/.test(s)) s = s.slice(1).trim();
  if (!s || IMPORT_BLANK.test(s) || !/\d/.test(s)) return null;
  s = s.replace(IMPORT_CODE, '').replace(/[€$£¥₹]/g, '').replace(/[\s\u00A0\u202F]/g, '');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const canonical = canonicalMoneyDecimal(s);
  if (!canonical) return null;
  try {
    return unitsToMicros(negative ? `-${canonical}` : canonical);
  } catch {
    return null;
  }
}

function canonicalMoneyDecimal(s: string): string | null {
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let whole: string;
  let frac: string;
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      whole = s.slice(0, lastComma).replaceAll('.', '');
      frac = s.slice(lastComma + 1);
    } else {
      whole = s.slice(0, lastDot).replaceAll(',', '');
      frac = s.slice(lastDot + 1);
    }
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    const grouped = parts.slice(1).every((part) => part.length === 3);
    if (grouped) {
      whole = parts.join('');
      frac = '';
    } else if (parts.length === 2 && parts[1]!.length >= 1 && parts[1]!.length <= 2) {
      whole = parts[0]!;
      frac = parts[1]!;
    } else {
      return null;
    }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    const grouped = parts.length > 2 && parts.slice(1).every((part) => part.length === 3);
    if (grouped) {
      whole = parts.join('');
      frac = '';
    } else if (parts.length === 2) {
      whole = parts[0]!;
      frac = parts[1]!;
    } else {
      return null;
    }
  } else {
    whole = s;
    frac = '';
  }
  if (!/^\d+$/.test(whole) || (frac.length > 0 && !/^\d+$/.test(frac))) return null;
  const rounded = roundMoneyFrac(whole, frac);
  const trimmedWhole = rounded.whole.replace(/^0+(?=\d)/, '');
  const trimmedFrac = rounded.frac.replace(/0+$/, '');
  return trimmedFrac.length === 0 ? trimmedWhole : `${trimmedWhole}.${trimmedFrac}`;
}

function roundMoneyFrac(whole: string, frac: string): { whole: string; frac: string } {
  if (frac.length <= 6) return { whole, frac };
  const head = frac.slice(0, 6);
  if (frac[6]! < '5') return { whole, frac: head };
  const combined = BigInt(whole + head) + 1n;
  const text = combined.toString().padStart(whole.length + 6, '0');
  return { whole: text.slice(0, -6), frac: text.slice(-6) };
}

function unitsToFixedMicrosString(units: number): string {
  if (!Number.isFinite(units)) {
    throw new Error('Invalid money units');
  }
  return units.toFixed(6);
}

/**
 * Formats integer micros as an exact decimal string (no IEEE-754).
 *
 * WHY: brief, Dust markdown, and email tokens must not call
 * `Number(micros) / 1e6` or `toString()` on that Number. Large values and
 * fractional cents have to survive as the same digits that are stored.
 * Trailing fractional zeros are dropped (`1_230_000` → `1.23`).
 */
export function formatMicrosDecimal(micros: bigint | number): string {
  const value = toBigIntMicros(micros);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const frac = remainder.toString().padStart(6, '0').replace(/0+$/, '');
  const body = frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
  return negative ? `-${body}` : body;
}
