import { createHash, randomBytes } from 'node:crypto';

import { prisma, type Prisma } from '@bidstack/db';
import type pino from 'pino';

type Logger = Pick<pino.Logger, 'debug' | 'info' | 'warn'>;

const DAY_MS = 86_400_000;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

/**
 * A health number only when a case count or an NPS response exists.
 * An empty queue plus a missing survey is not a score of 70.
 */
export function healthScoreFromSignals(input: {
  openCases: number;
  criticalCases: number;
  npsScore: number | null;
}): number | null {
  const hasCases = input.openCases > 0 || input.criticalCases > 0;
  const hasNps = input.npsScore != null;
  if (!hasCases && !hasNps) return null;
  const parts: number[] = [];
  if (hasCases) parts.push(clampScore(100 - input.openCases * 4 - input.criticalCases * 8));
  if (input.npsScore != null) parts.push(clampScore((input.npsScore + 100) / 2));
  return clampScore(parts.reduce((sum, part) => sum + part, 0) / parts.length);
}

/** A first score has no direction. Stable means the new score stayed within 5 points. */
export function healthTrend(
  current: number,
  previous: number | null,
): 'IMPROVING' | 'STABLE' | 'DECLINING' | null {
  if (previous == null) return null;
  const delta = current - previous;
  if (delta >= 5) return 'IMPROVING';
  if (delta <= -5) return 'DECLINING';
  return 'STABLE';
}

export async function computeAndPersistHealthScore(
  orgId: string,
  accountId: string,
  log: Logger,
): Promise<number | null> {
  const [subscriptionCount, openCases, criticalCases, latestNps, previousScore] = await Promise.all([
    prisma.subscription.count({
      where: { orgId, accountId, status: 'ACTIVE', deletedAt: null },
    }),
    prisma.serviceCase.count({
      where: {
        orgId,
        companyId: accountId,
        deletedAt: null,
        status: { in: ['new', 'open', 'waiting_customer', 'waiting_internal', 'escalated'] },
      },
    }),
    prisma.serviceCase.count({
      where: {
        orgId,
        companyId: accountId,
        deletedAt: null,
        priority: { in: ['high', 'critical'] },
        status: { in: ['new', 'open', 'waiting_customer', 'waiting_internal', 'escalated'] },
      },
    }),
    prisma.npsSurvey.findFirst({
      where: { orgId, accountId, deletedAt: null, score: { not: null } },
      orderBy: { respondedAt: 'desc' },
      select: { score: true },
    }),
    prisma.healthScore.findFirst({
      where: { orgId, accountId },
      orderBy: { capturedAt: 'desc' },
      select: { score: true },
    }),
  ]);

  const npsScore = latestNps?.score ?? null;
  const supportPenalty = openCases * 4 + criticalCases * 8;
  const score = healthScoreFromSignals({ openCases, criticalCases, npsScore });
  if (score == null) {
    log.debug({ orgId, accountId }, 'cs.health: no measured inputs; not storing a score');
    return null;
  }
  const trend = healthTrend(score, previousScore?.score ?? null);

  await prisma.healthScore.create({
    data: {
      orgId,
      accountId,
      score,
      ...(trend ? { trend } : {}),
      factors: jsonObject({
        subscriptionCount,
        openCases,
        criticalCases,
        npsScore,
        supportPenalty,
      }),
    },
  });

  log.debug({ orgId, accountId, score, trend }, 'cs.health: persisted score');
  return score;
}

export async function processRenewalOpportunities(orgId: string, log: Logger): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * DAY_MS);
  const subscriptions = await prisma.subscription.findMany({
    where: {
      orgId,
      status: 'ACTIVE',
      deletedAt: null,
      renewalDate: { gte: now, lte: horizon },
    },
    select: { id: true, renewalDate: true, ownerId: true },
  });

  let created = 0;
  for (const subscription of subscriptions) {
    const daysOut = Math.max(
      0,
      Math.ceil((subscription.renewalDate.getTime() - now.getTime()) / DAY_MS),
    );
    const trigger = daysOut > 60 ? 90 : daysOut > 30 ? 60 : 30;
    const existing = await prisma.renewalOpportunity.findFirst({
      where: {
        orgId,
        subscriptionId: subscription.id,
        daysOutTrigger: trigger,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.renewalOpportunity.create({
      data: {
        orgId,
        subscriptionId: subscription.id,
        daysOutTrigger: trigger,
        ownerId: subscription.ownerId,
        status: 'UPCOMING',
      },
    });
    created++;
  }

  log.info({ orgId, created }, 'cs.renewal: processed renewal opportunities');
  return created;
}

export async function sendQuarterlyNpsSurveys(orgId: string, log: Logger): Promise<number> {
  const since = new Date(Date.now() - 90 * DAY_MS);
  const subscriptions = await prisma.subscription.findMany({
    where: { orgId, status: 'ACTIVE', deletedAt: null },
    select: { accountId: true },
    distinct: ['accountId'],
  });

  let created = 0;
  for (const { accountId } of subscriptions) {
    const recent = await prisma.npsSurvey.findFirst({
      where: { orgId, accountId, deletedAt: null, sentAt: { gte: since } },
      select: { id: true },
    });
    if (recent) continue;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await prisma.npsSurvey.create({
      data: {
        orgId,
        accountId,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
      },
    });
    created++;
  }

  log.info({ orgId, created }, 'cs.nps: queued survey records');
  return created;
}

export async function runOrgChurnDetection(orgId: string, log: Logger): Promise<number> {
  // A stored health score is not product usage. LOW_USAGE would name the wrong
  // cause, and the enum has no health-drop kind without a migration.
  log.info({ orgId, created: 0 }, 'cs.churn: health scores are not stored as usage signals');
  return 0;
}

export async function surfaceExpansionOpportunities(orgId: string, log: Logger): Promise<number> {
  const healthyAccounts = await prisma.healthScore.findMany({
    where: { orgId, score: { gte: 80 } },
    distinct: ['accountId'],
    orderBy: [{ accountId: 'asc' }, { capturedAt: 'desc' }],
    select: { accountId: true, score: true },
  });

  let created = 0;
  for (const account of healthyAccounts) {
    const existing = await prisma.expansionOpportunity.findFirst({
      where: {
        orgId,
        accountId: account.accountId,
        status: { in: ['IDENTIFIED', 'ENGAGED', 'PROPOSED'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.expansionOpportunity.create({
      data: {
        orgId,
        accountId: account.accountId,
        kind: 'CROSS_SELL',
        currency: 'XXX',
        notes: `Auto-surfaced from account health score ${account.score}. Amount is unset.`,
      },
    });
    created++;
  }

  log.info({ orgId, created }, 'cs.expansion: opportunities surfaced');
  return created;
}
