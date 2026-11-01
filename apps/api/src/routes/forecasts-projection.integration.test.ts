import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('forecast-flags');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('forecast projection and flagged stages', () => {
  skipIfNoDb('a lost flag is not pipeline and a won flag is an actual', async () => {
    // WHY: the projection treated every non-closed_lost enum as open pipeline.
    // A stage marked lost was still weighted, and a stage marked won was not
    // an actual.
    const owner = await prisma.user.create({
      data: {
        orgId,
        clerkUser: `user_fc_${Date.now()}`,
        email: `forecast.${Date.now()}@test.local`,
        name: 'Forecast Owner',
      },
    });
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `Forecast ${Date.now()}` },
    });
    const lost = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'price_lost', name: 'Price lost', isLost: true },
    });
    const won = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, key: 'verbal_won', name: 'Verbal won', isWon: true },
    });
    const configured = await prisma.pipelineStage.findFirst({
      where: { orgId, key: 's1_lead', deletedAt: null },
      orderBy: { orderIndex: 'asc' },
      select: { probability: true },
    });
    const probability = configured ? Number(configured.probability) : 10;
    const due = new Date();
    due.setUTCDate(15);
    due.setUTCHours(0, 0, 0, 0);
    const stamp = Date.now();
    await prisma.opportunity.createMany({
      data: [
        {
          orgId,
          code: `OP-FC1-${stamp}`,
          customer: 'Forecast Co',
          name: 'Open',
          stage: 's1_lead',
          valueMicros: 1_000_000n,
          probability: 10,
          ownerId: owner.id,
          dueDate: due,
          intel: {},
        },
        {
          orgId,
          code: `OP-FC2-${stamp}`,
          customer: 'Forecast Co',
          name: 'Lost flag',
          stage: 's2_sent',
          pipelineStageId: lost.id,
          valueMicros: 9_000_000n,
          probability: 40,
          ownerId: owner.id,
          dueDate: due,
          intel: {},
        },
        {
          orgId,
          code: `OP-FC3-${stamp}`,
          customer: 'Forecast Co',
          name: 'Won flag',
          stage: 's3_technical_iteration',
          pipelineStageId: won.id,
          valueMicros: 2_000_000n,
          probability: 80,
          ownerId: owner.id,
          dueDate: due,
          intel: {},
        },
      ],
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/forecasts/projection' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      periods: Array<{
        byOwner: Array<{
          ownerId: string | null;
          openMicros: string;
          weightedMicros: string;
          wonMicros: string;
        }>;
      }>;
    };
    const row = body.periods
      .flatMap((period) => period.byOwner)
      .find((ownerRow) => ownerRow.ownerId === owner.id);
    expect(row).toMatchObject({
      openMicros: '1000000',
      weightedMicros: String(Math.round((1_000_000 * probability) / 100)),
      wonMicros: '2000000',
    });
  });

  skipIfNoDb('a linked stage keeps its own probability', async () => {
    // WHY: the first s1_lead stage in the org weighted every deal with that
    // key. A deal on a later stage must use that stage's probability, including
    // when the deal's own stored probability says something else.
    const owner = await prisma.user.create({
      data: {
        orgId,
        clerkUser: `user_fp_${Date.now()}`,
        email: `forecast.prob.${Date.now()}@test.local`,
        name: 'Probability Owner',
      },
    });
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: `Later stage ${Date.now()}` },
    });
    const later = await prisma.pipelineStage.create({
      data: {
        orgId,
        pipelineId: pipeline.id,
        key: 's1_lead',
        name: 'Later lead',
        orderIndex: 50,
        probability: 70,
      },
    });
    const due = new Date();
    due.setUTCDate(15);
    due.setUTCHours(0, 0, 0, 0);
    await prisma.opportunity.create({
      data: {
        orgId,
        code: `OP-FP-${Date.now()}`,
        customer: 'Forecast Co',
        name: 'On the later stage',
        stage: 's1_lead',
        pipelineStageId: later.id,
        valueMicros: 2_000_000n,
        probability: 10,
        ownerId: owner.id,
        dueDate: due,
        intel: {},
      },
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/forecasts/projection' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      periods: Array<{
        byOwner: Array<{ ownerId: string | null; openMicros: string; weightedMicros: string }>;
      }>;
    };
    const row = body.periods
      .flatMap((period) => period.byOwner)
      .find((ownerRow) => ownerRow.ownerId === owner.id);
    expect(row).toMatchObject({
      openMicros: '2000000',
      weightedMicros: '1400000',
    });
  });
});
