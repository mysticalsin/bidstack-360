import type { ProviderHealth } from '@bidstack/shared';

const STATUS_LABEL: Record<ProviderHealth['status'], string> = {
  down: 'down',
  degraded: 'degraded',
  healthy: 'healthy',
  disabled: 'not set up',
  unverified: 'not a live probe',
};

// Failures first, then the open count, then the rows that are not failures.
const ORDER: ProviderHealth['status'][] = [
  'down',
  'degraded',
  'healthy',
  'disabled',
  'unverified',
];

/**
 * Count the provider-health rows this read returned. A disabled row is an
 * unset key. An unverified row was not probed. Neither is folded into a
 * healthy-out-of-total ratio.
 */
export function integrationHealthCaption(
  items: Array<Pick<ProviderHealth, 'status'>>,
): string {
  const counts: Record<ProviderHealth['status'], number> = {
    healthy: 0,
    degraded: 0,
    unverified: 0,
    down: 0,
    disabled: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return ORDER.filter((status) => status === 'healthy' || counts[status] > 0)
    .map((status) => `${counts[status]} ${STATUS_LABEL[status]}`)
    .join(', ');
}

export function integrationHealthLine(input: {
  items: Array<Pick<ProviderHealth, 'status'>>;
  isLoading: boolean;
  isError: boolean;
}): string {
  if (input.items.length > 0) return integrationHealthCaption(input.items);
  if (input.isLoading) return 'Checking provider health';
  if (input.isError) return 'Could not load provider health';
  return 'No provider health in this read';
}
