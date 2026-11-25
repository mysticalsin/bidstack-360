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
 * Adds each slice's value. Two proposals on one bid are two slices, so
 * that bid is booked twice. Counts still include every proposal.
 */
export function rollupProposalAnalytics(
  slices: readonly ProposalAnalyticsSlice[],
): ProposalAnalyticsRollup {
  const statusCounts = new Map<string, number>();
  const ownerAgg = new Map<string, { ownerId: string | null; count: number; value: bigint }>();
  let totalCount = 0;
  let totalValue = 0n;

  for (const slice of slices) {
    totalCount += slice.count;
    totalValue += slice.valueMicros;
    statusCounts.set(slice.status, (statusCounts.get(slice.status) ?? 0) + slice.count);
    const key = slice.ownerId ?? '';
    const cur = ownerAgg.get(key) ?? { ownerId: slice.ownerId, count: 0, value: 0n };
    cur.count += slice.count;
    cur.value += slice.valueMicros;
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
