import { formatMicrosAmount, microsToUnits, unitsToMicros } from '@bidstack/shared';

/**
 * Opportunity rows do not store a currency. A summed pipeline is not a euro
 * forecast, and converting it from a hardcoded EUR source would invent one.
 */
export const UNSPECIFIED_CURRENCY_BASIS = 'currency not recorded; not a euro forecast';

export function formatUnspecifiedAmount(value: number): string {
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  return amount;
}

function asMicros(micros: string | number | bigint): bigint {
  if (typeof micros === 'bigint') return micros;
  if (typeof micros === 'number') return BigInt(Math.trunc(micros));
  return BigInt(micros);
}

/** A zero share draws no bar. A positive share keeps a visible floor. */
export function shareBarWidth(sharePercent: number, floor: number): number {
  if (!(sharePercent > 0)) return 0;
  return Math.max(floor, Math.round(sharePercent));
}

/** Share of whole, in percent, from integer micros. */
export function microsSharePercent(
  part: string | number | bigint,
  whole: string | number | bigint,
): number {
  const w = asMicros(whole);
  if (w <= 0n) return 0;
  return Number((asMicros(part) * 10_000n) / w) / 100;
}

export function compareMicros(a: string | number | bigint, b: string | number | bigint): number {
  const av = asMicros(a);
  const bv = asMicros(b);
  return av > bv ? 1 : av < bv ? -1 : 0;
}

/** Full amount to the cent, with the missing-currency mark. */
export function formatExactUnspecified(micros: string | number | bigint): string {
  return `${formatMicrosAmount(asMicros(micros))} unspecified`;
}

/** Column total in integer micros. The digit string wins over the unit number. */
export function sumRecordedDealMicros(
  deals: readonly { value: number; valueMicros?: string | null }[],
): bigint {
  return deals.reduce((sum, deal) => sum + recordedMicros(deal.value, deal.valueMicros), 0n);
}

/** Column total in major units. Micros win, then the sum is rounded to the cent. */
export function sumRecordedDealUnits(
  deals: readonly { value: number; valueMicros?: string | null }[],
): number {
  const micros = sumRecordedDealMicros(deals);
  const cents = (micros + 5_000n) / 10_000n;
  return microsToUnits(cents * 10_000n);
}

/** A deal amount. The micros string wins when the unit number was stored as zero. */
export function formatRecordedDealAmount(
  deal: { value: number; valueMicros?: string | null },
  mode: 'amount' | 'compact' = 'amount',
): string {
  if (deal.valueMicros && /^\d+$/.test(deal.valueMicros)) {
    return mode === 'compact'
      ? unspecifiedMicrosLabel(deal.valueMicros)
      : formatMicrosAmount(asMicros(deal.valueMicros));
  }
  return mode === 'compact'
    ? formatUnspecifiedCompact(deal.value)
    : formatUnspecifiedAmount(deal.value);
}

/** Integer micros to units. Number(bigint) / 1e6 moves a large amount by one cent. */
export function unitsFromMicros(micros: string | number | bigint): number {
  const asBigInt =
    typeof micros === 'bigint'
      ? micros
      : typeof micros === 'number'
        ? BigInt(Math.trunc(micros))
        : BigInt(micros);
  const whole = asBigInt / 1_000_000n;
  const remainder = asBigInt % 1_000_000n;
  return Number(whole) + Number(remainder) / 1_000_000;
}

/** Compact amount with an explicit missing-currency mark. Not a dollar or euro figure. */
export function formatUnspecifiedCompact(value: number): string {
  const amount = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
  return `${amount} unspecified`;
}

/**
 * The micros digit string wins. A unit number is only a fallback, and only
 * while it converts exactly. A number past the safe integer range adds nothing.
 */
export function recordedMicros(value: number, micros?: string | null): bigint {
  if (micros && /^\d+$/.test(micros)) return BigInt(micros);
  return unitsToMicros(value) ?? 0n;
}

