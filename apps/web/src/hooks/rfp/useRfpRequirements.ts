import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface Requirement {
  id: string;
  text: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  aiConfidenceBps: number | null; // 0-10000; null = no AI confidence exists
  pageRef: number | null;
}

interface RequirementsResult {
  items: Requirement[];
  total: number;
}

export function useRfpRequirements(bidWorkspaceId: string | null) {
  return useQuery<RequirementsResult>({
    queryKey: ['rfp', bidWorkspaceId, 'requirements'],
    queryFn: ({ signal }) =>
      api<RequirementsResult>(`/api/v1/bid-workspaces/${bidWorkspaceId}/requirements`, { signal }),
    // WHY: only fetch when we have a workspace ID and are past extraction stage
    enabled: !!bidWorkspaceId,
    staleTime: 30_000, // requirements don't change mid-pipeline
  });
}
