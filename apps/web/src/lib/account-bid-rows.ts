// The account pipeline chart and its drill read one company's bids.
// A uuid is that company. A name, a script, or a blank is not sent as companyId:
// the deals API rejects it, and a name would be a different search.
import { z } from 'zod';

const companyIdSchema = z.string().uuid();

/** Company id the deals list will accept, or undefined when it must not be sent. */
export function bidCompanyId(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = companyIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

/** Read used by the account pipeline chart. The portfolio page is the fallback. */
export function accountBidQuery(companyId?: string | null): {
  queryKey: readonly ['opportunity-rows:viz'] | readonly ['opportunity-rows:viz', string];
  path: string;
} {
  const id = bidCompanyId(companyId);
  const params = new URLSearchParams({ limit: '100' });
  if (id) params.set('companyId', id);
  return {
    queryKey: id ? ['opportunity-rows:viz', id] : ['opportunity-rows:viz'],
    path: `/api/opportunities?${params.toString()}`,
  };
}

/** Rows the chart may draw. A scoped read is already this account. */
export function rowsForAccountBids<T extends { customer?: string | null }>(
  items: readonly T[] | undefined,
  companyId: string | null | undefined,
  companyName: string,
): T[] {
  const rows = [...(items ?? [])];
  if (bidCompanyId(companyId)) return rows;
  const name = companyName.toLowerCase();
  return rows.filter((row) => (row.customer ?? '').toLowerCase() === name);
}
