import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface OrgSummary {
  companies: number;
  contacts: number;
  leads: number;
  opportunities: number;
  openOpportunities: number;
  pipelineValue: number;
  tasks: number;
  overdueTasks: number;
  serviceCases: number;
  openServiceCases: number;
  recentActivity: Array<{
    type: string;
    title: string;
    subtitle: string | null;
    date: string;
    url: string | null;
  }>;
}

export function useOrgSummary() {
  return useQuery<OrgSummary>({
    queryKey: ['org-summary'],
    queryFn: async () => api('/api/crm/summary'),
    staleTime: 30_000,
  });
}
