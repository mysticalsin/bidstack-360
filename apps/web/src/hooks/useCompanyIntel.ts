// Slice 12 account intelligence: direction, hiring, financials, news, and a
// per-source refresh that polls until the worker lands the run.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  AccountDirection,
  AccountFinancialsIntel,
  AccountHiringIntel,
  AccountNewsIntel,
  IntelRefreshResponse,
  IntelSourceKey,
} from '@bidstack/shared';

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

/** Direction: cited claims, investment plan, bid relevance and source status. */
export function useCompanyDirection(companyId: string | undefined, pollUntil?: number) {
  return useIntel<AccountDirection>('direction', companyId, pollUntil);
}

/** Hiring summary and recent postings. */
export function useCompanyHiringIntel(companyId: string | undefined, pollUntil?: number) {
  return useIntel<AccountHiringIntel>('hiring', companyId, pollUntil);
}

/** Financial years with source, registry facts and labelled fallback. */
export function useCompanyFinancialsIntel(companyId: string | undefined, pollUntil?: number) {
  return useIntel<AccountFinancialsIntel>('financials', companyId, pollUntil);
}

/** Company posts and major news. */
export function useCompanyNewsIntel(companyId: string | undefined, pollUntil?: number) {
  return useIntel<AccountNewsIntel>('news', companyId, pollUntil);
}

/** Queue one source; invalidate and poll the intel views for a few minutes. */
export function useRefreshIntelSource(companyId: string) {
  const qc = useQueryClient();
  const [pollUntil, setPollUntil] = useState<number | undefined>(undefined);
  const m = useMutation({
    mutationFn: (source: IntelSourceKey) =>
      api<IntelRefreshResponse>(`${base(companyId)}/refresh`, { method: 'POST', body: { source } }),
    onSuccess: () => {
      setPollUntil(Date.now() + POLL_FOR_MS);
      setTimeout(() => setPollUntil(undefined), POLL_FOR_MS + POLL_MS);
      void qc.invalidateQueries({ queryKey: ['company-intel', companyId] });
    },
  });
  return { ...m, pollUntil };
}
