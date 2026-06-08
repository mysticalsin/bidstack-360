import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { Opportunity, OpportunityPage } from '@bidstack/shared';

export type OpportunityPageSnapshot = readonly [QueryKey, OpportunityPage];

export function isOpportunityPage(value: unknown): value is OpportunityPage {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as { items?: unknown }).items);
}

export function updateCachedOpportunityPages(
  queryClient: QueryClient,
  updater: (opportunity: Opportunity) => Opportunity,
): OpportunityPageSnapshot[] {
  const snapshots: OpportunityPageSnapshot[] = [];
  queryClient.getQueriesData<unknown>({ queryKey: ['opportunities'] }).forEach(([key, value]) => {
    if (!isOpportunityPage(value)) return;
    snapshots.push([key, value]);
    queryClient.setQueryData<OpportunityPage>(key, {
      ...value,
      items: value.items.map(updater),
    });
  });
  return snapshots;
}
