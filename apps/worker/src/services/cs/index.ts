import { createHash, randomBytes } from 'node:crypto';

import { prisma, Prisma } from '@bidstack/db';
import type pino from 'pino';

type Logger = Pick<pino.Logger, 'debug' | 'info' | 'warn'>;

const DAY_MS = 86_400_000;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

export async function computeAndPersistHealthScore(
  orgId: string,
  accountId: string,
  log: Logger,
): Promise<number> {
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

  const npsScore = latestNps?.score ?? 0;
  const supportPenalty = openCases * 4 + criticalCases * 8;
  const subscriptionSignal = subscriptionCount > 0 ? 10 : -15;
  const score = clampScore(70 + subscriptionSignal + npsScore * 0.15 - supportPenalty);
  const trend =
    previousScore && score > previousScore.score + 3
      ? 'IMPROVING'
      : previousScore && score < previousScore.score - 3
        ? 'DECLINING'
        : 'STABLE';

  await prisma.healthScore.create({
    data: {
      orgId,
      accountId,
      score,
      trend,
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
  const latestScores = await prisma.healthScore.findMany({
    where: { orgId },
    distinct: ['accountId'],
    orderBy: [{ accountId: 'asc' }, { capturedAt: 'desc' }],
    select: { accountId: true, score: true },
  });

  let created = 0;
  for (const score of latestScores) {
    if (score.score >= 50) continue;

    const existing = await prisma.churnSignal.findFirst({
      where: {
        orgId,
        accountId: score.accountId,
        kind: 'LOW_USAGE',
        resolvedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.churnSignal.create({
      data: {
        orgId,
        accountId: score.accountId,
        kind: 'LOW_USAGE',
        severity: score.score < 30 ? 'CRITICAL' : 'HIGH',
        evidence: jsonObject({ healthScore: score.score, threshold: 50 }),
      },
    });
    created++;
  }

  log.info({ orgId, created }, 'cs.churn: signals detected');
  return created;
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
        notes: `Auto-surfaced from account health score ${account.score}.`,
      },
    });
    created++;
  }

  log.info({ orgId, created }, 'cs.expansion: opportunities surfaced');
  return created;
}
