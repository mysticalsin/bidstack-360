/**
 * Health Score Service — composite account health calculation.
 *
 * WHY weighted composite: a single metric (e.g. NPS alone) is gameable and
 * noisy. Weighting multiple signals gives a balanced picture that correlates
 * with churn/expansion outcomes.
 *
 * Weights (must sum to 1.0):
 *   productUsage        40%  — engagement with the platform
 *   engagement          20%  — contact/activity recency
 *   supportTickets      15%  — inverse of support volume vs. avg
 *   nps                 15%  — latest NPS score from this account
 *   execSponsorStability 10% — whether decision-maker has changed recently
 */
import type { Logger as PinoLogger } from 'pino';

import { prisma, type Prisma } from '@bidstack/db';

// ─── Weight constants ──────────────────────────────────────────────────────

const WEIGHTS = {
  productUsage: 0.4,
  engagement: 0.2,
  supportTickets: 0.15,
  nps: 0.15,
  execSponsorStability: 0.1,
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HealthFactors extends Record<string, unknown> {
  productUsage: number | null;
  engagement: number | null;
  supportTickets: number | null;
  nps: number | null;
  execSponsorStability: number | null;
  contractValue: number | null;
  decisionMakerChange: boolean;
}

export interface ComputeHealthResult {
  accountId: string;
  score: number | null;
  factors: HealthFactors;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | null;
}

/** A first score has no direction. Stable means the new score stayed within 5 points. */
export function trendFromPrevious(
  current: number,
  previous: number | null,
): 'IMPROVING' | 'STABLE' | 'DECLINING' | null {
  if (previous == null) return null;
  const delta = current - previous;
  if (delta >= 5) return 'IMPROVING';
  if (delta <= -5) return 'DECLINING';
  return 'STABLE';
}

/** Weighted score from the factors that were actually measured. Null when none were. */
export function composeHealthScore(factors: {
  productUsage: number | null;
  engagement: number | null;
  supportTickets: number | null;
  nps: number | null;
  execSponsorStability: number | null;
}): number | null {
  const weighted: Array<[number, number]> = [];
  const add = (value: number | null, weight: number) => {
    if (value != null) weighted.push([value, weight]);
  };
  add(factors.productUsage, WEIGHTS.productUsage);
  add(factors.engagement, WEIGHTS.engagement);
  add(factors.supportTickets, WEIGHTS.supportTickets);
  add(factors.nps, WEIGHTS.nps);
  add(factors.execSponsorStability, WEIGHTS.execSponsorStability);
  if (weighted.length === 0) return null;
  const weightSum = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.round(weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / weightSum);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Derive engagement score from recent activity count (30d). */
async function computeEngagementScore(
  orgId: string,
  accountId: string,
): Promise<number | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const count = await prisma.activity.count({
    where: {
      orgId,
      // Activities are linked via company through opportunity — use companyId path
      entityType: 'company',
      entityId: accountId,
      occurredAt: { gte: thirtyDaysAgo },
    },
  });
  if (count === 0) return null;
  return Math.min(100, count * 10);
}

/** Derive support ticket pressure (inverse score). */
async function computeSupportScore(
  orgId: string,
  accountId: string,
): Promise<number | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recent, total] = await Promise.all([
    prisma.serviceCase.count({
      where: { orgId, companyId: accountId, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.serviceCase.count({ where: { orgId, companyId: accountId } }),
  ]);

  if (total === 0) return null;
  const monthlyAvg = total / 6;

  const ratio = recent / monthlyAvg;
  if (ratio >= 3) return 10;
  if (ratio >= 2) return 40;
  if (ratio >= 1.5) return 60;
  if (ratio >= 1) return 75;
  return 95;
}

/** Map latest NPS survey score (-100..100) to 0..100. */
async function computeNpsScore(
  orgId: string,
  accountId: string,
): Promise<number | null> {
  const latest = await prisma.npsSurvey.findFirst({
    where: { orgId, accountId, score: { not: null } },
    orderBy: { respondedAt: 'desc' },
    select: { score: true },
  });
  if (latest?.score == null) return null;
  // Map -100..100 to 0..100
  return Math.round((latest.score + 100) / 2);
}

/** Exec sponsor stability: 100 if no recent role changes, 0 if champion departed recently. */
async function computeExecSponsorStability(
  orgId: string,
  accountId: string,
): Promise<{ score: number | null; decisionMakerChange: boolean }> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentChampionSignal = await prisma.churnSignal.findFirst({
    where: {
      orgId,
      accountId,
      kind: { in: ['CHAMPION_DEPARTED', 'EXEC_SPONSOR_LOST'] },
      detectedAt: { gte: thirtyDaysAgo },
      resolvedAt: null,
    },
  });
  return {
    score: recentChampionSignal ? 0 : null,
    decisionMakerChange: !!recentChampionSignal,
  };
}

/** Derive product usage proxy from activity + login signals (0-100). */
async function computeProductUsageScore(
  orgId: string,
  accountId: string,
): Promise<number | null> {
  // Proxy: count sync events for the org in last 30d as usage signal.
  // Real integration would pull from product analytics (Segment / Mixpanel).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const count = await prisma.activity.count({
    where: {
      orgId,
      entityType: 'company',
      entityId: accountId,
      occurredAt: { gte: sevenDaysAgo },
    },
  });
  if (count === 0) return null;
  return Math.min(100, count * 15);
}

