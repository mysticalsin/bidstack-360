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

/** Column total in major units. Micros win, then the sum is rounded to the cent. */
export function sumRecordedDealUnits(
  deals: readonly { value: number; valueMicros?: string | null }[],
): number {
  const micros = deals.reduce((sum, deal) => {
    if (deal.valueMicros && /^\d+$/.test(deal.valueMicros)) return sum + BigInt(deal.valueMicros);
    if (!Number.isFinite(deal.value)) return sum;
    return sum + (unitsToMicros(deal.value) ?? 0n);
  }, 0n);
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
      ? formatUnspecifiedCompact(unitsFromMicros(deal.valueMicros))
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

/**
 * Compact while the unit count fits in a safe integer. Past that, the full
 * amount, because the collapsed unit number is one unit low.
 */
export function headlineMicrosLabel(micros: string | number | bigint): string {
  const value = asMicros(micros);
  const abs = value < 0n ? -value : value;
  if (abs / 1_000_000n > BigInt(Number.MAX_SAFE_INTEGER)) return formatMicrosAmount(value);
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(compactMicrosMagnitude(value));
}

/** Compact from integer micros. Unit counts past the safe range keep their leading digits. */
export function formatUnspecifiedCompactMicros(micros: string | number | bigint): string {
  return formatUnspecifiedCompact(compactMicrosMagnitude(asMicros(micros)));
}
