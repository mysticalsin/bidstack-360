/**
 * Expansion Service — surfaces upsell and cross-sell candidates.
 *
 * Logic:
 *   1. Account has a healthy score (>= 70).
 *   2. Account is on a plan tier where seat/feature expansion is plausible.
 *   3. No existing open expansion opportunity of the same kind.
 *
 * WHY conservative scoring: false expansion plays damage CS relationships.
 * Only flag accounts with strong signals, not just "not churning".
 */
import type { Logger as PinoLogger } from 'pino';

import { prisma } from '@bidstack/db';

type ExpansionKind = 'UPSELL' | 'CROSS_SELL' | 'SEAT_EXPANSION' | 'FEATURE_UPSELL' | 'RENEWAL_UPLIFT';

const HEALTH_THRESHOLD = 70;

// ─── Internal helpers ──────────────────────────────────────────────────────

async function hasOpenOpportunity(
  orgId: string,
  accountId: string,
  kind: ExpansionKind,
): Promise<boolean> {
  const existing = await prisma.expansionOpportunity.findFirst({
    where: {
      orgId,
      accountId,
      kind,
      status: { in: ['IDENTIFIED', 'ENGAGED', 'PROPOSED'] },
      deletedAt: null,
    },
  });
  return !!existing;
}

async function isAccountHealthy(orgId: string, accountId: string): Promise<boolean> {
  const latest = await prisma.healthScore.findFirst({
    where: { orgId, accountId },
    orderBy: { capturedAt: 'desc' },
    select: { score: true },
  });
  return (latest?.score ?? 0) >= HEALTH_THRESHOLD;
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Surface expansion candidates for all healthy accounts in an org. */
export async function surfaceExpansionOpportunities(
  orgId: string,
  log: PinoLogger,
): Promise<number> {
  const subs = await prisma.subscription.findMany({
    where: { orgId, status: 'ACTIVE', deletedAt: null },
    select: { accountId: true, planTier: true, arrAmountMicros: true, currency: true },
    distinct: ['accountId'],
  });

  let created = 0;

  for (const sub of subs) {
    const { accountId, planTier, arrAmountMicros, currency } = sub;

    if (!(await isAccountHealthy(orgId, accountId))) continue;

    // Upsell: starter/basic tiers are candidates for plan upgrade.
    if (['starter', 'basic', 'standard'].includes(planTier.toLowerCase())) {
      if (!(await hasOpenOpportunity(orgId, accountId, 'UPSELL'))) {
        await prisma.expansionOpportunity.create({
          data: {
            orgId,
            accountId,
            kind: 'UPSELL',
            valueMicros: BigInt(arrAmountMicros) / 2n, // estimated 50% uplift
            currency,
            status: 'IDENTIFIED',
            notes: `Account on ${planTier} — healthy candidate for plan upgrade`,
          },
        });
        created++;
        log.info({ orgId, accountId, kind: 'UPSELL' }, 'cs: expansion opportunity created');
      }
    }

    // Renewal uplift: all renewals within 120 days for healthy accounts.
    const horizon = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
    const renewalSub = await prisma.subscription.findFirst({
      where: { orgId, accountId, status: 'ACTIVE', renewalDate: { lte: horizon } },
    });
    if (renewalSub && !(await hasOpenOpportunity(orgId, accountId, 'RENEWAL_UPLIFT'))) {
      await prisma.expansionOpportunity.create({
        data: {
          orgId,
          accountId,
          kind: 'RENEWAL_UPLIFT',
          valueMicros: BigInt(arrAmountMicros) / 10n, // estimated 10% uplift
          currency,
          status: 'IDENTIFIED',
          notes: 'Renewal within 120 days — healthy account, propose uplift',
        },
      });
      created++;
      log.info({ orgId, accountId, kind: 'RENEWAL_UPLIFT' }, 'cs: expansion opportunity created');
    }
  }

  log.info({ orgId, created }, 'cs: expansion pass complete');
  return created;
}

/** List open expansion opportunities for an account. */
export async function listExpansionOpportunities(
  orgId: string,
  accountId: string,
) {
  return prisma.expansionOpportunity.findMany({
    where: { orgId, accountId, deletedAt: null },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}
