import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/Toast';
import { api } from '@/lib/api';

import type {
  Opportunity,
  OpportunityCreate,
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

// P2 #31: extracted from CreateOpportunityDialog — create mutation should be a
// shared hook so Kanban quick-add, import, and future entry points don't each
// duplicate the invalidation list. Per-call callbacks (setOpen, setError, etc.)
// remain in the call site via mutate(data, { onSuccess, onError }).
export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OpportunityCreate) =>
      api<Opportunity>('/api/opportunities', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      void qc.invalidateQueries({ queryKey: ['report:pipeline'] });
      // P1 #9: keep count badge, dashboard KPIs, forecasts, and goals fresh
      void qc.invalidateQueries({ queryKey: ['opportunities', 'count'] });
      void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['forecasts'] });
      void qc.invalidateQueries({ queryKey: ['goals'] });
    },
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
export function usePatchOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: OpportunityPatch }) => {
      return api<Opportunity>(`/api/opportunities/${id}`, { method: 'PATCH', body: patch });
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['opportunities'] });
      await qc.cancelQueries({ queryKey: ['opportunity', id] });

      const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;

      // Snapshot every active list query so we can roll back on error.
      const listSnapshots: Array<readonly [readonly unknown[], OpportunityPage | undefined]> = [];
      qc.getQueriesData<OpportunityPage>({ queryKey: ['opportunities'] }).forEach(
        ([key, value]) => {
          listSnapshots.push([key, value]);
          // The ['opportunities'] prefix also matches ['opportunities','count']
          // whose data is { count } with no items array — skip non-page entries
          // or this throws and the PATCH never reaches the server.
          if (!value || !Array.isArray(value.items)) return;
          qc.setQueryData<OpportunityPage>(key, {
            ...value,
            items: value.items.map((o) => (o.id === id ? { ...o, ...rest } : o)),
          });
        },
      );

      const detailKey = ['opportunity', id] as const;
      const detailSnap = qc.getQueryData<OpportunityFull>(detailKey);
      if (detailSnap) {
        qc.setQueryData<OpportunityFull>(detailKey, { ...detailSnap, ...rest });
      }
      return { listSnapshots, detailSnap, id };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.listSnapshots.forEach(([key, value]) => qc.setQueryData(key, value));
      if (ctx?.detailSnap && ctx.id) qc.setQueryData(['opportunity', ctx.id], ctx.detailSnap);
      // P3 #44: tell the user their change was reverted so the silent snap-back
      // is not mistaken for a successful save.
      toast.error('Save failed — changes reverted.');
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ['opportunity', vars.id] });
      void qc.invalidateQueries({ queryKey: ['opportunities'] });
      // Pipeline reports aggregate over opportunities; refresh.
      void qc.invalidateQueries({ queryKey: ['report:pipeline'] });
    },
  });
}
