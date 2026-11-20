import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/client/index.js';

import { seedBidChartDemo } from './seed-bid-charts.js';
import { demoBidScore } from './seed-data.bid-charts.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const OPP = '00000000-0000-4000-8000-000000000002';

function fakePrisma(scores: { fixture: boolean; authored: boolean }) {
  const bidScore = {
    findUnique: vi.fn(async () => (scores.fixture ? { id: demoBidScore.id } : null)),
    findFirst: vi.fn(async () => (scores.authored ? { id: 'user-authored' } : null)),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
    upsert: vi.fn(async () => ({})),
  };
  const prisma = {
    opportunity: { findMany: vi.fn(async () => [{ id: OPP, code: demoBidScore.oppCode }]) },
    winLossRecord: { upsert: vi.fn(async () => ({})) },
    activity: { upsert: vi.fn(async () => ({})) },
    bidScore,
  };
  return { prisma: prisma as unknown as PrismaClient, bidScore };
}

describe('seedBidChartDemo bid score', () => {
  it('keeps a score already authored through the bid matrix instead of inserting a second version 1', async () => {
    const { prisma, bidScore } = fakePrisma({ fixture: false, authored: true });
    const counts = await seedBidChartDemo(prisma, ORG, 'user');
    expect(bidScore.create).not.toHaveBeenCalled();
    expect(bidScore.update).not.toHaveBeenCalled();
    expect(counts.bidScore).toBeNull();
  });

  it('creates the fixture score when the opportunity has none', async () => {
    const { prisma, bidScore } = fakePrisma({ fixture: false, authored: false });
    const counts = await seedBidChartDemo(prisma, ORG, 'user');
    expect(bidScore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: demoBidScore.id, opportunityId: OPP, version: 1 }),
    });
    expect(counts.bidScore).toEqual(expect.any(Number));
  });

  it('refreshes the fixture score on a re-seed', async () => {
    const { prisma, bidScore } = fakePrisma({ fixture: true, authored: true });
    await seedBidChartDemo(prisma, ORG, 'user');
    expect(bidScore.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: demoBidScore.id } }));
    expect(bidScore.create).not.toHaveBeenCalled();
  });
});
