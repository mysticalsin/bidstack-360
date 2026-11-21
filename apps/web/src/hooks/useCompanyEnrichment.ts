import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { usePoloMe } from '@/hooks/usePoloIdentity';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fetchEnrichment, refreshEnrichment, type EnrichmentDataMode } from '@/lib/enrichment/client';
import type { CompanyEnrichment } from '@/lib/enrichment/types';
import { useRuntimeMode } from '@/lib/runtime-mode';

const key = (companyId: string | undefined) => ['company-enrichment', companyId] as const;
/** After a refresh, poll this long for the worker to land new data. */
const POLL_MS = 5_000;
const POLL_FOR_MS = 3 * 60_000;

/** True while a queued refresh has not landed yet (pure: pass the time to judge at). */
export function awaitingRefresh(d: CompanyEnrichment | undefined, pollUntil: number | undefined, at: number): boolean {
  if (!pollUntil || at > pollUntil) return false;
  if (!d) return true;
  return d.sample || d.status === 'pending' || !d.fetchedAt || new Date(d.fetchedAt).getTime() < pollUntil - POLL_FOR_MS;
}

export function useCompanyEnrichment(companyId: string | undefined, opts: { pollUntil?: number } = {}) {
  const { isSignedIn } = useAuth();
  const me = usePoloMe(isSignedIn);
  const runtime = useRuntimeMode();
  // /me is the org's resolved mode. The public identity is the boot snapshot,
  // which stays real until that override is known. Anything other than demo is real.
  const dataMode: EnrichmentDataMode =
    (isSignedIn ? me.data?.dataMode : runtime?.dataMode) === 'demo' ? 'demo' : 'real';
  const modeKnown = !isSignedIn || me.isFetched || me.isError;
  return useQuery({
    queryKey: [...key(companyId), dataMode],
    queryFn: ({ signal }) => fetchEnrichment(companyId!, dataMode, signal),
    enabled: Boolean(companyId) && modeKnown,
    staleTime: 5 * 60_000,
    retry: (n, err) => n < 2 && !(err instanceof ApiError && (err.status === 404 || err.status === 403)),
    refetchInterval: (q) => {
      // Stop once real, settled data is in (or the window closes).
      return awaitingRefresh(q.state.data, opts.pollUntil, Date.now()) ? POLL_MS : false;
    },
  });
}

/** "Refresh" on the account page: queue an enrichment run, then poll until it lands. */
export function useRefreshEnrichment(companyId: string) {
  const qc = useQueryClient();
  const [pollUntil, setPollUntil] = useState<number | undefined>(undefined);
  const m = useMutation({
    mutationFn: () => refreshEnrichment(companyId),
    onSuccess: () => {
      setPollUntil(Date.now() + POLL_FOR_MS);
      // Close the window even if the worker never lands, so the UI can't stick on "Refreshing…".
      setTimeout(() => setPollUntil(undefined), POLL_FOR_MS + POLL_MS);
      void qc.invalidateQueries({ queryKey: key(companyId) });
      void qc.invalidateQueries({ queryKey: ['account-watchdog', companyId] });
    },
  });
  return { ...m, pollUntil };
}
