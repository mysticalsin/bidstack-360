import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { OpenDataSignalsResponse } from '@bidstack/shared';

interface OpenDataSignalsInput {
  query?: string | null;
  ticker?: string | null;
}

export function useOpenDataSignals({ query, ticker }: OpenDataSignalsInput) {
  return useQuery({
    queryKey: ['crm-open-data-signals', query ?? '', ticker ?? ''],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (ticker) params.set('ticker', ticker);
      const suffix = params.toString();
      return api<OpenDataSignalsResponse>(
        `/api/crm/open-data/signals${suffix ? `?${suffix}` : ''}`,
        { signal },
      );
    },
    staleTime: 120_000,
    retry: false,
  });
}
