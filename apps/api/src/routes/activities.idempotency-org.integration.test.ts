// The database unique is (org_id, idempotency_key). The Prisma model still
// marks idempotencyKey unique by itself, so the upsert conflicts on a column
// the database does not constrain, and one org's key blocks the statement.
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
let harborOrgId: string | null = null;
let quayOrgId: string | null = null;
let harborClerk = '';
let quayClerk = '';
let restoreAuth: (() => void) | null = null;
let harborCompanyId = '';
let quayCompanyId = '';

describe('activity idempotency is per org', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const harbor = await createIsolatedOrg('harbor-idem');
    const quay = await createIsolatedOrg('quay-idem');
    harborOrgId = harbor.orgId;
    quayOrgId = quay.orgId;
    harborClerk = harbor.clerkOrg;
    quayClerk = quay.clerkOrg;
    restoreAuth = useIsolatedOrgAuth(harbor.clerkOrg);
    harborCompanyId = (
      await prisma.company.create({
        data: { orgId: harbor.orgId, name: 'Harbor Synthetic Co' },
        select: { id: true },
      })
    ).id;
    quayCompanyId = (
      await prisma.company.create({
        data: { orgId: quay.orgId, name: 'Quay Synthetic Ltd' },
        select: { id: true },
      })
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

  skipIfNoDb('the same idempotency key can be used in Harbor and in Quay', async () => {
    const idempotencyKey = `synthetic-${randomUUID()}`;
    process.env.BIDSTACK_STUB_ORG_CLERK = harborClerk;
    const harbor = await server.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'note',
        entityType: 'company',
        entityId: harborCompanyId,
        subject: 'Harbor key',
        idempotencyKey,
      },
    });
    expect(harbor.statusCode, harbor.body).toBe(201);
    const harborId = (harbor.json() as { id: string }).id;

    process.env.BIDSTACK_STUB_ORG_CLERK = quayClerk;
    const quay = await server.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'note',
        entityType: 'company',
        entityId: quayCompanyId,
        subject: 'Quay key',
        idempotencyKey,
      },
    });
    expect(quay.statusCode, quay.body).toBe(201);
    expect((quay.json() as { id: string }).id).not.toBe(harborId);

    process.env.BIDSTACK_STUB_ORG_CLERK = harborClerk;
    const replay = await server.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'note',
        entityType: 'company',
        entityId: harborCompanyId,
        subject: 'Harbor key again',
        idempotencyKey,
      },
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect((replay.json() as { id: string }).id).toBe(harborId);
  });
});
