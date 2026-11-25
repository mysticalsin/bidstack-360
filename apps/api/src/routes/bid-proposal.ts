/**
 * Which proposal a bid workspace opens when one opportunity holds several.
 *
 * The row touched last is the active draft. Callers pass live section counts
 * so a later change can prefer the proposal that actually has sections.
 */

export type BidProposalCandidate = {
  id: string;
  status: string;
  /** Epoch milliseconds. */
  updatedAt: number;
  sectionCount: number;
};

export function pickBidProposal<T extends BidProposalCandidate>(
  candidates: readonly T[],
): T | null {
  if (candidates.length === 0) return null;
  let picked = candidates[0]!;
  for (const candidate of candidates) {
    if (candidate.updatedAt >= picked.updatedAt) picked = candidate;
  }
  return picked;
}
