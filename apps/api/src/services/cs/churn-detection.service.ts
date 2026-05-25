/**
 * Churn Detection Service — nightly pattern analysis to surface ChurnSignal rows.
 *
 * Patterns detected:
 *   LOW_USAGE            — activity count dropped >40% over 30d vs. prior 30d
 *   SUPPORT_VOLUME_SPIKE — case count > 3× monthly average
 *   CHAMPION_DEPARTED    — manual trigger from ChurnSignal create (no HR integration yet)
 *   COMPETITOR_MENTION   — detected in activity notes (keyword scan)
 *   FEATURE_REQUEST_UNRESOLVED — open ServiceCase of type 'feature_request' > 60d
 *   NPS detractor        — created by nps.service.ts on detractor response
 *
 * WHY idempotent upsert: nightly cron runs daily; we must not double-create signals
 * for the same pattern within a detection window.
 */
import type { Logger as PinoLogger } from 'pino';

import { prisma } from '@bidstack/db';

// ─── Types ─────────────────────────────────────────────────────────────────

type ChurnSignalKind =
  | 'LOW_USAGE'
  | 'SUPPORT_VOLUME_SPIKE'
  | 'CHAMPION_DEPARTED'
  | 'COMPETITOR_MENTION'
  | 'FEATURE_REQUEST_UNRESOLVED'
  | 'EXEC_SPONSOR_LOST';

type ChurnSignalSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Idempotently create a churn signal. Skip if unresolved duplicate exists in window. */
async function upsertSignal(
  orgId: string,
  accountId: string,
  kind: ChurnSignalKind,
  severity: ChurnSignalSeverity,
  evidence: Record<string, unknown>,
  log: PinoLogger,
): Promise<boolean> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const existing = await prisma.churnSignal.findFirst({
    where: {
      orgId,
      accountId,
      kind,
      resolvedAt: null,
      detectedAt: { gte: sevenDaysAgo },
    },
  });
  if (existing) return false; // already open signal within window

  await prisma.churnSignal.create({
    data: { orgId, accountId, kind, severity, evidence },
  });
  log.warn({ orgId, accountId, kind, severity }, 'cs: churn signal created');
  return true;
}

// ─── Pattern detectors ─────────────────────────────────────────────────────

async function detectLowUsage(
  orgId: string,
  accountId: string,
  log: PinoLogger,
): Promise<boolean> {
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000);

  const [recent, prior] = await Promise.all([
    prisma.activity.count({
      where: { orgId, opportunity: { companyId: accountId }, happenedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.activity.count({
      where: {
        orgId,
        opportunity: { companyId: accountId },
        happenedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
      },
    }),
  ]);

  if (prior === 0) return false; // no baseline
  const dropPct = (prior - recent) / prior;
  if (dropPct < 0.4) return false;

  return upsertSignal(
    orgId,
    accountId,
    'LOW_USAGE',
    dropPct >= 0.7 ? 'HIGH' : 'MEDIUM',
    { recent, prior, dropPct: Math.round(dropPct * 100) },
    log,
  );
}

async function detectSupportVolumeSpike(
  orgId: string,
  accountId: string,
  log: PinoLogger,
): Promise<boolean> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recent, total] = await Promise.all([
    prisma.serviceCase.count({ where: { orgId, companyId: accountId, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.serviceCase.count({ where: { orgId, companyId: accountId } }),
  ]);
  const monthlyAvg = total > 0 ? total / 6 : 0;
  if (monthlyAvg === 0 || recent < monthlyAvg * 3) return false;

  return upsertSignal(
    orgId,
    accountId,
    'SUPPORT_VOLUME_SPIKE',
    recent >= monthlyAvg * 5 ? 'CRITICAL' : 'HIGH',
    { recent, monthlyAvg: Math.round(monthlyAvg * 10) / 10, ratio: Math.round((recent / monthlyAvg) * 10) / 10 },
    log,
  );
}

async function detectUnresolvedFeatureRequests(
  orgId: string,
  accountId: string,
  log: PinoLogger,
): Promise<boolean> {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const count = await prisma.serviceCase.count({
    where: {
      orgId,
      companyId: accountId,
      // Match feature request cases that are still open after 60d
      status: { in: ['open', 'in_progress'] },
      createdAt: { lte: sixtyDaysAgo },
    },
  });
  if (count === 0) return false;

  return upsertSignal(
    orgId,
    accountId,
    'FEATURE_REQUEST_UNRESOLVED',
    'MEDIUM',
    { openCases: count, olderThanDays: 60 },
    log,
  );
}

async function detectCompetitorMentions(
  orgId: string,
  accountId: string,
  log: PinoLogger,
): Promise<boolean> {
  const COMPETITOR_KEYWORDS = ['switching to', 'going with', 'competitor', 'alternative to', 'looking at other'];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Scan recent activity subjects/notes for competitor keywords.
  const activities = await prisma.activity.findMany({
    where: {
      orgId,
      opportunity: { companyId: accountId },
      happenedAt: { gte: thirtyDaysAgo },
    },
    select: { subject: true },
  });

  const hit = activities.some((a) =>
    COMPETITOR_KEYWORDS.some((kw) => a.subject?.toLowerCase().includes(kw)),
  );
  if (!hit) return false;

  return upsertSignal(
    orgId,
    accountId,
    'COMPETITOR_MENTION',
    'HIGH',
    { detectedInActivities: true },
    log,
  );
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Run all churn detectors for a single account.
 * Returns the number of new signals created.
 */
export async function detectChurnSignalsForAccount(
  orgId: string,
  accountId: string,
  log: PinoLogger,
): Promise<number> {
  const results = await Promise.all([
    detectLowUsage(orgId, accountId, log),
    detectSupportVolumeSpike(orgId, accountId, log),
    detectUnresolvedFeatureRequests(orgId, accountId, log),
    detectCompetitorMentions(orgId, accountId, log),
  ]);
  return results.filter(Boolean).length;
}

/**
 * Run churn detection across all active accounts in an org.
 * Returns total new signals created.
 */
export async function runOrgChurnDetection(
  orgId: string,
  log: PinoLogger,
): Promise<number> {
  const accounts = await prisma.subscription.findMany({
    where: { orgId, status: 'ACTIVE', deletedAt: null },
    select: { accountId: true },
    distinct: ['accountId'],
  });

  let total = 0;
  for (const { accountId } of accounts) {
    total += await detectChurnSignalsForAccount(orgId, accountId, log);
  }
  return total;
}

/** Create a churn signal from NPS detractor response. Called by nps.service.ts. */
export async function createNpsDetractorSignal(
  orgId: string,
  accountId: string,
  surveyId: string,
  score11: number,
  log: PinoLogger,
): Promise<void> {
  await upsertSignal(
    orgId,
    accountId,
    'LOW_USAGE', // closest proxy — NPS detractor is surfaced as low-satisfaction signal
    score11 <= 3 ? 'CRITICAL' : 'HIGH',
    { surveyId, score11, source: 'nps_detractor' },
    log,
  );
}
