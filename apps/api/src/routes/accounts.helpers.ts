// Helpers for the accounts routes (key/top account lists).
//
// WHY a separate module: the curated top-10 path (demo-feedback M5) needs the
// same pipeline/contact aggregation as the key-accounts list. Extracting it
// keeps accounts.ts within the file-size budget and the aggregation testable.

import { prisma } from '@bidstack/db';

export interface AccountStats {
  totalValue: number;
  wonValue: number;
  openDeals: number;
  opportunityCount: number;
  contactCount: number;
}

const EMPTY_STATS: AccountStats = {
  totalValue: 0,
  wonValue: 0,
  openDeals: 0,
  opportunityCount: 0,
  contactCount: 0,
};

/**
 * Aggregates pipeline value, won value, open-deal/opportunity counts and
 * contact counts for a bounded set of companies (callers pass at most a
 * page of ids, so the take:1000 opportunity ceiling is safe here).
 */
export async function fetchAccountStats(
  orgId: string,
  companyIds: string[],
): Promise<Map<string, AccountStats>> {
  if (companyIds.length === 0) return new Map();

  const [opps, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId, companyId: { in: companyIds }, deletedAt: null },
      select: { companyId: true, valueMicros: true, stage: true },
      take: 1000,
    }),
    prisma.contact.groupBy({
      by: ['companyId'],
      where: { orgId, companyId: { in: companyIds }, deletedAt: null },
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

  for (const o of opps) {
    if (!o.companyId) continue;
    const s = statsFor(o.companyId);
    const value = Number(o.valueMicros) / 1_000_000;
    s.totalValue += value;
    s.opportunityCount += 1;
    if (o.stage === 'closed_won') {
      s.wonValue += value;
    } else if (o.stage !== 'closed_lost') {
      s.openDeals += 1;
    }
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
