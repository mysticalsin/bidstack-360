import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { getPipelineKpis } from '../../services/reports/funnel.service.js';
import { buildServer } from '../../server.js';
import { fetchAccountStats } from '../accounts.helpers.js';
import { excludeClosedOutcome } from '../opportunities.helpers.js';
import { invalidateCrmSummaryCache } from './summary.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let restoreAuth: (() => void) | null = null;

// Hermetic: bind stub auth to a freshly-seeded isolated org rather than the
// shared seed tenant. This test reads org-wide aggregates through the default
// stub identity, so a concurrent suite mutating that shared seed org (roles, rows)
// could flip its status/counts — a real full-run flake. Its own org is immune.
beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('crm-summary');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
});

const failIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('crm summary routes', () => {
  failIfNoDb('GET /api/crm/summary returns bounded activity and counts', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/summary?limit=3' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.companies).toEqual(expect.any(Number));
    expect(body.contacts).toEqual(expect.any(Number));
    expect(body.pipelineValue).toEqual(expect.any(Number));
    expect(body.recentActivity).toEqual(expect.any(Array));
    expect(body.recentActivity.length).toBeLessThanOrEqual(3);
  });

  failIfNoDb('a lost stage flag stays out of the open pipeline total', async () => {
    // WHY: the open total used the enum key alone. A stage marked lost, with
    // the deal still stored as an open key, was counted as pipeline.
    const before = await server.inject({ method: 'GET', url: '/api/crm/summary' });
    expect(before.statusCode).toBe(200);
    const baseline = before.json() as { openOpportunities: number; pipelineValue: number };
    const kpisBefore = await getPipelineKpis(orgId);

    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `Lost flag ${Date.now()}` },
    });
    const stage = await prisma.pipelineStage.create({
      data: {
        orgId,
        pipelineId: pipeline.id,
        key: 's1_lead',
        name: 'Marked lost',
        isLost: true,
      },
    });
    const company = await prisma.company.create({
      data: { orgId, name: `Lost Flag Co ${Date.now()}` },
    });
    await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-LOST-${Date.now()}`,
        customer: 'Lost Flag Co',
        companyId: company.id,
        name: 'Should not be open',
        stage: 's1_lead',
        pipelineStageId: stage.id,
        valueMicros: 5_000_000_000n,
        probability: 0,
        intel: {},
      },
    });
    invalidateCrmSummaryCache(orgId);

    const after = await server.inject({ method: 'GET', url: '/api/crm/summary' });
    expect(after.statusCode).toBe(200);
    const body = after.json() as { openOpportunities: number; pipelineValue: number };
    expect(body.openOpportunities).toBe(baseline.openOpportunities);
    expect(body.pipelineValue).toBe(baseline.pipelineValue);

    const kpisAfter = await getPipelineKpis(orgId);
    expect(kpisAfter.totalOpen).toBe(kpisBefore.totalOpen);
    expect(kpisAfter.totalValueOpen).toBe(kpisBefore.totalValueOpen);

    const stats = await fetchAccountStats(orgId, [company.id]);
    expect(stats.get(company.id)?.openDeals).toBe(0);
    const openOnAccount = await prisma.opportunity.count({
      where: { orgId, deletedAt: null, companyId: company.id, ...excludeClosedOutcome() },
    });
    expect(openOnAccount).toBe(0);
  });

  failIfNoDb('a won stage flag counts as closed this quarter', async () => {
    // WHY: the quarter close count used the closed_won enum only. A live won
    // flag was still an open stage, and a lost flag on a won enum still counted.
    const before = await getPipelineKpis(orgId);
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `Quarter flags ${Date.now()}` },
    });
    const won = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'verbal_won', name: 'Verbal won', isWon: true },
    });
    const lost = await prisma.pipelineStage.create({
      data: {
        orgId,
        pipelineId: pipeline.id,
        key: 'both_flags',
        name: 'Both',
        isWon: true,
        isLost: true,
      },
    });
    const stamp = Date.now();
    await prisma.opportunity.createMany({
      data: [
        {
          orgId,
          code: `OP-WQ1-${stamp}`,
          customer: 'Quarter Co',
          name: 'Flagged won',
          stage: 's3_technical_iteration',
          pipelineStageId: won.id,
          valueMicros: 1_000_000n,
          probability: 80,
          intel: {},
        },
        {
          orgId,
          code: `OP-WQ2-${stamp}`,
          customer: 'Quarter Co',
          name: 'Won enum but lost flag',
          stage: 'closed_won',
          pipelineStageId: lost.id,
          valueMicros: 4_000_000n,
          probability: 100,
          intel: {},
        },
      ],
    });

    const after = await getPipelineKpis(orgId);
    expect(after.velocity.closedThisQuarter).toBe(before.velocity.closedThisQuarter + 1);
  });

  failIfNoDb('GET /api/crm/summary rejects invalid limits', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/summary?limit=0' });
    expect(res.statusCode).toBe(400);
  });
});
