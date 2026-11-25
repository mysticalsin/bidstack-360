// The account cockpit "Open pipeline" control must open THIS company's bids.
// A name search is a different list: shared words match other customers, and
// a customer string that is not the account name misses the bids on screen.
// Name-keyed cockpits have no company uuid. The list filter rejects a
// non-uuid companyId, so those keep the account-name search.

const COMPANY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function accountPipelineHref(input: {
  companyId?: string | null;
  accountName?: string | null;
}): string {
  const companyId = opportunityCompanyIdParam(input.companyId ?? null);
  if (companyId) return `/opportunities?companyId=${encodeURIComponent(companyId)}`;
  const name = input.accountName?.trim() ?? '';
  if (name) return `/opportunities?search=${encodeURIComponent(name)}`;
  return '/opportunities';
}

/** A company id from the list URL. Anything else is not sent to the API. */
export function opportunityCompanyIdParam(raw: string | null): string | undefined {
  const id = raw?.trim() ?? '';
  return COMPANY_ID_RE.test(id) ? id : undefined;
}
