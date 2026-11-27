// The pipeline stage list may say it is empty, or that the API will create
// the default pipeline, only after the payload arrives. A pause has
// isLoading false and no items. That read is still unread. A failure with
// no payload is not an empty catalog.

export type PipelineStageListPhase = 'unread' | 'failed' | 'ready';

export interface PipelineStageListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function pipelineStageListPhase(
  snapshot: PipelineStageListSnapshot,
): PipelineStageListPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
