// A public bid shows on an account only through a company id or an
// opportunity already known to belong to that account. The buyer string
// is a label. A null company id does not attach the row, and a row linked
// to company A does not appear on company B.

export interface TimelineBidLink {
  id: string;
  buyer?: string | null;
  companyId?: string | null;
  opportunityId?: string | null;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Company id or known opportunity. Buyer text is ignored. */
export function bidLinksToAccount(
  bid: TimelineBidLink,
  accountId: string,
  accountOpportunityIds: ReadonlySet<string>,
): boolean {
  const account = trimmed(accountId).toLowerCase();
  if (!account) return false;
  const companyId = trimmed(bid.companyId).toLowerCase();
  if (companyId && companyId === account) return true;
  const opportunityId = trimmed(bid.opportunityId);
  return opportunityId.length > 0 && accountOpportunityIds.has(opportunityId);
}

export function linkedTimelineBids<T extends TimelineBidLink>(
  accountId: string,
  bids: readonly T[],
  accountOpportunityIds: ReadonlySet<string>,
): T[] {
  return bids.filter((bid) => bidLinksToAccount(bid, accountId, accountOpportunityIds));
}
