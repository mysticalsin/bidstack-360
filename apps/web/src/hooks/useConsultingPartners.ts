// Slice 15 consulting partners: the precomputed summary, paged evidence per
// partner, and a refresh that polls until the worker lands the run.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { ConsultingPartnersRefreshResponse, ConsultingPartnersSummary, PartnerEvidencePage } from '@bidstack/shared';

import { ApiError, api } from '@/lib/api';

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/consulting-partners`;
const POLL_MS = 5_000;
const POLL_FOR_MS = 3 * 60_000;
const PAGE = 10;
const retry = (n: number, err: unknown) => n < 2 && !(err instanceof ApiError && (err.status === 404 || err.status === 403));

/** Partners, score cards, angles and timeline for one account. Polls after a refresh. */
export function useConsultingPartners(companyId: string | undefined, pollUntil?: number) {
  return useQuery({
    queryKey: ['consulting-partners', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<ConsultingPartnersSummary>(base(companyId!), { signal }),
    staleTime: 5 * 60_000,
    retry,
    refetchInterval: (q) => {
      const status = q.state.data?.run.status;
      if (status === 'queued' || status === 'running') return POLL_MS;
      return pollUntil && Date.now() < pollUntil ? POLL_MS : false;
    },
  });
}

/** Evidence for one partner, newest first, paged. */
export function usePartnerEvidence(companyId: string, firmKey: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['consulting-partners', companyId, 'evidence', firmKey],
    enabled: Boolean(firmKey) && enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (pageParam) qs.set('cursor', pageParam);
      return api<PartnerEvidencePage>(`${base(companyId)}/${encodeURIComponent(firmKey!)}/evidence?${qs}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
    retry,
  });
}

/** Queue a scan; invalidate and poll for a few minutes. */
export function useRefreshConsultingPartners(companyId: string) {
  const qc = useQueryClient();
  const [pollUntil, setPollUntil] = useState<number | undefined>(undefined);
  const m = useMutation({
    mutationFn: () => api<ConsultingPartnersRefreshResponse>(`${base(companyId)}/refresh`, { method: 'POST' }),
    onSuccess: () => {
      setPollUntil(Date.now() + POLL_FOR_MS);
      setTimeout(() => setPollUntil(undefined), POLL_FOR_MS + POLL_MS);
      void qc.invalidateQueries({ queryKey: ['consulting-partners', companyId] });
    },
  });
  return { ...m, pollUntil };
}
