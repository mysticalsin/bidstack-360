// Access policy version lifecycle. Publishing also moves the previous live
// version published -> superseded in the same transaction; that is its own
// event because it happens to a different row.
//
// A rollback does not move the superseded row. It creates a new row already
// pending (submitted), which then follows approve -> publish.

export const ACCESS_POLICY_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'published',
  'superseded',
] as const;

export type AccessPolicyStatus = (typeof ACCESS_POLICY_STATUSES)[number];

export type AccessPolicyEvent = 'submit' | 'withdraw' | 'approve' | 'reject' | 'publish' | 'supersede';

const TRANSITIONS: Record<AccessPolicyEvent, { from: readonly AccessPolicyStatus[]; to: AccessPolicyStatus }> = {
  submit: { from: ['draft', 'rejected'], to: 'pending' },
  withdraw: { from: ['pending'], to: 'draft' },
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  publish: { from: ['approved'], to: 'published' },
  supersede: { from: ['published'], to: 'superseded' },
};

export type AccessPolicyTransition =
  | { ok: true; to: AccessPolicyStatus }
  | { ok: false; from: string; event: AccessPolicyEvent };

export function accessPolicyTransition(from: string, event: AccessPolicyEvent): AccessPolicyTransition {
  const spec = TRANSITIONS[event];
  if ((spec.from as readonly string[]).includes(from)) return { ok: true, to: spec.to };
  return { ok: false, from, event };
}

export function accessPolicyFromStatuses(event: AccessPolicyEvent): readonly AccessPolicyStatus[] {
  return TRANSITIONS[event].from;
}

export function accessPolicyStatusAfter(from: string, event: AccessPolicyEvent): AccessPolicyStatus {
  const result = accessPolicyTransition(from, event);
  if (!result.ok) throw new Error(`illegal access policy transition: ${from} -${event}->`);
  return result.to;
}
