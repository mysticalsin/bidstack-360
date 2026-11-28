// The cockpit header and the recent-deals card read one company's bids.
// A uuid is that company. A name, a script, or a blank is not sent as companyId:
// the deals API rejects it, and a name would be a different search.
import { z } from 'zod';

const companyIdSchema = z.string().uuid();

/** Company id the deals list will accept, or undefined when it must not be sent. */
export function dealCompanyId(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = companyIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

/** Filter for useOpportunities. Limit stays. companyId is added only for a uuid. */
export function accountDealFilter(
  companyId: string | null | undefined,
  limit: number,
): { companyId?: string; limit: number } {
  const id = dealCompanyId(companyId);
  return id ? { companyId: id, limit } : { limit };
}

/**
 * Rows the header and the recent card may show.
 * A scoped read is already this account, so a different customer label stays.
 */
export function dealsForAccount<T extends { customer?: string | null }>(
  items: readonly T[] | undefined,
  companyId: string | null | undefined,
  companyName: string,
): T[] {
  const rows = items ? [...items] : [];
  if (dealCompanyId(companyId)) return rows;
  const name = companyName.toLowerCase();
  return rows.filter((row) => (row.customer ?? '').toLowerCase() === name);
}

/** Company id on the last cockpit snapshot for this route, if the JSON is readable. */
export function cachedCockpitCompanyId(accountId: string): string | undefined {
  if (!accountId || typeof sessionStorage === 'undefined') return undefined;
  try {
    const stored = sessionStorage.getItem(`bidstack:account-cockpit:${accountId}`);
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as { cockpit?: { company?: { id?: unknown } } };
    const id = parsed.cockpit?.company?.id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}
