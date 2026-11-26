// The stage-pipeline mini may say the list is empty only after the payload
// arrives. A pause has no report. That read is still unread. A failure with
// no payload is not an empty list. A report that is already in hand stays,
// including when a later refresh errors.

export type PipelineByStageMiniPhase = 'unread' | 'failed' | 'empty' | 'ready';

export interface PipelineByStageMiniSnapshot {
  data?: { byStage?: unknown[] } | null;
  isError?: boolean;
  status?: string;
  /** Paused and fetching are both unread. The phase does not treat either as empty. */
  fetchStatus?: string;
}

export function pipelineByStageMiniPhase(
  snapshot: PipelineByStageMiniSnapshot,
): PipelineByStageMiniPhase {
  if (snapshot.data != null) {
    const stages = snapshot.data.byStage;
    if (!Array.isArray(stages) || stages.length === 0) return 'empty';
    return 'ready';
  }
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  // fetchStatus "paused" and "fetching" both have no payload yet.
  void snapshot.fetchStatus;
  return 'unread';
}
