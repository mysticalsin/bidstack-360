// POST /activities checks the target and the owner, then stores actorId from
// the body. Harbor can attribute the activity to a user in Quay.
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
let harborOrgId: string | null = null;
let quayOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let harborCompanyId = '';
let harborUserId = '';
let quayUserId = '';

describe('activity actor ownership', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const harbor = await createIsolatedOrg('harbor-actor');
    const quay = await createIsolatedOrg('quay-actor');
    harborOrgId = harbor.orgId;
    quayOrgId = quay.orgId;
    restoreAuth = useIsolatedOrgAuth(harbor.clerkOrg);
    harborCompanyId = (
      await prisma.company.create({
        data: { orgId: harbor.orgId, name: 'Harbor Synthetic Co' },
        select: { id: true },
      })
    ).id;
    harborUserId = (
      await prisma.user.findFirstOrThrow({ where: { orgId: harbor.orgId }, select: { id: true } })
    ).id;
    quayUserId = (
      await prisma.user.findFirstOrThrow({ where: { orgId: quay.orgId }, select: { id: true } })
    ).id;
    server = await buildServer();
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (harborOrgId) await dropIsolatedOrg(harborOrgId);
    if (quayOrgId) await dropIsolatedOrg(quayOrgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!harborOrgId);

  skipIfNoDb('create 404s an actor from another org and stores nothing', async () => {
    const foreign = await server.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'note',
        entityType: 'company',
        entityId: harborCompanyId,
        actorId: quayUserId,
        subject: 'Written by Quay',
      },
    });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(
      await prisma.activity.count({ where: { orgId: harborOrgId!, actorId: quayUserId } }),
    ).toBe(0);

    const own = await server.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'note',
        entityType: 'company',
        entityId: harborCompanyId,
        actorId: harborUserId,
        subject: 'Written by Harbor',
      },
    });
    expect(own.statusCode, own.body).toBe(201);
    expect(own.json()).toMatchObject({ actorId: harborUserId });
  });
});
