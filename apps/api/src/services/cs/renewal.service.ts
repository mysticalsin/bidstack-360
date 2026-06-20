/**
 * Renewal Service — auto-creates RenewalOpportunity rows at 90/60/30 day marks.
 *
 * WHY 90/60/30: industry standard CS motion. 90d = negotiate, 60d = escalate,
 * 30d = executive close. Each trigger fires once per subscription per threshold.
 */
import type { Logger as PinoLogger } from 'pino';

import { prisma } from '@bidstack/db';

// Days before renewal to create opportunity rows.
const TRIGGER_DAYS = [90, 60, 30] as const;

// ─── Internal helpers ──────────────────────────────────────────────────────

function daysUntil(target: Date): number {
  return Math.floor((target.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * For each active subscription approaching renewal, create RenewalOpportunity
 * rows for the applicable day thresholds (idempotent — deduped by subscriptionId + daysOut).
 */
export async function processRenewalOpportunities(
  orgId: string,
  log: PinoLogger,
): Promise<number> {
  // Find subscriptions renewing within 91 days that are still ACTIVE.
  const horizon = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);
  const subs = await prisma.subscription.findMany({
    where: { orgId, status: 'ACTIVE', renewalDate: { lte: horizon } },
    select: { id: true, renewalDate: true, ownerId: true },
  });

  let created = 0;

  for (const sub of subs) {
    const daysOut = daysUntil(sub.renewalDate);

    for (const threshold of TRIGGER_DAYS) {
      if (daysOut > threshold) continue; // not yet within window
      if (daysOut < threshold - 5) continue; // already past by >5 days — next threshold

      // Idempotency under concurrency: the find-then-create is a TOCTOU race
      // (no unique on subscriptionId+daysOutTrigger), so two overlapping runs
      // could both insert. Serialize per (subscription, threshold) with a pg
      // advisory xact lock, then re-check inside the same tx before creating
      // ($executeRaw per MISTAKES.md 2026-06-07 — the lock result is unused).
      const didCreate = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`renewal:${sub.id}:${threshold}`}))`;
        const existing = await tx.renewalOpportunity.findFirst({
          where: {
            subscriptionId: sub.id,
            daysOutTrigger: threshold,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) return false;

        await tx.renewalOpportunity.create({
          data: {
            orgId,
            subscriptionId: sub.id,
            status: 'UPCOMING',
            daysOutTrigger: threshold,
            ownerId: sub.ownerId,
          },
        });
        return true;
      });
      if (!didCreate) continue;
      created++;
      log.info({ orgId, subscriptionId: sub.id, threshold }, 'cs: renewal opportunity created');
    }
  }

  return created;
}

/** List renewal opportunities for an account (all subscriptions). */
export async function listRenewalOpportunities(
  orgId: string,
  accountId: string,
) {
  const subs = await prisma.subscription.findMany({
    where: { orgId, accountId, deletedAt: null },
    select: { id: true },
  });
  const subIds = subs.map((s) => s.id);

  return prisma.renewalOpportunity.findMany({
    where: { orgId, subscriptionId: { in: subIds }, deletedAt: null },
    include: { subscription: { select: { planTier: true, arrAmountMicros: true, renewalDate: true } } },
    orderBy: { createdAt: 'desc' },
  });
}
