import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@bidstack/db';

describe.skipIf(!process.env.DATABASE_URL)('activity routes', () => {
  let server: FastifyInstance;
  let orgId: string | null = null;
  let opportunityId: string | null = null;
  let contactId: string | null = null;

  beforeAll(async () => {
    const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
    orgId = org?.id ?? null;
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
    await server.close();
    await prisma.$disconnect();
  });

  const skipIfNoSeed = (name: string, fn: () => Promise<void> | void) =>
    it(name, async () => {
      if (!orgId || !opportunityId || !contactId) {
        console.warn(`[skip] ${name} - seed org, opportunity, or contact missing`);
        return;
      }
      await fn();
    });

  skipIfNoSeed('POST /api/v1/activities creates an activity', async () => {
    const res = await server.inject({
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

  it('GET /api/v1/activities lists activities with filters', async () => {
    const list = await server.inject({
      method: 'GET',
      url: '/api/v1/activities?limit=10',
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  skipIfNoSeed('PATCH /api/v1/activities/:id updates status', async () => {
    const create = await server.inject({
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

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${act.id}`,
      payload: { status: 'completed' },
    });
    expect(patch.statusCode).toBe(200);
    const updated = patch.json();
    expect(updated.status).toBe('completed');
  });

  skipIfNoSeed('DELETE /api/v1/activities/:id soft deletes', async () => {
    const create = await server.inject({
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

    const del = await server.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${act.id}`,
    });
    expect(del.statusCode).toBe(204);

    const get = await server.inject({
      method: 'GET',
      url: `/api/v1/activities/${act.id}`,
    });
    expect(get.statusCode).toBe(404);
  });

  it('POST /api/v1/activities rejects an unsupported target type', async () => {
    const res = await server.inject({
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
