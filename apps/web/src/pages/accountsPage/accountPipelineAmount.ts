import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

/**
 * Weighted pipeline on the accounts list, in major units.
 * Opportunity rows store micros and do not store a currency, so this number
 * is not converted from euros.
 */
export function accountPipelineAmount(micros: number): string {
  return formatUnspecifiedAmount(Math.round(micros / 1_000_000));
}
