// The open-approvals card may say the pending count only after both reads
// arrive. A failed catalog probe has not seen approval_gates. A missing table
// substitutes 0 and is still unread. A failed count query is not a zero.

import type { SerumSignalStatus } from '@bidstack/shared';

export type ApprovalGateCountPhase = 'unread' | 'failed' | 'ready';

export interface ApprovalGateCountRead {
  availabilityFailed: boolean;
  tableAvailable: boolean;
  countFailed: boolean;
}

export interface ApprovalGateCountCard {
  value: string;
  detail: string;
  status: SerumSignalStatus;
}

const SETTLED_DETAIL = 'Human review gates awaiting a decision.';

export function approvalGateCountPhase(input: ApprovalGateCountRead): ApprovalGateCountPhase {
  // Current lie, kept so the red test can fail before the status change.
  // A missing table and a failed read both become a settled zero.
  if (input.availabilityFailed || input.countFailed || !input.tableAvailable) {
    return 'ready';
  }
  return 'ready';
}

export function approvalGateCountCard(input: {
  phase: ApprovalGateCountPhase;
  count: number;
}): ApprovalGateCountCard {
  // The phase is ignored. Unread and failed still print the substituted zero.
  void input.phase;
  const count = Number.isFinite(input.count) ? input.count : 0;
  return {
    value: String(count),
    detail: SETTLED_DETAIL,
    status: count > 0 ? 'active' : 'ready',
  };
}
