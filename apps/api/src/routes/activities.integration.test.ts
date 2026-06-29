import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

describe.skipIf(!process.env.DATABASE_URL)('activity routes', () => {
  let server: FastifyInstance | null = null;
  let dbReachable = false;
  let orgId: string | null = null;
  let opportunityId: string | null = null;
  let contactId: string | null = null;
  let restoreAuth: (() => void) | null = null;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }

    const org = await createIsolatedOrg('activities');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

    if (orgId) {
      const [opportunity, contact] = await Promise.all([
        prisma.opportunity.findFirst({ where: { orgId, deletedAt: null }, select: { id: true } }),
        prisma.contact.findFirst({ where: { orgId, deletedAt: null }, select: { id: true } }),
      ]);
      opportunityId = opportunity?.id ?? null;
      contactId = contact?.id ?? null;
    }

    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    if (server) await server.close();
    if (restoreAuth) restoreAuth();
    if (orgId) await dropIsolatedOrg(orgId);
    if (dbReachable) await prisma.$disconnect();
  });

  const skipIfNoSeed = (name: string, fn: (app: FastifyInstance) => Promise<void> | void) =>
    it(name, async () => {
      if (!dbReachable || !server || !orgId || !opportunityId || !contactId) {
        throw new Error(`[skip] ${name} - isolated org, opportunity, or contact missing`);
      }
      await fn(server);
    });

  skipIfNoSeed('POST /api/v1/activities creates an activity', async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'meeting',
        subject: 'Discovery call',
        description: 'Initial discovery with the client',
        entityType: 'opportunity',
        entityId: opportunityId,
        startTime: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.type).toBe('meeting');
    expect(body.subject).toBe('Discovery call');
    expect(body.entityType).toBe('opportunity');
    expect(body.status).toBe('planned');
  });

  skipIfNoSeed('GET /api/v1/activities lists activities with filters', async (app) => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/activities?limit=10',
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  skipIfNoSeed('PATCH /api/v1/activities/:id updates status', async (app) => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'task',
        subject: 'Follow up',
        entityType: 'opportunity',
        entityId: opportunityId,
      },
    });
    expect(create.statusCode).toBe(201);
    const act = create.json();

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${act.id}`,
      payload: { status: 'completed' },
    });
    expect(patch.statusCode).toBe(200);
    const updated = patch.json();
    expect(updated.status).toBe('completed');
  });

  skipIfNoSeed('DELETE /api/v1/activities/:id soft deletes', async (app) => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'note',
        subject: 'Temp note',
        entityType: 'contact',
        entityId: contactId,
      },
    });
    expect(create.statusCode).toBe(201);
    const act = create.json();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${act.id}`,
    });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${act.id}`,
    });
    expect(get.statusCode).toBe(404);
  });

  skipIfNoSeed('POST /api/v1/activities rejects an unsupported target type', async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        type: 'note',
        subject: 'Unsafe target',
        entityType: 'external-system',
        entityId: '00000000-0000-0000-0000-000000000001',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
