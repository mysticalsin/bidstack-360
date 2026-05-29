import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SalesIntelligenceReport } from '@bidstack/shared';

export function useSalesIntelligenceReport() {
  return useQuery<SalesIntelligenceReport>({
    queryKey: ['reports', 'sales-intelligence'],
    queryFn: async () => api<SalesIntelligenceReport>('/api/reports/sales-intelligence'),
    staleTime: 60_000,
  });
}
