/**
 * The API names a company outside the caller's access scope "Restricted
 * company" (apps/api/src/routes/companies.ts, 3fa8bfdd) and keeps it only as a
 * placeholder that holds the hierarchy together. Opening it would 404, so the
 * UI renders it as plain, non-interactive text.
 */
export const RESTRICTED_COMPANY_NAME = 'Restricted company';

export function isRestrictedCompany(node: { name: string } | null | undefined): boolean {
  return node?.name === RESTRICTED_COMPANY_NAME;
}
