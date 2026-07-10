import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

// WHY plain describe (not describe.skipIf(!DATABASE_URL)): skipIf marks the
// whole suite "skipped" — a CI run missing the env var would go green with
// zero activity-route coverage. skipIfNoSeed below already throws loudly when
// the DB/fixtures aren't there, so the suite fails instead of vanishing.
describe('activity routes', () => {
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

  // WHY: occurredAt is not unique — concurrent writes land on the same
  // millisecond. The timeline used to order by occurredAt alone and page with a
  // strict `lt` timestamp cursor, so a tie straddling a page boundary was
  // silently and permanently dropped from the feed (never on the emitting page,
  // excluded from the next). Users read the timeline as the audit trail of an
  // entity — a row that exists in the DB but never renders is data loss to them.
  skipIfNoSeed(
    'GET entity timeline returns occurredAt ties straddling a page boundary exactly once',
    async (app) => {
      const tiedAt = new Date('2031-01-01T12:00:00.000Z');
      await prisma.activity.createMany({
        data: [0, 1, 2].map((i) => ({
          orgId: orgId!,
          type: 'call' as const,
          subject: `tied call ${i}`,
          entityType: 'contact',
          entityId: contactId!,
          occurredAt: tiedAt,
        })),
      });

      const page1 = await app.inject({
        method: 'GET',
        url: `/api/v1/entities/contact/${contactId}/activities?limit=2&typeFilter=call`,
      });
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(body1.items).toHaveLength(2);
      expect(body1.nextCursor).not.toBeNull();

      const page2 = await app.inject({
        method: 'GET',
        url: `/api/v1/entities/contact/${contactId}/activities?limit=2&typeFilter=call&cursor=${encodeURIComponent(body1.nextCursor)}`,
      });
      expect(page2.statusCode).toBe(200);
      const body2 = page2.json();

      // Every tied row comes back, none twice — the boundary tie is not dropped.
      const ids = [...body1.items, ...body2.items].map((a: { id: string }) => a.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      expect(body2.nextCursor).toBeNull();
    },
  );

  // WHY x2: (1) the generic feed shares the tie-at-page-boundary guarantee with
  // the timeline; (2) `total` must be the stable count of the caller's filter —
  // it previously counted under the cursor-narrowed where, so it shrank as the
  // client paged and broke any pager deriving page count from it.
  skipIfNoSeed(
    'GET /api/v1/activities pages occurredAt ties once and keeps total stable across pages',
    async (app) => {
      const tiedAt = new Date('2031-02-02T08:00:00.000Z');
      await prisma.activity.createMany({
        data: [0, 1, 2].map((i) => ({
          orgId: orgId!,
          type: 'email' as const,
          subject: `tied email ${i}`,
          entityType: 'contact',
          entityId: contactId!,
          occurredAt: tiedAt,
        })),
      });

      const page1 = await app.inject({
        method: 'GET',
        url: `/api/v1/activities?type=email&entityId=${contactId}&limit=2`,
      });
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(body1.items).toHaveLength(2);
      expect(body1.total).toBe(3);
      expect(body1.nextCursor).not.toBeNull();

      const page2 = await app.inject({
        method: 'GET',
        url: `/api/v1/activities?type=email&entityId=${contactId}&limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
      });
      expect(page2.statusCode).toBe(200);
      const body2 = page2.json();

      const ids = [...body1.items, ...body2.items].map((a: { id: string }) => a.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      // total is the whole filtered set on every page, not a countdown.
      expect(body2.total).toBe(3);
    },
  );
});
