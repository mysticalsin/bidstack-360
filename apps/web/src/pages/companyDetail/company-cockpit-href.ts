/**
 * Account cockpit for a company record. Both routes use the company id.
 * Encoding keeps a slash in a non-uuid id from leaving `/accounts/:id`.
 */
export function companyCockpitHref(companyId: string): string {
  return `/accounts/${encodeURIComponent(companyId)}`;
}
