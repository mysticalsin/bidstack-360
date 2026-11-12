import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const DSR_STATES = ['queued', 'running', 'done', 'failed'] as const;
export type DsrState = (typeof DSR_STATES)[number];

export const DSR_EVENTS = ['claim', 'complete', 'fail'] as const;
export type DsrEvent = (typeof DSR_EVENTS)[number];

/** A running claim older than this may be taken by a new run. */
export const DSR_STALE_RUNNING_MS = 15 * 60_000;

export function dsrClaimIsStale(startedAt: Date | null, now: Date): boolean {
  return startedAt !== null && startedAt.getTime() < now.getTime() - DSR_STALE_RUNNING_MS;
}

export function dsrTransition(
  from: DsrState,
  event: DsrEvent,
  guard: { stale: boolean } = { stale: false },
): DsrState | IllegalTransition {
  if (event === 'claim') {
    if (from === 'queued') return 'running';
    if (from === 'running' && guard.stale) return 'running';
    return illegalTransition();
  }
  if (from !== 'running') return illegalTransition();
  return event === 'complete' ? 'done' : 'failed';
}

/** Where-clause for the claim. A running row matches only after the stale window. */
export function dsrClaimWhere(id: string, orgId: string, now: Date) {
  return {
    id,
    orgId,
    OR: [
      { status: 'queued' as const },
      { status: 'running' as const, startedAt: { lt: new Date(now.getTime() - DSR_STALE_RUNNING_MS) } },
    ],
  };
}

/** Where-clause for a write that belongs to the run that claimed `startedAt`. */
export function dsrOwnedWhere(
  id: string,
  orgId: string,
  startedAt: Date,
  status: 'running' | 'done',
) {
  return { id, orgId, startedAt, status };
}

/**
 * An unknown stored value is viewed as failed and is not a known state.
 * Callers do not write that view back: queued would erase again, done would hide an erasure.
 */
export function dsrStateFromStored(value: string): { state: DsrState; known: boolean } {
  if ((DSR_STATES as readonly string[]).includes(value)) {
    return { state: value as DsrState, known: true };
  }
  return { state: 'failed', known: false };
}
