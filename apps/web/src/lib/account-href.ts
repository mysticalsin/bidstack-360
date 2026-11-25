import { readCompanyId } from '@bidstack/shared';

/** Account cockpit path for a stored company id. A name or blank returns null. */
export function accountCockpitHref(companyId: unknown): string | null {
  const id = readCompanyId(companyId);
  return id ? `/accounts/${id}` : null;
}
