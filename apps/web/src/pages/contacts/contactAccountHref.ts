// The customer word on a contact may open an account only when the contact
// is linked to a company. The company id is a UUID. A customer name, a script,
// or a path stays text — the name is never written into the address.

const COMPANY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account cockpit for this contact's company, or null when there is no safe id. */
export function contactAccountHref(companyId: string | null | undefined): string | null {
  if (!companyId || !COMPANY_ID.test(companyId)) return null;
  return `/accounts/${companyId}`;
}
