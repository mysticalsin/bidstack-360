import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { SyncOverview, SyncRun, SyncSource } from '@bidstack/shared';

import { api } from '@/lib/api';

const DEFAULT_POLL_MS = 1500;

const finished = (run: SyncRun | undefined) =>
  run?.state === 'completed' || run?.state === 'failed';

function newIdempotencyKey(source: SyncSource): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `sync-${source}-${random}`;
}

/** Start, poll and read one pull source's "Sync now" run. */
export function useSyncNow(source: SyncSource, pollMs = DEFAULT_POLL_MS) {
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);

  const overview = useQuery<SyncOverview>({
    queryKey: ['sync-now', source, 'overview'],
    queryFn: () => api(`/api/sync-now/${source}`),
    staleTime: 30_000,
  });

  const start = useMutation({
    mutationFn: () =>
      api<SyncRun>(`/api/sync-now/${source}`, {
        method: 'POST',
        body: {},
        headers: { 'Idempotency-Key': newIdempotencyKey(source) },
      }),
    onSuccess: (run) => {
      qc.setQueryData(['sync-now', source, 'run', run.runId], run);
      setRunId(run.runId);
    },
  });

  const run = useQuery<SyncRun>({
    queryKey: ['sync-now', source, 'run', runId],
    queryFn: () => api(`/api/sync-now/${source}/runs/${runId}`),
    enabled: runId !== null,
    refetchInterval: (query) => (finished(query.state.data) ? false : pollMs),
  });

  const current = run.data ?? overview.data?.lastRun ?? undefined;
  const busy = start.isPending || (runId !== null && !finished(run.data));

  const done = runId !== null && finished(run.data);
  useEffect(() => {
    if (done) void qc.invalidateQueries({ queryKey: ['sync-now', source, 'overview'] });
  }, [done, qc, source]);

  return {
    lastSyncedAt: overview.data?.lastSyncedAt ?? null,
    overviewLoading: overview.isLoading,
    run: current ?? null,
    busy,
    startError: start.error,
    start: () => start.mutate(),
  };
}
