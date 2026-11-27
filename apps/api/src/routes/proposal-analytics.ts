/** One status, one owner, and one linked bid. `count` is the proposals in that slice. */
export type ProposalAnalyticsSlice = {
  status: string;
  ownerId: string | null;
  opportunityId: string | null;
  count: number;
  valueMicros: bigint;
};

export type ProposalAnalyticsRollup = {
  totalCount: number;
  wonCount: number;
  lostCount: number;
  totalValueMicros: bigint;
  byStatus: Array<{ status: string; count: number }>;
  byOwner: Array<{ ownerId: string | null; count: number; totalValueMicros: bigint }>;
};

/**
 * Counts and linked-bid value for the proposal book.
 *
 * A bid with two proposals is one amount. The value is added once for the
 * book and once for each owner who has a proposal on it. Proposal counts
 * still include every proposal. A slice with no linked bid adds a count
 * and no value.
 */
export function rollupProposalAnalytics(
  slices: readonly ProposalAnalyticsSlice[],
): ProposalAnalyticsRollup {
  const statusCounts = new Map<string, number>();
  const ownerAgg = new Map<string, { ownerId: string | null; count: number; value: bigint }>();
  const seenTotal = new Set<string>();
  const seenOwner = new Map<string, Set<string>>();
  let totalCount = 0;
  let totalValue = 0n;

  for (const slice of slices) {
    totalCount += slice.count;
    statusCounts.set(slice.status, (statusCounts.get(slice.status) ?? 0) + slice.count);
    const key = slice.ownerId ?? '';
    const cur = ownerAgg.get(key) ?? { ownerId: slice.ownerId, count: 0, value: 0n };
    cur.count += slice.count;
    if (slice.opportunityId) {
      if (!seenTotal.has(slice.opportunityId)) {
        seenTotal.add(slice.opportunityId);
        totalValue += slice.valueMicros;
      }
      let seen = seenOwner.get(key);
      if (!seen) {
        seen = new Set();
        seenOwner.set(key, seen);
      }
      if (!seen.has(slice.opportunityId)) {
        seen.add(slice.opportunityId);
        cur.value += slice.valueMicros;
      }
    }
    ownerAgg.set(key, cur);
  }

  return {
    totalCount,
    wonCount: statusCounts.get('won') ?? 0,
    lostCount: statusCounts.get('lost') ?? 0,
    totalValueMicros: totalValue,
    byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    byOwner: [...ownerAgg.values()].map((agg) => ({
      ownerId: agg.ownerId,
      count: agg.count,
      totalValueMicros: agg.value,
    })),
  };
}
