import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { isPipelineStageIdUuid } from '@/lib/pipeline-stages';
import type { Opportunity, OpportunityPage, PipelineStage } from '@bidstack/shared';

interface MoveArgs {
  id: string;
  pipelineStageId: string;
  pipelineStage?: PipelineStage;
}

type StageMoveResponse = {
  id: string;
  pipelineStageId: string | null;
  stage: string;
  pipelineStage?: PipelineStage | null;
};

function applyStageMove<T extends Opportunity>(
  opportunity: T,
  move: {
    pipelineStageId: string | null;
    stage?: string | null;
    pipelineStage?: PipelineStage | null;
  },
): T {
  if (move.pipelineStageId && isPipelineStageIdUuid(move.pipelineStageId)) {
    const nextPipelineStage =
      move.pipelineStage !== undefined
        ? move.pipelineStage
        : opportunity.pipelineStage?.id === move.pipelineStageId
          ? opportunity.pipelineStage
          : null;

    return {
      ...opportunity,
      pipelineStageId: move.pipelineStageId,
      pipelineStage: nextPipelineStage,
      stage: move.stage ?? nextPipelineStage?.name ?? move.pipelineStageId,
    };
  }

  return {
    ...opportunity,
    pipelineStageId: null,
    pipelineStage: null,
    stage: move.stage ?? move.pipelineStageId ?? opportunity.stage,
  };
}

// Wraps POST /api/opportunities/:id/stage with optimistic UI:
// flips the card immediately; rolls back if the server rejects.
export function useStageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, pipelineStageId }: MoveArgs) =>
      api<StageMoveResponse>(`/api/opportunities/${id}/stage`, {
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
                ? applyStageMove(o, {
                    pipelineStageId,
                    stage: pipelineStage?.name ?? pipelineStageId,
                    pipelineStage,
                  })
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
          applyStageMove(detailSnap, {
            pipelineStageId,
            stage: pipelineStage?.name ?? pipelineStageId,
            pipelineStage,
          }),
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
          items: cur.items.map((o) => (o.id === id ? applyStageMove(o, data) : o)),
        };
      });
      const detailKey = ['opportunity', id] as const;
      const detailSnap = qc.getQueryData<Opportunity>(detailKey);
      if (detailSnap) {
        qc.setQueryData<Opportunity>(detailKey, applyStageMove(detailSnap, data));
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      qc.invalidateQueries({ queryKey: ['report:pipeline'] });
    },
  });
}
