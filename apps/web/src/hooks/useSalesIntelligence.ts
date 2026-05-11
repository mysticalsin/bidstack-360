import { useQuery } from '@tanstack/react-query';

import type { SalesIntelligenceReport } from '@bidstack/shared';

import { api } from '@/lib/api';

export function useSalesIntelligence() {
  return useQuery({
    queryKey: ['report:sales-intelligence'],
    queryFn: ({ signal }) =>
      api<SalesIntelligenceReport>('/api/reports/sales-intelligence', { signal }),
    staleTime: 60_000,
  });
}
