// A customer commitment is a promise the customer made. An internal task is
// a follow-up for us. They share a screen and never a record.

export const COMMITMENT_STATUSES = ['open', 'met', 'missed', 'needs_review'] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const WORK_RECORD_KINDS = ['customer_commitment', 'internal_task'] as const;
export type WorkRecordKind = (typeof WORK_RECORD_KINDS)[number];

export interface CommitmentIntake {
  opportunityId: string | null;
  /** Historical text that does not name a deal. Leave it unlinked. */
  ambiguous: boolean;
}

/**
 * Ambiguous notes stay needs_review and are not attached to an opportunity,
 * even when the caller guessed an opportunity id.
 */
export function intakeCommitment(input: CommitmentIntake): {
  status: 'open' | 'needs_review';
  opportunityId: string | null;
} {
  if (input.ambiguous) return { status: 'needs_review', opportunityId: null };
  return { status: 'open', opportunityId: input.opportunityId };
}

export function partitionAccountWork<T extends { recordKind: WorkRecordKind }>(items: T[]): {
  commitments: T[];
  internalTasks: T[];
} {
  return {
    commitments: items.filter((item) => item.recordKind === 'customer_commitment'),
    internalTasks: items.filter((item) => item.recordKind === 'internal_task'),
  };
}
