import type { AccountTeamRole } from '@bidstack/shared';

export const ROLE_LABELS: Record<AccountTeamRole, string> = {
  account_lead: 'Account lead',
  delivery_lead: 'Delivery lead',
  pre_sales: 'Pre-sales',
  bid_manager: 'Bid manager',
  executive_sponsor: 'Executive sponsor',
  other: 'Team member',
};

/** The person's total across accounts once this edit is saved. */
export function projectedAllocation(
  currentTotal: number,
  previousPct: number | null,
  nextPct: number | null,
): number {
  return Math.max(0, currentTotal - (previousPct ?? 0)) + (nextPct ?? 0);
}
