import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

/**
 * A stage column sums opportunity value. Those rows do not store a
 * currency, so the label is the grouped units and not a euro conversion.
 * Whole units keep the tween from showing a fractional unit.
 */
export function pipelineColumnAmount(value: number): string {
  if (!Number.isFinite(value)) return 'Not a number';
  return formatUnspecifiedAmount(Math.round(value));
}
