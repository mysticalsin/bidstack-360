// Regression: /win-loss/analysis must FLAG when its scan hits ANALYSIS_SCAN_CAP.
//
// WHY: the analysis aggregates only the most recent 1 000 closed records. For a
// high-volume org that silently understates win-rate, quarter trend, and
// reason/competitor breakdowns — older history is dropped with no signal to the
// UI. The sibling duplicates scan already returns `truncated`; this pins that
// win-loss does too, so the retrospective can warn instead of lying by omission.
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

// One more than the route's ANALYSIS_SCAN_CAP (1 000) so the scan is forced to
// hit the cap and drop the oldest record.
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
  t('flags truncated=true when the scan hits the record cap', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/win-loss/analysis' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { truncated: boolean; totalWon: number; totalLost: number };
    // More than 1 000 closed records exist, so the scan hit the cap and older
    // history was dropped — the client MUST be told.
    expect(body.truncated).toBe(true);
    // The aggregate reflects exactly the capped scan window, not every record.
    expect(body.totalWon + body.totalLost).toBe(1_000);
  });
});
