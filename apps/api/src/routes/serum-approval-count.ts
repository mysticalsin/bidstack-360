// The open-approvals card may say the pending count only after both reads
// arrive. A failed catalog probe has not seen approval_gates. A missing table
// substitutes 0 and is still unread. A failed count query is not a zero.
// Error wins, then a missing table is unread, else the count is ready.

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
const UNREAD_DETAIL = 'Approval gates have not been read. The pending count has not arrived.';
const FAILED_DETAIL = 'Could not load approval gates. The pending count has not arrived.';

export function approvalGateCountPhase(input: ApprovalGateCountRead): ApprovalGateCountPhase {
  if (input.availabilityFailed || input.countFailed) return 'failed';
  if (!input.tableAvailable) return 'unread';
  return 'ready';
}

export function approvalGateCountCard(input: {
  phase: ApprovalGateCountPhase;
  count: number;
}): ApprovalGateCountCard {
  if (input.phase === 'failed') {
    return { value: 'Not loaded', detail: FAILED_DETAIL, status: 'error' };
  }
  if (input.phase === 'unread') {
    return { value: 'Not read', detail: UNREAD_DETAIL, status: 'attention' };
  }
  const count = Number.isFinite(input.count) ? input.count : 0;
  return {
    value: String(count),
    detail: SETTLED_DETAIL,
    status: count > 0 ? 'active' : 'ready',
  };
}
