// Seeds the demo records behind the bid charts: win/loss outcomes for the
// closed history, a bid score for OP-2048 and a spread of activities. Upserts
// on stable keys, so re-seeding never duplicates. Dev and demo databases only.
import { computeBidComposite } from '@bidstack/shared';

import { type Prisma, type PrismaClient } from '../generated/client/index.js';

import { DEMO_NOTE, demoActivities, demoBidScore, demoWinLoss, fixtureClosedDeals } from './seed-data.bid-charts.js';

const DAY_MS = 86_400_000;

export interface BidChartDemoCounts {
  outcomes: number;
  bidScore: number | null;
  activities: number;
}

export async function seedBidChartDemo(prisma: PrismaClient, orgId: string, seedUserId: string): Promise<BidChartDemoCounts> {
  const codes = [...new Set([...demoWinLoss.map((r) => r.code), demoBidScore.oppCode, ...demoActivities.map((a) => a.oppCode)])];
  const opps = await prisma.opportunity.findMany({
    where: { orgId, code: { in: codes } },
    select: { id: true, code: true },
  });
  const idByCode = new Map(opps.map((o) => [o.code, o.id]));

  let outcomes = 0;
  for (const r of demoWinLoss) {
    const opportunityId = idByCode.get(r.code);
    const deal = fixtureClosedDeals.find((d) => d.code === r.code);
    if (!opportunityId || !deal) continue;
    const decidedAt = new Date(Date.now() - deal.monthsAgo * 30 * DAY_MS);
    const data = { outcome: r.outcome, reason: r.reason, competitor: r.competitor, note: DEMO_NOTE, createdAt: decidedAt };
    await prisma.winLossRecord.upsert({
      where: { opportunityId },
      create: { orgId, opportunityId, recordedById: seedUserId, ...data },
      update: data,
    });
    outcomes += 1;
  }

  let bidScore: number | null = null;
  const scoredOppId = idByCode.get(demoBidScore.oppCode);
  if (scoredOppId) {
    const composite = computeBidComposite(demoBidScore.criteria);
    const data = {
      criteria: demoBidScore.criteria as Prisma.InputJsonValue,
      totalScore: composite.totalScore,
      categoryScores: composite.categoryScores as Prisma.InputJsonValue,
      weightedSum: composite.weightedSum,
      totalWeight: composite.totalWeight,
      recommendation: composite.recommendation,
      notes: DEMO_NOTE,
    };
    await prisma.bidScore.upsert({
      where: { id: demoBidScore.id },
      create: { id: demoBidScore.id, orgId, opportunityId: scoredOppId, scoredBy: seedUserId, version: 1, ...data },
      update: data,
    });
    bidScore = composite.totalScore;
  }

  const today = new Date();
  let activities = 0;
  for (const a of demoActivities) {
    const entityId = idByCode.get(a.oppCode);
    if (!entityId) continue;
    const occurredAt = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - a.daysAgo, a.hour, a.minute),
    );
    const data = {
      type: a.type,
      subject: a.subject,
      status: 'completed' as const,
      entityType: 'opportunity',
      entityId,
      ownerId: seedUserId,
      actorId: seedUserId,
      occurredAt,
      metadata: { demo: true } as Prisma.InputJsonValue,
    };
    await prisma.activity.upsert({ where: { id: a.id }, create: { id: a.id, orgId, ...data }, update: data });
    activities += 1;
  }
  return { outcomes, bidScore, activities };
}
