import { useQuery } from '@tanstack/react-query';

import { fetchEnrichment } from '@/lib/enrichment/client';

export function useCompanyEnrichment(companyId: string | undefined) {
  return useQuery({
    queryKey: ['company-enrichment', companyId],
    queryFn: () => fetchEnrichment(companyId!),
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
  });
}
