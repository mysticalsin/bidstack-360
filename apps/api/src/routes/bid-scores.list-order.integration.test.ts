// Bid-score pages use offset and ordered only by createdAt. Two versions
// saved together have no stable order.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: FastifyInstance;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let opportunityId = '';
let higherId = '';
let lowerId = '';

describe('bid score list order', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('bid-score-order');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    opportunityId = (
      await prisma.opportunity.findFirstOrThrow({ where: { orgId }, select: { id: true } })
    ).id;
    const score = {
      orgId,
      opportunityId,
      scoredBy: user.id,
      criteria: {},
      totalScore: 40,
      categoryScores: {},
      weightedSum: 0,
      totalWeight: 0,
      recommendation: 'no_bid',
      memosPolicies: [],
    };
    const first = await prisma.bidScore.create({ data: { ...score, version: 1 } });
    const second = await prisma.bidScore.create({ data: { ...score, version: 2 } });
    higherId = first.id > second.id ? first.id : second.id;
    lowerId = first.id > second.id ? second.id : first.id;
    const stamp = new Date('2026-06-01T00:00:00.000Z');
    await prisma.$executeRaw`UPDATE bid_scores SET created_at = ${stamp} WHERE id IN (${first.id}::uuid, ${second.id}::uuid)`;
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('pages a tied createdAt by id descending', async () => {
    const headers = { authorization: 'Bearer stub' };
    const page = async (offset: number) => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/bid-scores?opportunityId=${opportunityId}&limit=1&offset=${offset}`,
        headers,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { items: Array<{ id: string }> }).items;
    };
    expect((await page(0))[0]?.id).toBe(higherId);
    expect((await page(1))[0]?.id).toBe(lowerId);
  });
});
