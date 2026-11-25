export interface ColumnProbabilityBid {
  value: number;
  probability: number;
}

/**
 * Win probability of the bids loaded in one deal-board column.
 * A funnel ratio (later cards over this column plus those cards) printed
 * 50% on Negotiation while IKEA is 75, and 75% on Proposal Sent while
 * Sanofi is 40. Several bids in one column use a value-weighted mean so a
 * small bid does not count the same as a large one. A column whose bids
 * have no amount uses a plain mean. An empty column has no probability.
 * A continued page is not the whole column, so it does not state one.
 */
export function columnWinProbability(
  bids: readonly ColumnProbabilityBid[],
  pageContinues: boolean,
): number | null {
  if (pageContinues || bids.length === 0) return null;
  let weight = 0;
  let weighted = 0;
  let plain = 0;
  for (const bid of bids) {
    weight += bid.value;
    weighted += bid.value * bid.probability;
    plain += bid.probability;
  }
  if (weight <= 0) return Math.round(plain / bids.length);
  return Math.round(weighted / weight);
}
