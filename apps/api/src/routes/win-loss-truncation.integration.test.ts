// Regression: /win-loss/analysis must count every closed record, not the newest 1 000.
//
// WHY: the analysis used to aggregate one take:1000 page and /patterns counted
// the whole book, so the retrospective understated win rate once an org passed
// 1 000 recorded outcomes. The query guard still caps each findMany at 1 000;
// the route walks the next page. The 1 001st loss is in the total and in the
// quarter buckets. `truncated` stays false because nothing was dropped.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// One more than a single findMany page (1 000). The oldest record used to be dropped.
const OVER_CAP = 1_001;

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let seeded = false;
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('win-loss-trunc');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  // recordedById is a required FK — reuse the seeded Admin visitor.
  const recorder = await prisma.user.findFirst({
    where: { orgId, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const ns = org.namespace;
  const opps = Array.from({ length: OVER_CAP }, (_, i) => ({
    id: randomUUID(),
    orgId: orgId!,
    code: `WLT-${ns}-${i}`,
    customer: 'Volume Corp',
    name: `Closed bid ${i}`,
    stage: 'closed_lost' as const,
  }));
  await prisma.opportunity.createMany({ data: opps });
  await prisma.winLossRecord.createMany({
    data: opps.map((o) => ({
      orgId: orgId!,
      opportunityId: o.id,
      outcome: 'lost' as const,
      reason: 'price' as const,
      recordedById: recorder!.id,
    })),
  });
  seeded = true;

  server = await buildServer();
  await server.ready();
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
}, 30_000);

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && seeded);

describe('win/loss analysis truncation flag', () => {
  t('counts the record past the 1000-row page', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/win-loss/analysis' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      truncated: boolean;
      totalWon: number;
      totalLost: number;
      winRatePct: number | null;
      quarters: Array<{ won: number; lost: number }>;
    };
    // A closed-only book of 1 001 losses is a 0% win rate, not a 1 000-row sample.
    expect(body.truncated).toBe(false);
    expect(body.totalWon).toBe(0);
    expect(body.totalLost).toBe(OVER_CAP);
    expect(body.winRatePct).toBe(0);
    const bucketSum = body.quarters.reduce((sum, quarter) => sum + quarter.won + quarter.lost, 0);
    expect(bucketSum).toBe(OVER_CAP);
  });
});
