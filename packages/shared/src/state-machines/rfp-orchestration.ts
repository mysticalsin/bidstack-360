import { illegalTransition, isIllegalTransition, type IllegalTransition } from './illegal-transition.js';

export const RFP_STATES = [
  'queued',
  'running',
  'paused',
  'approved',
  'rejected',
  'awaiting_approval',
  'completed',
  'failed',
] as const;
export type RfpState = (typeof RFP_STATES)[number];

export const RFP_EVENTS = ['resume_drafting', 'approve_final', 'restart', 'fail'] as const;
export type RfpEvent = (typeof RFP_EVENTS)[number];

const QA_REVIEW = 'qa_review';

function isRfpState(value: string): value is RfpState {
  return (RFP_STATES as readonly string[]).includes(value);
}

/**
 * One transition table for the RFP pipeline.
 *
 * Resume drafting only from the early gate: `awaiting_approval` before
 * `qa_review`. The final gate is the same status with `qa_review` already
 * done, and that moves to `approved`, not back to `running`. Restart may
 * continue `queued`, `running`, or `failed`. It must not rewind `approved`,
 * `completed`, `rejected`, `paused`, or a gate that is waiting. Fail only
 * from `queued` or `running`. An unknown stored value is illegal and is not
 * rewritten.
 */
export function rfpTransition(
  from: string,
  event: RfpEvent,
  completedPhases: readonly string[] = [],
): RfpState | IllegalTransition {
  if (!isRfpState(from)) return illegalTransition();
  const qaDone = completedPhases.includes(QA_REVIEW);
  if (event === 'resume_drafting') {
    return from === 'awaiting_approval' && !qaDone ? 'running' : illegalTransition();
  }
  if (event === 'approve_final') {
    return from === 'awaiting_approval' && qaDone ? 'approved' : illegalTransition();
  }
  if (event === 'restart') {
    return from === 'queued' || from === 'running' || from === 'failed' ? 'running' : illegalTransition();
  }
  return from === 'queued' || from === 'running' ? 'failed' : illegalTransition();
}

/** Statuses a compare-and-set for `event` may match. Phase-qualified events use the phase that makes them legal. */
export function rfpFrom(event: RfpEvent): readonly RfpState[] {
  const phases = event === 'approve_final' ? [QA_REVIEW] : [];
  return RFP_STATES.filter((state) => !isIllegalTransition(rfpTransition(state, event, phases)));
}

/**
 * SQL `IN` list for `event`. Values come only from `RFP_STATES`, so the
 * fragment is not caller input.
 */
export function rfpSqlIn(event: RfpEvent): string {
  return rfpFrom(event)
    .map((state) => `'${state}'`)
    .join(', ');
}
