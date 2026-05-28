import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface ComplianceRow {
  id: string;
  requirement: string;
  response: string | null;
  status: 'pending' | 'compliant' | 'partial' | 'non_compliant';
  autoFilled: boolean;
  aiConfidenceBps: number; // 0-10000
}

interface ComplianceResult {
  items: ComplianceRow[];
  total: number;
  compliantCount: number;
  pendingCount: number;
}

export function useRfpCompliance(bidWorkspaceId: string | null) {
  return useQuery<ComplianceResult>({
    queryKey: ['rfp', bidWorkspaceId, 'compliance'],
    queryFn: ({ signal }) =>
      api<ComplianceResult>(`/api/v1/bid-workspaces/${bidWorkspaceId}/compliance`, { signal }),
    enabled: !!bidWorkspaceId,
    staleTime: 15_000,
  });
}
