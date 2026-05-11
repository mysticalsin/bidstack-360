import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Opportunity, OpportunityPage, OpportunityStage } from '@bidstack/shared';

interface MoveArgs {
  id: string;
  stage: OpportunityStage;
}

// Wraps POST /api/opportunities/:id/stage with optimistic UI:
// flips the card immediately; rolls back if the server rejects.
export function useStageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, stage }: MoveArgs) =>
      api<{ id: string; stage: OpportunityStage }>(`/api/opportunities/${id}/stage`, {
        method: 'POST',
        body: { stage },
      }),
    onMutate: async ({ id, stage }) => {
      // Snapshot every active opportunities query so we can roll back.
      await qc.cancelQueries({ queryKey: ['opportunities'] });
      const snapshots: Array<readonly [readonly unknown[], OpportunityPage | undefined]> = [];
      qc.getQueriesData<OpportunityPage>({ queryKey: ['opportunities'] }).forEach(
        ([key, value]) => {
          snapshots.push([key, value]);
          if (!value) return;
          qc.setQueryData<OpportunityPage>(key, {
            ...value,
            items: value.items.map((o) => (o.id === id ? { ...o, stage } : o)),
          });
        },
      );
      // Single-record cache too (Opportunity Detail page)
      const detailKey = ['opportunity', id] as const;
      const detailSnap = qc.getQueryData<Opportunity>(detailKey);
      if (detailSnap) {
        qc.setQueryData<Opportunity>(detailKey, { ...detailSnap, stage });
      }
      return { snapshots, detailSnap };
    },
    onError: (_err, vars, ctx) => {
      ctx?.snapshots.forEach(([key, value]) => qc.setQueryData(key, value));
      if (ctx?.detailSnap) qc.setQueryData(['opportunity', vars.id], ctx.detailSnap);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      qc.invalidateQueries({ queryKey: ['report:pipeline'] });
    },
  });
}
