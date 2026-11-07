// Slice 14 company intel summary: the per-company summary the list and the
// header strip read, a one-click refresh of every source, and the progress of
// enrichment queued by recent imports.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { CompanyIntelSummary, IntelImportBatchView } from '@bidstack/shared';

import { toast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';

const POLL_MS = 5_000;
const POLL_FOR_MS = 3 * 60_000;
const retry = (n: number, err: unknown) =>
  n < 2 && !(err instanceof ApiError && (err.status === 404 || err.status === 403));

/** The stored summary for one company; polls for a few minutes after a refresh. */
export function useCompanyIntelSummary(companyId: string | undefined, pollUntil?: number) {
  return useQuery({
    queryKey: ['company-intel', companyId, 'summary'],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) =>
      api<{ summary: CompanyIntelSummary | null }>(
        `/api/companies/${encodeURIComponent(companyId!)}/intel/summary`,
        { signal },
      ),
    staleTime: 60_000,
    retry,
    refetchInterval: () => (pollUntil && Date.now() < pollUntil ? POLL_MS : false),
  });
}

/** Queue every public source plus Apollo organization data for one company. */
export function useRefreshCompanyIntel(companyId: string) {
  const qc = useQueryClient();
  const [pollUntil, setPollUntil] = useState<number | undefined>(undefined);
  const m = useMutation({
    mutationFn: () =>
      api<{ queued: boolean }>(
        `/api/companies/${encodeURIComponent(companyId)}/intel/refresh-all`,
        { method: 'POST' },
      ),
    onSuccess: (res) => {
      if (!res.queued) {
        toast.error('Refresh not queued, try again shortly');
        return;
      }
      setPollUntil(Date.now() + POLL_FOR_MS);
      setTimeout(() => setPollUntil(undefined), POLL_FOR_MS + POLL_MS);
      void qc.invalidateQueries({ queryKey: ['company-intel', companyId] });
      void qc.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not refresh'),
  });
  return { ...m, pollUntil };
}

/** Enrichment progress for imports in the last day; polls while one is running. */
export function useIntelImports(enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['company-intel-imports'],
    enabled,
    queryFn: async ({ signal }) => {
      const res = await api<{ items: IntelImportBatchView[] }>('/api/companies/intel-imports', {
        signal,
      });
      if (res.items.some((b) => b.status === 'running'))
        void qc.invalidateQueries({ queryKey: ['companies'] });
      return res;
    },
    staleTime: 10_000,
    retry,
    refetchInterval: (q) =>
      q.state.data?.items.some((b) => b.status === 'running') ? POLL_MS : false,
  });
}
