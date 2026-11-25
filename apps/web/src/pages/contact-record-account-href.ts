// The company on a contact opens its account only through the stored company
// id. The customer name is not an address: a search on it can match a
// different company. A script, a path, or a blank stays text.

const COMPANY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account path for a contact that already stores a company id, or null. */
export function contactRecordAccountHref(companyId: string | null | undefined): string | null {
  if (!companyId || !COMPANY_ID.test(companyId)) return null;
  return `/accounts/${encodeURIComponent(companyId)}`;
}
