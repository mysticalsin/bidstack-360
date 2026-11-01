/**
 * Opportunity rows do not store a currency. A summed pipeline is not a euro
 * forecast, and converting it from a hardcoded EUR source would invent one.
 */
export const UNSPECIFIED_CURRENCY_BASIS = 'currency not recorded; not a euro forecast';

export function formatUnspecifiedAmount(value: number): string {
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  return amount;
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
