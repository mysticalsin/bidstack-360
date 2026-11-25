/**
 * The deal board total sums opportunity value. Those rows do not store a
 * currency. This copy of the old label still names EUR so the red test can
 * fail before the units label lands.
 */
export function pipelineKpiAmount(value: number): string {
  if (!Number.isFinite(value)) return 'Not a number';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}
