// Status word under a proposal on workspace search. The proposals list names
// the six stored values. Anything else stays as stored so search does not
// invent one.

const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
};

export function searchProposalStatusLabel(status: string | null | undefined): string {
  const value = (status ?? '').trim();
  return PROPOSAL_STATUS_LABELS[value] ?? value;
}
