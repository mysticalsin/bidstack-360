const COMPANY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account path for a contact that already stores a company id. A name is not an address. */
export function contactAccountHref(companyId: string | null | undefined): string | null {
  if (!companyId || !COMPANY_ID.test(companyId)) return null;
  return `/accounts/${encodeURIComponent(companyId)}`;
}
