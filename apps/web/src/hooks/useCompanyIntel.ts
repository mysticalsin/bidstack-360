// Slice 12 account intelligence: direction, hiring, financials, news, and a
// per-source refresh that polls until the worker lands the run.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type {
  AccountDirection,
  AccountFinancialsIntel,
  AccountHiringIntel,
  AccountNewsIntel,
  IntelRefreshResponse,
  IntelSourceKey,
} from '@bidstack/shared';

import { toast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/intel`;
const POLL_MS = 5_000;
const POLL_FOR_MS = 3 * 60_000;
const retry = (n: number, err: unknown) => n < 2 && !(err instanceof ApiError && (err.status === 404 || err.status === 403));

function useIntel<T>(view: string, companyId: string | undefined, pollUntil?: number) {
  return useQuery({
    queryKey: ['company-intel', companyId, view],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<T>(`${base(companyId!)}/${view}`, { signal }),
    staleTime: 5 * 60_000,
    retry,
    refetchInterval: () => (pollUntil && Date.now() < pollUntil ? POLL_MS : false),
  });
}

/** Direction: cited claims, investment plan, bid relevance and source status. Polls after a refresh. */
export function useCompanyDirection(companyId: string | undefined, pollUntil?: number) {
  const q = useIntel<AccountDirection>('direction', companyId, pollUntil);
  const qc = useQueryClient();
  const runs = q.data?.sources.map((s) => `${s.key}:${s.status}:${s.lastFetchedAt ?? ''}`).join('|') ?? '';
  const seen = useRef(runs);
  useEffect(() => {
    if (seen.current === runs) return;
    seen.current = runs;
    for (const view of ['hiring', 'financials', 'news']) void qc.invalidateQueries({ queryKey: ['company-intel', companyId, view] });
  }, [runs, companyId, qc]);
  return q;
}

/** Hiring summary and recent postings. */
export function useCompanyHiringIntel(companyId: string | undefined) {
  return useIntel<AccountHiringIntel>('hiring', companyId);
}

/** Financial years with source, registry facts and labelled fallback. */
export function useCompanyFinancialsIntel(companyId: string | undefined) {
  return useIntel<AccountFinancialsIntel>('financials', companyId);
}

/** Company posts and major news. */
export function useCompanyNewsIntel(companyId: string | undefined) {
  return useIntel<AccountNewsIntel>('news', companyId);
}

function refreshErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'You do not have permission to refresh account intelligence.';
  if (err instanceof ApiError && err.status === 429) return 'Too many refreshes. Try again in a minute.';
  if (err instanceof ApiError) return `Refresh failed: ${err.message}`;
  return err instanceof Error && err.message ? err.message : 'Refresh failed. Check your connection and try again.';
}

/** Queue one source; invalidate and poll the intel views for a few minutes. Failures raise a toast. */
export function useRefreshIntelSource(companyId: string) {
  const qc = useQueryClient();
  const [pollUntil, setPollUntil] = useState<number | undefined>(undefined);
  const m = useMutation({
    mutationFn: async (source: IntelSourceKey) => {
      const res = await api<IntelRefreshResponse>(`${base(companyId)}/refresh`, { method: 'POST', body: { source } });
      if (!res.queued) throw new Error(`${res.status.label} refresh could not be queued. Try again in a minute.`);
      return res;
    },
    onSuccess: () => {
      setPollUntil(Date.now() + POLL_FOR_MS);
      setTimeout(() => setPollUntil(undefined), POLL_FOR_MS + POLL_MS);
      void qc.invalidateQueries({ queryKey: ['company-intel', companyId] });
    },
    onError: (err) => toast.error(refreshErrorMessage(err)),
  });
  return { ...m, pollUntil };
}
