// The region form may name a pin or a bucket only after a settled view arrives.
// A placeholder, a pending shell, or a partial object has not arrived.
// A failed status wins over a stale view, including when isError is still false.
// Undefined data keeps the load error. This helper does not retitle that case.

import { DATA_REGIONS } from '@bidstack/shared';

export type DataResidencyClaim = 'skeleton' | 'failed' | 'withheld' | 'ready';

export interface DataResidencyClaimInput {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isPlaceholderData?: boolean;
  status?: string;
}

const REGIONS = new Set<string>(DATA_REGIONS);

function isSettledView(data: unknown): boolean {
  if (typeof data !== 'object' || data == null) return false;
  const view = data as { region?: unknown; enforced?: unknown; regionalStorage?: unknown };
  const regionOk =
    view.region === null || (typeof view.region === 'string' && REGIONS.has(view.region));
  return (
    regionOk && typeof view.enforced === 'boolean' && typeof view.regionalStorage === 'boolean'
  );
}

export function dataResidencyClaim(input: DataResidencyClaimInput): DataResidencyClaim {
  if (input.isLoading) return 'skeleton';
  if (input.isError === true || input.status === 'error') return 'failed';
  if (input.data == null) return 'failed';
  if (
    input.isPlaceholderData === true ||
    input.status === 'pending' ||
    !isSettledView(input.data)
  ) {
    return 'withheld';
  }
  return 'ready';
}