function compactMicrosMagnitude(micros: bigint): number {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const units = abs / 1_000_000n;
  const remainder = abs % 1_000_000n;
  let magnitude: number;
  if (units <= BigInt(Number.MAX_SAFE_INTEGER)) {
    magnitude = Number(units) + Number(remainder) / 1_000_000;
  } else {
    const digits = units.toString();
    const significant = digits.slice(0, 15);
    magnitude = Number(significant) * 10 ** (digits.length - significant.length);
  }
  return negative ? -magnitude : magnitude;
}

/** Decimal-digit zeros. Eastern Arabic, Persian, and Bengali are not 0-9. */
const DECIMAL_DIGIT_ZERO = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50,
  0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0,
  0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xaa50, 0xabf0, 0xff10,
];

function asciiNumerals(value: string): string | null {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code == null) return null;
    if (code >= 0x30 && code <= 0x39) {
      out += ch;
      continue;
    }
    const zero = DECIMAL_DIGIT_ZERO.find((start) => code >= start && code < start + 10);
    if (zero == null) return null;
    out += String(code - zero);
  }
  return out;
}

function compactFormatter(locale?: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 2,
  });
}

/**
 * The unit count a compact label actually names, using that locale's step.
 * Japanese 万 is 10,000. English M is 1,000,000. Null when the label cannot be read.
 */
function compactDisplayedUnits(absMicros: bigint, locale?: string): bigint | null {
  const cents = (absMicros + 5_000n) / 10_000n;
  const units = cents / 100n;
  const frac = cents % 100n;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const magnitude = Number(units) + Number(frac) / 100;
  if (frac !== 0n && magnitude === Number(units)) return null;
  const formatter = compactFormatter(locale);
  const parts = formatter.formatToParts(magnitude);
  let digits = '';
  let fractionLen = 0;
  let hasCompact = false;
  for (const part of parts) {
    if (part.type === 'integer' || part.type === 'fraction') {
      const numerals = asciiNumerals(part.value);
      if (numerals == null) return null;
      digits += numerals;
      if (part.type === 'fraction') fractionLen = numerals.length;
    } else if (part.type === 'compact' && part.value.trim()) hasCompact = true;
  }
  if (!digits) return null;
  const coefficient = BigInt(digits);
  if (!hasCompact) {
    const recovered =
      fractionLen >= 2
        ? coefficient / 10n ** BigInt(fractionLen - 2)
        : coefficient * 10n ** BigInt(2 - fractionLen);
    return recovered === cents ? units : null;
  }
  const label = formatter.format(magnitude);
  for (let exponent = fractionLen; exponent <= fractionLen + 18; exponent += 1) {
    const recovered = coefficient * 10n ** BigInt(exponent - fractionLen);
    if (recovered > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    if (formatter.format(Number(recovered)) === label) return recovered;
  }
  return null;
}

/** The locale's compact label names this cent. 12.02M does not name 12,015,000. 1201.5万 does. */
function compactKeepsCents(absMicros: bigint, locale?: string): boolean {
  const cents = (absMicros + 5_000n) / 10_000n;
  const shown = compactDisplayedUnits(absMicros, locale);
  return shown != null && shown * 100n === cents;
}

/**
 * Compact while that label is the same cent. Past the safe unit count, or when
 * compact rounding moves the amount, the full integer.
 */
export function headlineMicrosLabel(micros: string | number | bigint, locale?: string): string {
  const value = asMicros(micros);
  const abs = value < 0n ? -value : value;
  if (abs / 1_000_000n > BigInt(Number.MAX_SAFE_INTEGER) || !compactKeepsCents(abs, locale)) {
    return formatMicrosAmount(value);
  }
  return compactFormatter(locale).format(compactMicrosMagnitude(value));
}

/** Compact or full amount, with the missing-currency mark. */
export function unspecifiedMicrosLabel(micros: string | number | bigint): string {
  return `${headlineMicrosLabel(micros)} unspecified`;
}

/** Compact from integer micros. Unit counts past the safe range keep their leading digits. */
export function formatUnspecifiedCompactMicros(micros: string | number | bigint): string {
  return formatUnspecifiedCompact(compactMicrosMagnitude(asMicros(micros)));
}
