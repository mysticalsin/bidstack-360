import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { isPipelineStageIdUuid } from '@/lib/pipeline-stages';
import type { Opportunity, OpportunityPage, PipelineStage } from '@bidstack/shared';

interface MoveArgs {
  id: string;
  pipelineStageId: string;
  pipelineStage?: PipelineStage;
}

// Wraps POST /api/opportunities/:id/stage with optimistic UI:
// flips the card immediately; rolls back if the server rejects.
export function useStageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, pipelineStageId }: MoveArgs) =>
      api<{ id: string; pipelineStageId: string | null; stage: string }>(`/api/opportunities/${id}/stage`, {
        method: 'POST',
        body: isPipelineStageIdUuid(pipelineStageId)
          ? { pipelineStageId }
          : { stage: pipelineStageId },
      }),
    onMutate: async ({ id, pipelineStageId, pipelineStage }) => {
      // Snapshot every active opportunities query so we can roll back.
      await qc.cancelQueries({ queryKey: ['opportunities'] });
      const snapshots: Array<readonly [readonly unknown[], OpportunityPage | undefined]> = [];
      qc.getQueriesData<OpportunityPage>({ queryKey: ['opportunities'] }).forEach(
        ([key, value]) => {
          snapshots.push([key, value]);
          if (!value || !Array.isArray(value.items)) return;
          qc.setQueryData<OpportunityPage>(key, {
            ...value,
            items: value.items.map((o) =>
              o.id === id
                ? isPipelineStageIdUuid(pipelineStageId)
                  ? { ...o, pipelineStageId, pipelineStage: pipelineStage ?? o.pipelineStage, stage: pipelineStage?.name ?? o.stage }
                  : { ...o, stage: pipelineStageId, pipelineStageId: null, pipelineStage: null }
                : o,
            ),
          });
        },
      );
      // Single-record cache too (Opportunity Detail page)
      const detailKey = ['opportunity', id] as const;
      const detailSnap = qc.getQueryData<Opportunity>(detailKey);
      if (detailSnap) {
        qc.setQueryData<Opportunity>(
          detailKey,
          isPipelineStageIdUuid(pipelineStageId)
            ? { ...detailSnap, pipelineStageId, pipelineStage: pipelineStage ?? detailSnap.pipelineStage, stage: pipelineStage?.name ?? detailSnap.stage }
            : { ...detailSnap, stage: pipelineStageId, pipelineStageId: null, pipelineStage: null },
        );
      }
      return { snapshots, detailSnap };
    },
    onError: (_err, vars, ctx) => {
      ctx?.snapshots.forEach(([key, value]) => qc.setQueryData(key, value));
      if (ctx?.detailSnap) qc.setQueryData(['opportunity', vars.id], ctx.detailSnap);
    },
    onSuccess: (data, { id }) => {
      qc.setQueriesData<OpportunityPage>({ queryKey: ['opportunities'] }, (cur) => {
        if (!cur || !Array.isArray(cur.items)) return cur;
        return {
          ...cur,
          items: cur.items.map((o) => (o.id === id ? { ...o, ...data } : o)),
        };
      });
      const detailKey = ['opportunity', id] as const;
      const detailSnap = qc.getQueryData<Opportunity>(detailKey);
      if (detailSnap) {
        qc.setQueryData<Opportunity>(detailKey, { ...detailSnap, ...data });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      qc.invalidateQueries({ queryKey: ['report:pipeline'] });
    },
  });
}
