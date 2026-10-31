import { describe, expect, it } from 'vitest';

import { CustomerCommitmentRow, InternalTaskRow } from '../schemas/people-map.js';
import { intakeCommitment, partitionAccountWork } from './commitment.js';

const COMMITMENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TASK_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

describe('customer commitments are not internal tasks', () => {
  const commitment = {
    recordKind: 'customer_commitment' as const,
    id: COMMITMENT_ID,
    promise: 'Customer will sign the statement of work',
    dueDate: '2026-11-15',
    status: 'open' as const,
    ownerContactId: null,
    ownerName: null,
    opportunityId: null,
    sourceNote: null,
  };
  const task = {
    recordKind: 'internal_task' as const,
    id: TASK_ID,
    title: 'Send the deck',
    dueDate: '2026-11-01',
    status: 'open' as const,
    assigneeEmail: 'kam@example.com',
  };

  it('rejects an internal follow-up as a customer promise', () => {
    expect(CustomerCommitmentRow.safeParse(task).success).toBe(false);
    expect(InternalTaskRow.safeParse(commitment).success).toBe(false);
    expect(CustomerCommitmentRow.safeParse(commitment).success).toBe(true);
  });

  it('keeps the two lists apart when they are shown together', () => {
    const split = partitionAccountWork([task, commitment]);
    expect(split.commitments.map((row) => row.recordKind)).toEqual(['customer_commitment']);
    expect(split.internalTasks.map((row) => row.id)).toEqual([TASK_ID]);
    expect(split.commitments.some((row) => 'title' in row && row.title === 'Send the deck')).toBe(
      false,
    );
  });

  it('does not attach ambiguous historical text to a deal', () => {
    const stored = intakeCommitment({
      opportunityId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      ambiguous: true,
    });
    expect(stored).toEqual({ status: 'needs_review', opportunityId: null });
  });
});
