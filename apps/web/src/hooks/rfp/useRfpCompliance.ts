import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface ComplianceRow {
  id: string;
  requirement: string;
  response: string | null;
  status: 'pending' | 'compliant' | 'partial' | 'non_compliant';
  autoFilled: boolean;
  aiConfidenceBps: number | null; // 0-10000; null = no assessment confidence exists
  // UNAVAILABLE = the AI fallback ran — render "not assessed", never 0%.
  assessmentStatus: 'ASSESSED' | 'UNAVAILABLE' | 'PENDING';
  // Requirement.requirementType, surfaced as the matrix's "section" facet.
  // Null = unclassified ('general'), which the facet must not offer as a bucket.
  section: string | null;
  mandatory: boolean;
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

/**
 * Mutation to save an edited compliance answer draft.
 *
 * WHY separate from useRfpCompliance: mutations need the opportunity ID baked
 * in to build the PATCH URL, but the query only needs the bidWorkspaceId
 * (same value — opportunityId IS the bidWorkspaceId in this domain model).
 * Keeping them co-located avoids a second hook file import in consumers.
 */
export function useSaveComplianceRow(opportunityId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rowId, answerDraft }: { rowId: string; answerDraft: string }) =>
      api(`/api/v1/bid-workspaces/${opportunityId}/matrix/${rowId}`, {
        // Pass a plain object — api() JSON.stringifies the body itself. Passing a
        // pre-stringified string double-encoded it, so the PATCH sent a JSON
        // string literal the Zod object schema rejected → answers never saved.
        method: 'PATCH',
        body: { answerDraft },
      }),
    onSuccess: () => {
      // Invalidate the compliance cache so the panel reflects the saved answer.
      void queryClient.invalidateQueries({
        queryKey: ['rfp', opportunityId, 'compliance'],
      });
    },
  });
}
