// Story matches loaded at most 500 requirements and reported total as the
// length of that partial scan. A match on a requirement past the cap was
// missing, and total said the book was empty.
import { randomUUID } from 'node:crypto';

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

describe('story matches include every requirement', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('story-scan');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    opportunityId = (
      await prisma.opportunity.findFirstOrThrow({ where: { orgId }, select: { id: true } })
    ).id;
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await prisma.requirement.createMany({
      data: ids.map((id) => ({ id, orgId, opportunityId, text: 'Requirement' })),
    });
    const reference = await prisma.reference.create({
      data: { orgId, title: 'Past delivery' },
      select: { id: true },
    });
    await prisma.requirementReferenceMatch.create({
      data: {
        orgId,
        requirementId: ids[500]!,
        referenceId: reference.id,
        scoreBps: 8000,
        rank: 1,
        matchedByAgent: 'synthetic',
      },
    });
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('returns the match on requirement 501 and counts it', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/bid-workspaces/${opportunityId}/story-matches`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: Array<{ title: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items.map((item) => item.title)).toEqual(['Past delivery']);
  });
});
