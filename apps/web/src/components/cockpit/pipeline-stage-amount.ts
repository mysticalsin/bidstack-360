import { formatMoney } from '@/lib/format';

/**
 * The portfolio pipeline card prints a stage value. Red: the label is still
 * an EUR price, so the 61520 case can fail before the units change.
 */
export function pipelineStageAmount(value: number): string {
  if (!Number.isFinite(value)) return 'Not a number';
  return formatMoney(value, 'EUR');
}
