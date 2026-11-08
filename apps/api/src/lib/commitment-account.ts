/**
 * A commitment belongs to one company. Linking it to a deal on another
 * company in the same org would show that promise under both accounts.
 * Opportunity-scoped creation already copies the deal's company. Create and
 * reassignment have to refuse the mismatch.
 */
export function commitmentDealMatchesCompany(
  commitmentCompanyId: string,
  dealCompanyId: string | null,
): boolean {
  return dealCompanyId !== null && dealCompanyId === commitmentCompanyId;
}
