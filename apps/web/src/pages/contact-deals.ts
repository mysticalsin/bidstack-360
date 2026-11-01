/** Deals for a contact. A shared customer name is not a company link. */
export function dealsForContact<T extends { companyId?: string | null }>(
  deals: readonly T[],
  companyId: string | null,
): T[] {
  if (!companyId) return [];
  return deals.filter((deal) => deal.companyId === companyId);
}

/** Opportunity caption. A continuing page is not every deal for the company. */
export function contactOpportunityCaption(
  count: number,
  linked: boolean,
  pageContinues: boolean,
): string {
  if (!linked) return 'This contact is not linked to a company.';
  if (pageContinues) {
    return count === 1
      ? '1 related in the latest 100 bids'
      : `${count} related in the latest 100 bids`;
  }
  return count === 1 ? '1 related' : `${count} related`;
}
