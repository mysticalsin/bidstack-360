/**
 * Which proposal a bid workspace opens when one opportunity holds several.
 *
 * A proposal with live sections beats one with none, even when the empty
 * row was touched later. Among proposals in the same class, the latest
 * update is the active draft (a revise copies sections onto a new row).
 */

export type BidProposalCandidate = {
  id: string;
  status: string;
  /** Epoch milliseconds. */
  updatedAt: number;
  /** Non-deleted sections. Zero means the row has no draft to review. */
  sectionCount: number;
};

export function pickBidProposal<T extends BidProposalCandidate>(
  candidates: readonly T[],
): T | null {
  if (candidates.length === 0) return null;
  let picked = candidates[0]!;
  for (const candidate of candidates) {
    const pickedHas = picked.sectionCount > 0;
    const candidateHas = candidate.sectionCount > 0;
    if (candidateHas !== pickedHas) {
      if (candidateHas) picked = candidate;
      continue;
    }
    if (candidate.updatedAt >= picked.updatedAt) picked = candidate;
  }
  return picked;
}
