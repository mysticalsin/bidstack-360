import { formatMicrosAmount } from '@bidstack/shared';

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
