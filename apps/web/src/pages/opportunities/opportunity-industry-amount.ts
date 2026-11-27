import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

/**
 * Territory segments sum opportunity value_micros. An opportunity has no
 * currency column, so the sum is not a euro amount and is not converted.
 */
export function opportunityIndustryAmount(micros: string | number | bigint): string {
  const asBigInt =
    typeof micros === 'bigint'
      ? micros
      : BigInt(typeof micros === 'number' ? Math.trunc(micros) : micros);
  const whole = asBigInt / 1_000_000n;
  const remainder = asBigInt % 1_000_000n;
  return formatUnspecifiedAmount(Number(whole) + Number(remainder) / 1_000_000);
}
