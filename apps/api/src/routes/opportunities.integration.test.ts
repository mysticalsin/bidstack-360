// Integration tests against a live Postgres + seed.
// These exercise the full Fastify stack (auth stub → Zod validation →
// Prisma → serializer) without HTTP — `server.inject` calls handlers
// in-process. Skipped automatically when DATABASE_URL is unreachable so
// the suite stays useful in offline CI.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable) {
      throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    }
    await fn();
  });

describe('opportunities routes', () => {
  skipIfNoDb('GET /api/opportunities returns the seeded fixtures', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opportunities?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    // Seed plants 8 fixture opportunities; later sprints may add more
    // via the create form, so we use ≥ rather than ===.
    expect(body.items.length).toBeGreaterThanOrEqual(8);
    expect(body.items[0]).toMatchObject({
      id: expect.any(String),
      code: expect.stringMatching(/^OP-\d{4}$/),
      stage: expect.stringMatching(
        /^(s1_lead|s1_ongoing|s2_sent|s3_technical_iteration|s4_negotiation|closed_won|closed_lost)$/,
      ),
      probability: expect.any(Number),
    });
  });

  skipIfNoDb('GET /api/opportunities supports search', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/opportunities?search=MAHLE',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((o: { customer: string }) => o.customer === 'MAHLE')).toBe(true);
  });

  skipIfNoDb('GET /api/opportunities/:id returns the full intel payload', async () => {
    const list = (await server.inject({ method: 'GET', url: '/api/opportunities?limit=1' })).json();
    const id = list.items[0].id;
    const res = await server.inject({ method: 'GET', url: `/api/opportunities/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intel).toBeDefined();
    expect(body.tasks).toBeDefined();
    expect(body.documents).toBeDefined();
  });

  skipIfNoDb('POST /api/opportunities/:id/stage moves the card and writes audit_log', async () => {
    const list = (
      await server.inject({
        method: 'GET',
        url: '/api/opportunities?stage=s1_ongoing&limit=1',
      })
    ).json();
    if (list.items.length === 0) {
      console.warn('[skip] no s1_ongoing opps to move');
      return;
    }
    const id = list.items[0].id;

    const auditBefore = await prisma.auditLog.count({
      where: { targetType: 'opportunity', targetId: id, action: 'opportunity.stage' },
    });

    const move = await server.inject({
      method: 'POST',
      url: `/api/opportunities/${id}/stage`,
      payload: { stage: 's2_sent' },
    });
    expect(move.statusCode).toBe(200);
    expect(move.json()).toMatchObject({ id, stage: 's2_sent' });

    const auditAfter = await prisma.auditLog.count({
      where: { targetType: 'opportunity', targetId: id, action: 'opportunity.stage' },
    });
    expect(auditAfter).toBe(auditBefore + 1);

    // Restore (test is idempotent across runs)
    await server.inject({
      method: 'POST',
      url: `/api/opportunities/${id}/stage`,
      payload: { stage: 's1_ongoing' },
    });
  });

  skipIfNoDb(
    'DELETE /api/opportunities/:id soft-deletes the record and writes an audit_log entry',
    async () => {
      // Look up the seed org — the dev auth stub runs every request as this org.
      const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
      if (!org) {
        console.warn('[skip] seed org not found');
        return;
      }

      // Create a throwaway fixture — deleting a seeded record would break the
      // ≥8 count assertion in the GET list test above.
      const fixture = await prisma.opportunity.create({
        data: {
          orgId: org.id,
          code: `OP-TST-${Date.now()}`,
          name: 'DELETE integration test fixture',
          customer: 'Test Corp',
          stage: 's1_lead',
          valueMicros: BigInt(0),
          probability: 0,
        },
      });

      const del = await server.inject({
        method: 'DELETE',
        url: `/api/opportunities/${fixture.id}`,
      });
      expect(del.statusCode).toBe(204);

      // Re-fetch must 404 — the record is now soft-deleted (deletedAt is set).
      const get = await server.inject({
        method: 'GET',
        url: `/api/opportunities/${fixture.id}`,
      });
      expect(get.statusCode).toBe(404);

      // Audit log must have been written atomically with the soft-delete.
      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          targetType: 'opportunity',
          targetId: fixture.id,
          action: 'opportunity.delete',
        },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.diff).toMatchObject({
        code: fixture.code,
        customer: fixture.customer,
      });
    },
  );
});

describe('contacts + tasks + reports routes', () => {
  skipIfNoDb('GET /api/contacts returns seeded contacts', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/contacts' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(8);
  });

  skipIfNoDb('GET /api/tasks returns seeded tasks', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(7);
  });

  skipIfNoDb('POST /api/tasks rejects opportunities outside the caller org', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        oppId: '11111111-2222-3333-4444-555555555555',
        title: 'Do not attach across tenants',
        dueDate: null,
        status: 'open',
        assignee: null,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Opportunity not found in this org');
  });

  skipIfNoDb('GET /api/reports/pipeline returns weighted KPIs', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/reports/pipeline' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Weighted pipeline = Σ value × probability/100 over open stages — must
    // never exceed total open value (because every probability ≤ 100).
    expect(body.weightedPipeline).toBeLessThanOrEqual(body.totalValueOpen);
    expect(body.byStage.length).toBeGreaterThan(0);
  });

  skipIfNoDb('GET /api/reports/sales-intelligence returns countries and who is there', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/reports/sales-intelligence' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kpis.some((kpi: { id: string }) => kpi.id === 'quotations')).toBe(true);
    expect(body.topCountries.length).toBeGreaterThan(0);
    expect(
      body.topCountries.some(
        (country: { topCustomers: string[]; people: { name: string }[] }) =>
          country.topCustomers.length > 0 && country.people.length > 0,
      ),
    ).toBe(true);
    expect(body.topProducts.length).toBeGreaterThan(0);
  });
});
