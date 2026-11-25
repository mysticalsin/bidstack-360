import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

/**
 * The portfolio pipeline card prints a stage value. Those rows do not store a
 * currency, so the label is the grouped units and not a euro conversion.
 */
export function pipelineStageAmount(value: number): string {
  if (!Number.isFinite(value)) return 'Not a number';
  return formatUnspecifiedAmount(value);
}
