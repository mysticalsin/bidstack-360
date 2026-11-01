// Helpers for the accounts routes (key/top account lists).
//
// WHY a separate module: the curated top-10 path (demo-feedback M5) needs the
// same pipeline/contact aggregation as the key-accounts list. Extracting it
// keeps accounts.ts within the file-size budget and the aggregation testable.

import { prisma } from '@bidstack/db';
import { microsToUnits } from '@bidstack/shared';

import { excludeClosedOutcome, wonOutcomeWhere } from './opportunities.helpers.js';

export interface AccountStats {
  totalValue: number;
  totalValueMicros: string;
  wonValue: number;
  wonValueMicros: string;
  openDeals: number;
  opportunityCount: number;
  contactCount: number;
}

const EMPTY_STATS: AccountStats = {
  totalValue: 0,
  totalValueMicros: '0',
  wonValue: 0,
  wonValueMicros: '0',
  openDeals: 0,
  opportunityCount: 0,
  contactCount: 0,
};

/** Digit string for a Postgres bigint sum. A non-integer never becomes a pipeline total. */
function microsDigits(value: bigint | number | null | undefined): string {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : '0';
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value)).toString();
  }
  return '0';
}

/**
 * Aggregates pipeline value, won value, open-deal/opportunity counts and
 * contact counts for a set of companies. All aggregation happens in Postgres
 * via groupBy, so totals are exact regardless of how many opportunities an
 * account has (an in-JS reduce over a take-capped findMany silently
 * undercounts pipeline-heavy accounts).
 */
export async function fetchAccountStats(
  orgId: string,
  companyIds: string[],
): Promise<Map<string, AccountStats>> {
  if (companyIds.length === 0) return new Map();

  const where = { orgId, companyId: { in: companyIds }, deletedAt: null };
  const [totals, won, open, contacts] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ['companyId'],
      where,
      _count: { _all: true },
    }),
    prisma.opportunity.groupBy({
      by: ['companyId'],
      where: { ...where, ...wonOutcomeWhere() },
      _sum: { valueMicros: true },
    }),
    prisma.opportunity.groupBy({
      by: ['companyId'],
      where: { ...where, ...excludeClosedOutcome() },
      _sum: { valueMicros: true },
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ['companyId'],
      where,
      _count: { id: true },
    }),
  ]);

  const stats = new Map<string, AccountStats>();
  const statsFor = (companyId: string): AccountStats => {
    const existing = stats.get(companyId);
    if (existing) return existing;
    const fresh = { ...EMPTY_STATS };
    stats.set(companyId, fresh);
    return fresh;
  };

  for (const row of totals) {
    if (!row.companyId) continue;
    statsFor(row.companyId).opportunityCount = row._count._all;
  }
  for (const row of won) {
    if (!row.companyId) continue;
    const wonMicros = microsDigits(row._sum.valueMicros);
    const wonStats = statsFor(row.companyId);
    wonStats.wonValueMicros = wonMicros;
    wonStats.wonValue = microsToUnits(BigInt(wonMicros));
  }
  for (const row of open) {
    if (!row.companyId) continue;
    const s = statsFor(row.companyId);
    // Pipeline on the account list is the open book. Lost and won stay out.
    // The digit string is the total. The unit number is only for older readers.
    const openMicros = microsDigits(row._sum.valueMicros);
    s.totalValueMicros = openMicros;
    s.totalValue = microsToUnits(BigInt(openMicros));
    s.openDeals = row._count._all;
  }
  for (const c of contacts) {
    if (!c.companyId) continue;
    statsFor(c.companyId).contactCount = c._count.id;
  }

  return stats;
}

export function emptyAccountStats(): AccountStats {
  return { ...EMPTY_STATS };
}
