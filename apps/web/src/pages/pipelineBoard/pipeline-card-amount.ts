import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

/**
 * A deal card prints one opportunity value. Those rows do not store a
 * currency, so the label is the grouped units and not a euro conversion.
 */
export function pipelineCardAmount(value: number): string {
  if (!Number.isFinite(value)) return 'Not a number';
  return formatUnspecifiedAmount(value);
}