/** Determine trend by comparing to the previous health score. */
async function determineTrend(
  orgId: string,
  accountId: string,
  currentScore: number,
): Promise<'IMPROVING' | 'STABLE' | 'DECLINING' | null> {
  const previous = await prisma.healthScore.findFirst({
    where: { orgId, accountId },
    orderBy: { capturedAt: 'desc' },
    select: { score: true },
  });
  return trendFromPrevious(currentScore, previous?.score ?? null);
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Compute and persist a health score snapshot for a single account. */
export async function computeAndPersistHealthScore(
  orgId: string,
  accountId: string,
  log: PinoLogger,
): Promise<ComputeHealthResult> {
  const [
    productUsage,
    engagement,
    supportTickets,
    nps,
    { score: execSponsorStability, decisionMakerChange },
  ] = await Promise.all([
    computeProductUsageScore(orgId, accountId),
    computeEngagementScore(orgId, accountId),
    computeSupportScore(orgId, accountId),
    computeNpsScore(orgId, accountId),
    computeExecSponsorStability(orgId, accountId),
  ]);

  const score = composeHealthScore({
    productUsage,
    engagement,
    supportTickets,
    nps,
    execSponsorStability,
  });

  const sub = await prisma.subscription.findFirst({
    where: { orgId, accountId, status: 'ACTIVE' },
    select: { arrAmountMicros: true },
    orderBy: { arrAmountMicros: 'desc' },
  });
  const contractValue = sub ? Math.min(100, Number(sub.arrAmountMicros) / 1_000_000_000) : null;

  const factors: HealthFactors = {
    productUsage,
    engagement,
    supportTickets,
    nps,
    execSponsorStability,
    contractValue,
    decisionMakerChange,
  };

  if (score == null) {
    log.info({ orgId, accountId }, 'cs: no measured health inputs; not storing a score');
    return { accountId, score: null, factors, trend: null };
  }

  const trend = await determineTrend(orgId, accountId, score);

  await prisma.healthScore.create({
    data: {
      orgId,
      accountId,
      score,
      factors: factors as unknown as Prisma.InputJsonValue,
      // The column cannot be empty. A first snapshot has no measured direction.
      ...(trend ? { trend } : {}),
    },
  });

  log.info({ orgId, accountId, score, trend }, 'cs: health score computed');

  return { accountId, score, factors, trend };
}

/** Retrieve the most recent health score for an account. */
export async function getLatestHealthScore(
  orgId: string,
  accountId: string,
): Promise<ComputeHealthResult | null> {
  const rows = await prisma.healthScore.findMany({
    where: { orgId, accountId },
    orderBy: { capturedAt: 'desc' },
    take: 2,
  });
  const row = rows[0];
  if (!row) return null;
  return {
    accountId,
    score: row.score,
    factors: row.factors as unknown as HealthFactors,
    // One snapshot has no earlier score to compare. The column default is not a trend.
    trend: rows.length < 2 ? null : (row.trend as 'IMPROVING' | 'STABLE' | 'DECLINING'),
  };
}
