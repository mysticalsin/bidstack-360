// Pure derivations for the team workload view — capacity flags and relative
// load. Kept out of the components so the rules are testable and the WHY
// lives in one place.

import type { WorkloadOwner } from '@/hooks/useWorkload';

export type CapacityLevel = 'over' | 'stretched' | 'steady' | 'free';

/**
 * Capacity thresholds — deliberately blunt so a bid lead can recite the rule
 * from memory in a standup:
 *   - "over":      8+ live bids on one desk, or 3+ overdue follow-ups — the
 *                  desk is already dropping things; reassign before adding.
 *   - "stretched": 5+ live bids or any overdue follow-up — fine today,
 *                  fragile if the next RFP lands here.
 *   - "free":      zero live bids — this desk can take the next qualified bid.
 *   - "steady":    everything else.
 * Bid-count driven (not value driven) because proposal effort scales with the
 * number of deadlines being juggled, not with contract size.
 */
export const OVER_CAPACITY_BIDS = 8;
export const OVER_CAPACITY_OVERDUE = 3;
export const STRETCHED_BIDS = 5;
export const STRETCHED_OVERDUE = 1;

export function capacityLevel(o: Pick<WorkloadOwner, 'openBids' | 'overdueTasks'>): CapacityLevel {
  if (o.openBids >= OVER_CAPACITY_BIDS || o.overdueTasks >= OVER_CAPACITY_OVERDUE) return 'over';
  if (o.openBids >= STRETCHED_BIDS || o.overdueTasks >= STRETCHED_OVERDUE) return 'stretched';
  if (o.openBids === 0) return 'free';
  return 'steady';
}

/**
 * Relative load for the in-row bar: this owner's open-bid count as a share of
 * the busiest desk. Bounded [0, 1]; 0 when the whole team is idle.
 */
export function relativeLoad(openBids: number, maxOpenBids: number): number {
  if (maxOpenBids <= 0) return 0;
  return Math.min(1, openBids / maxOpenBids);
}

export interface TeamTotals {
  openBids: number;
  weightedValueMicros: bigint;
  overCapacityDesks: number;
  unassignedBids: number;
}

export function teamTotals(owners: WorkloadOwner[]): TeamTotals {
  const totals: TeamTotals = {
    openBids: 0,
    weightedValueMicros: 0n,
    overCapacityDesks: 0,
    unassignedBids: 0,
  };
  for (const o of owners) {
    totals.openBids += o.openBids;
    totals.weightedValueMicros += BigInt(o.weightedValueMicros);
    if (o.ownerId === null) totals.unassignedBids += o.openBids;
    else if (capacityLevel(o) === 'over') totals.overCapacityDesks += 1;
  }
  return totals;
}
