import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  Opportunity,
  OpportunityFilter,
  OpportunityPage,
  OpportunityPatch,
} from '@bidstack/shared';

export function useOpportunities(filter: Partial<OpportunityFilter> = {}) {
  return useQuery({
    queryKey: ['opportunities', filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
      return api<OpportunityPage>(`/api/opportunities?${params.toString()}`, { signal });
    },
  });
}

/** Lightweight count for badges / KPIs — avoids fetching 200 rows just for a number. */
export function useOpportunityCount(opts: { excludeClosed?: boolean } = {}) {
  return useQuery({
    queryKey: ['opportunities', 'count', opts],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (opts.excludeClosed) params.set('excludeClosed', 'true');
      return api<{ count: number }>(`/api/opportunities/count?${params.toString()}`, { signal });
    },
    staleTime: 30_000,
  });
}

// Full 360° payload — see apps/api/src/serializers/opportunity.ts
export interface OpportunityFull extends Opportunity {
  intel: Record<string, unknown>;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  documents: Array<{
    id: string;
    name: string;
    kind: string;
    bytes: number | null;
    createdAt: string;
  }>;
}

export function useOpportunity(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['opportunity', id],
    queryFn: ({ signal }) => api<OpportunityFull>(`/api/opportunities/${id}`, { signal }),
  });
}

// Inline-edit hook for a single opportunity. The route is PATCH-shaped on
// the server (partial patches with full audit log) — we expose the same
// shape here so call sites can save just the field that changed.
//
// Optimistic update: we mutate every cached `['opportunities', …]` page that
// contains this id, plus the single ['opportunity', id] entry. Rollback on
// error restores the snapshot. This makes inline edits feel instant — the
// network round-trip happens after the UI has already updated.
export function usePatchOpportunity(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: OpportunityPatch) => {
      if (!id) throw new Error('Opportunity id required');
      return api<Opportunity>(`/api/opportunities/${id}`, { method: 'PATCH', body: patch });
    },
    onMutate: async (patch) => {
      if (!id) return undefined;
      await qc.cancelQueries({ queryKey: ['opportunities'] });
      await qc.cancelQueries({ queryKey: ['opportunity', id] });

      // Snapshot every active list query so we can roll back on error.
      const listSnapshots: Array<readonly [readonly unknown[], OpportunityPage | undefined]> = [];
      qc.getQueriesData<OpportunityPage>({ queryKey: ['opportunities'] }).forEach(
        ([key, value]) => {
          listSnapshots.push([key, value]);
          if (!value) return;
          qc.setQueryData<OpportunityPage>(key, {
            ...value,
            items: value.items.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          });
        },
      );

      const detailKey = ['opportunity', id] as const;
      const detailSnap = qc.getQueryData<OpportunityFull>(detailKey);
      if (detailSnap) {
        qc.setQueryData<OpportunityFull>(detailKey, { ...detailSnap, ...patch });
      }
      return { listSnapshots, detailSnap };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.listSnapshots.forEach(([key, value]) => qc.setQueryData(key, value));
      if (ctx?.detailSnap && id) qc.setQueryData(['opportunity', id], ctx.detailSnap);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['opportunity', id] });
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      // Pipeline reports aggregate over opportunities; refresh.
      void qc.invalidateQueries({ queryKey: ['pipeline-report'] });
    },
  });
}
