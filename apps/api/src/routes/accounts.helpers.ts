// Helpers for the accounts routes (key/top account lists).
//
// WHY a separate module: the curated top-10 path (demo-feedback M5) needs the
// same pipeline/contact aggregation as the key-accounts list. Extracting it
// keeps accounts.ts within the file-size budget and the aggregation testable.

import { prisma } from '@bidstack/db';
import { microsToUnits } from '@bidstack/shared';

import { ACCOUNT_RANK_EXCLUDED_STAGE, rankValueUnits } from './account-rank-value.js';

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
 * Aggregates pipeline-plus-won value, won value, open-deal/opportunity counts
 * and contact counts for a set of companies. Lost bids stay in the opportunity
 * count and stay out of the value. All aggregation happens in Postgres
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
  const [totals, lost, won, open, contacts] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ['companyId'],
      where,
      _sum: { valueMicros: true },
      _count: { _all: true },
    }),
    // Lost bids stay in the opportunity count. They do not stay in the value
    // Strategic Accounts and Account Ranking show.
    prisma.opportunity.groupBy({
      by: ['companyId'],
      where: { ...where, stage: ACCOUNT_RANK_EXCLUDED_STAGE },
      _sum: { valueMicros: true },
    }),
    prisma.opportunity.groupBy({
      by: ['companyId'],
      where: { ...where, stage: 'closed_won' },
      _sum: { valueMicros: true },
    }),
    prisma.opportunity.groupBy({
      by: ['companyId'],
      where: { ...where, stage: { notIn: ['closed_won', 'closed_lost'] } },
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ['companyId'],
      where,
      _count: { id: true },
    }),
  ]);

  const lostMicros = new Map(
    lost.flatMap((row) =>
      row.companyId ? [[row.companyId, row._sum.valueMicros ?? 0n] as const] : [],
    ),
  );
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
    const s = statsFor(row.companyId);
    // WHY microsToUnits (not Number(x) / 1_000_000): the naive form rounds
    // the BigInt→Number conversion before dividing, corrupting totals past
    // ~$9.007B. Postgres already summed exactly via groupBy; don't reintroduce
    // float error converting the result.
    s.totalValue = rankValueUnits(row._sum.valueMicros ?? 0, lostMicros.get(row.companyId) ?? 0);
    s.opportunityCount = row._count._all;
  }
  for (const row of won) {
    if (!row.companyId) continue;
    statsFor(row.companyId).wonValue = microsToUnits(row._sum.valueMicros ?? 0);
  }
  for (const row of open) {
    if (!row.companyId) continue;
    statsFor(row.companyId).openDeals = row._count._all;
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
