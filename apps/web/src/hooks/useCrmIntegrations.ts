import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CrmConnector, DataQualityReport, ProviderHealth } from '@bidstack/shared';

export function useConnectorCatalog() {
  return useQuery({
    queryKey: ['crm-connectors'],
    queryFn: ({ signal }) => api<{ items: CrmConnector[] }>('/api/crm/connectors', { signal }),
    // Catalog is essentially static (rebuilt on deploy); cache for the session.
    staleTime: 5 * 60 * 1000,
  });
}

export function useDataQuality() {
  return useQuery({
    queryKey: ['crm-data-quality'],
    queryFn: ({ signal }) => api<DataQualityReport>('/api/crm/data-quality', { signal }),
    staleTime: 30 * 1000,
    // Data quality changes as enrichment jobs land — refresh on tab focus
    // so an admin who comes back to the tab sees fresh issues.
    refetchOnWindowFocus: true,
  });
}

export function useProviderHealth() {
  return useQuery({
    queryKey: ['crm-provider-health'],
    queryFn: ({ signal }) =>
      api<{ items: ProviderHealth[] }>('/api/crm/provider-health', { signal }),
    staleTime: 30 * 1000,
    // Provider health is polled every 30s when the tab is focused, and
    // also refetches the moment focus returns so we never show stale
    // "healthy" while a provider has been down for minutes.
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
