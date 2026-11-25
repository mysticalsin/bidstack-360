import { describe, expect, it } from 'vitest';

import { pickBidProposal, type BidProposalCandidate } from './bid-proposal.js';

const TECHNICAL = '11111111-1111-4111-8111-111111111111';
const SUMMARY = '22222222-2222-4222-8222-222222222222';

function candidate(
  id: string,
  updatedAt: number,
  sectionCount: number,
  status = 'draft',
): BidProposalCandidate {
  return { id, status, updatedAt, sectionCount };
}

describe('pickBidProposal', () => {
  it('keeps the proposal that has sections when a later sibling on the same bid has none', () => {
    // WHY: the demo book puts two proposals on one unpaid bid (a technical
    // proposal in review, and an executive summary in draft). The summary is
    // touched last and has no sections. Opening the bid by updatedAt then
    // says the draft has no sections, and the technical proposal's sections
    // never reach the review pane.
    const picked = pickBidProposal([
      candidate(TECHNICAL, 1_000, 4, 'review'),
      candidate(SUMMARY, 2_000, 0, 'draft'),
    ]);

    expect(picked?.id).toBe(TECHNICAL);
  });

  it('follows the later proposal when both have sections', () => {
    // WHY: a revise copies sections onto a new draft. That draft is the one
    // to open, not the approved copy it replaced.
    const picked = pickBidProposal([
      candidate(TECHNICAL, 1_000, 4, 'approved'),
      candidate(SUMMARY, 2_000, 4, 'draft'),
    ]);

    expect(picked?.id).toBe(SUMMARY);
  });

  it('returns the only proposal even when it has no sections', () => {
    // WHY: a bid with one empty proposal is an empty draft, not a missing
    // bid. The pane can say there are no sections. Hiding the row would 404.
    const only = candidate(SUMMARY, 2_000, 0);
    expect(pickBidProposal([only])).toEqual(only);
  });

  it('returns null when the bid has no proposals', () => {
    expect(pickBidProposal([])).toBeNull();
  });

  it('uses the later of two proposals that both have no sections', () => {
    // WHY: a new blank proposal is the one just created. An older empty
    // sibling must not stay on screen in its place.
    const picked = pickBidProposal([
      candidate(TECHNICAL, 1_000, 0, 'review'),
      candidate(SUMMARY, 2_000, 0, 'draft'),
    ]);

    expect(picked?.id).toBe(SUMMARY);
  });
});
