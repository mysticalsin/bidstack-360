import { useQuery } from '@tanstack/react-query';

import type { CompanyActivitySummary } from '@bidstack/shared';

import { api } from '@/lib/api';

export function useCompanyActivitySummary(companyId: string | undefined, tz: string) {
  return useQuery<CompanyActivitySummary>({
    queryKey: ['company-activity-summary', companyId, tz],
    queryFn: () => api(`/api/companies/${companyId}/activity-summary?tz=${encodeURIComponent(tz)}`),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}
