import { formatMoney } from '@/lib/format';

/**
 * The account header sums open opportunity value. Red: the label is still
 * an EUR price, so the 61520 case can fail before the units change.
 */
export function pageHeadOpenAmount(value: number): string {
  if (!Number.isFinite(value)) return 'Not a number';
  return formatMoney(value, 'EUR');
}
