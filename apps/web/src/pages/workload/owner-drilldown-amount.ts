import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

/**
 * An owner drilldown prints opportunity value. Those rows do not store a
 * currency, so the label is the grouped units and not a euro conversion.
 * The team total and the desk row stay on their own formatters.
 */
export function ownerDrilldownAmount(units: number): string {
  if (!Number.isSafeInteger(units)) return 'Not a number';
  return formatUnspecifiedAmount(units);
}
