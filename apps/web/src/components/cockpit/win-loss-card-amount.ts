import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

const MICROS_PER_UNIT = 1_000_000n;

/**
 * The account win/loss card prints won opportunity valueMicros. Those rows
 * do not store a currency, so the label is the grouped units and not a euro
 * conversion. The win-rate bar stays on the count.
 */
export function winLossCardAmount(micros: string | number | bigint): string {
  const asNumber =
    typeof micros === 'bigint' ? Number(micros) : typeof micros === 'number' ? micros : Number(micros.trim());
  if (!Number.isSafeInteger(asNumber)) return 'Not a number';
  const value = BigInt(asNumber);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  if (!Number.isFinite(units)) return 'Not a number';
  return formatUnspecifiedAmount(negative ? -units : units);
}
