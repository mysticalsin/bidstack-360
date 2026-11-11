import { illegalTransition, type IllegalTransition } from './illegal-transition.js';

export const PROPOSAL_STATES = ['draft', 'review', 'approved', 'submitted', 'won', 'lost'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export const PROPOSAL_EVENTS = ['approve'] as const;
export type ProposalEvent = (typeof PROPOSAL_EVENTS)[number];

const FROM: Record<ProposalEvent, readonly ProposalState[]> = {
  approve: ['draft', 'review'],
};

const TO: Record<ProposalEvent, ProposalState> = {
  approve: 'approved',
};

/** Statuses an approval compare-and-set may match. Both approval writers use this list. */
export function proposalFrom(event: ProposalEvent): readonly ProposalState[] {
  return FROM[event];
}

export function proposalTransition(
  from: ProposalState,
  event: ProposalEvent,
): ProposalState | IllegalTransition {
  if (!FROM[event].includes(from)) return illegalTransition();
  return TO[event];
}

/** A deleted proposal is not approved. */
export function proposalApprovalAllowed(deletedAt: Date | null): boolean {
  return deletedAt === null;
}

/**
 * An unknown stored value is viewed as lost and is not a known state.
 * Callers do not write that view back. Lost does not approve.
 */
export function proposalStateFromStored(value: string): { state: ProposalState; known: boolean } {
  if ((PROPOSAL_STATES as readonly string[]).includes(value)) {
    return { state: value as ProposalState, known: true };
  }
  return { state: 'lost', known: false };
}
