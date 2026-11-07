import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptWhitespace,
  dismissWhitespace,
  fetchAgreementSources,
  fetchMsaWhitespace,
  fetchRelationshipMap,
  fetchWhitespace,
  syncAgreementSource,
  type WhitespaceFilters,
} from '@/lib/msa/whitespace';

export function useWhitespace(filters: WhitespaceFilters, enabled = true) {
  return useQuery({
    queryKey: ['msa', 'whitespace', filters],
    queryFn: ({ signal }) => fetchWhitespace(filters, signal),
    enabled,
  });
}

export function useMsaWhitespace(msaId: string | undefined) {
  return useQuery({
    queryKey: ['msa', 'whitespace', 'msa', msaId],
    queryFn: ({ signal }) => fetchMsaWhitespace(msaId!, signal),
    enabled: Boolean(msaId),
  });
}

export function useRelationshipMap(companyId: string | undefined | null) {
  return useQuery({
    queryKey: ['msa', 'relationship-map', companyId],
    queryFn: ({ signal }) => fetchRelationshipMap(companyId!, signal),
    enabled: Boolean(companyId),
    retry: (n, err) => n < 1 && !(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404),
  });
}

export function useWhitespaceDecision() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['msa', 'whitespace'] });
    void qc.invalidateQueries({ queryKey: ['cross-sell-actions'] });
  };
  const accept = useMutation({
    mutationFn: (v: { msaId: string; line: string; ownerId: string; dueDate: string; createOpportunity: boolean }) => {
      const { msaId, ...body } = v;
      return acceptWhitespace(msaId, body);
    },
    onSuccess: done,
  });
  const dismiss = useMutation({
    mutationFn: (v: { msaId: string; line: string; reason: string }) => dismissWhitespace(v.msaId, { line: v.line, reason: v.reason }),
    onSuccess: done,
  });
  return { accept, dismiss };
}

export function useAgreementSources(enabled = true) {
  return useQuery({
    queryKey: ['msa', 'sources'],
    queryFn: ({ signal }) => fetchAgreementSources(signal),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((s) => s.lastRun?.state === 'queued' || s.lastRun?.state === 'running') ? 5_000 : false),
  });
}

export function useSyncAgreementSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => syncAgreementSource(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['msa', 'sources'] }),
  });
}
