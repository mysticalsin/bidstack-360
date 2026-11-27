import { isPipelineStageIdUuid } from '@/lib/pipeline-stages';

export interface CreateStageOption {
  id: string;
  key: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
}

export interface CreateStagePayload {
  pipelineStageId: string;
  stage: string;
}

export type CreateStageGate =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | {
      status: 'ready';
      payload: CreateStagePayload;
      options: Array<{ value: string; label: string }>;
    };

/**
 * A new bid lands on the first open column unless the user has picked another
 * board stage. A won or lost column is not the default. When every column is
 * closed, the first one is the only place the bid can go.
 */
export function defaultCreateStageId(stages: readonly CreateStageOption[]): string | null {
  const open = stages.find((stage) => !stage.isWon && !stage.isLost);
  return (open ?? stages[0])?.id ?? null;
}

/**
 * The create route files the bid on `pipelineStageId`. A legacy stage key is
 * not that id: the route drops it and uses the first column. This gate only
 * becomes ready once the board stages have loaded and the selection is one of
 * those ids, so the form cannot submit a key the route will ignore.
 */
export function createStageGate(input: {
  isLoading: boolean;
  isPending?: boolean;
  isError: boolean;
  stages: readonly CreateStageOption[];
  selectedId: string | null;
}): CreateStageGate {
  const boardStages = input.stages.filter((stage) => isPipelineStageIdUuid(stage.id));
  if (boardStages.length > 0) {
    const selectedId = boardStages.some((stage) => stage.id === input.selectedId)
      ? input.selectedId
      : defaultCreateStageId(boardStages);
    const stage = boardStages.find((item) => item.id === selectedId);
    if (!stage) return { status: 'empty' };
    return {
      status: 'ready',
      payload: { pipelineStageId: stage.id, stage: stage.key },
      options: boardStages.map((item) => ({ value: item.id, label: item.name })),
    };
  }
  if (input.isLoading || input.isPending) return { status: 'loading' };
  if (input.isError) return { status: 'error' };
  return { status: 'empty' };
}
