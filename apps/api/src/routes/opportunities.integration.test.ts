// Integration tests against a live Postgres + seed.
// These exercise the full Fastify stack (auth stub → Zod validation →
// Prisma → serializer) without HTTP — `server.inject` calls handlers
// in-process. Skipped automatically when DATABASE_URL is unreachable so
// the suite stays useful in offline CI.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';
import { mintNextCode } from './opportunities.helpers.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

type OpportunityListItem = {
  id: string;
  code: string;
  stage: string;
  probability: number;
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('opportunities');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('opportunities routes', () => {
  skipIfNoDb('GET /api/opportunities returns the seeded fixtures', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/opportunities?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: OpportunityListItem[] }>();
    expect(Array.isArray(body.items)).toBe(true);
    // The isolated org owns a compact but complete fixture set; this assertion
    // proves the route reads tenant data without depending on global demo counts.
    expect(body.items.length).toBeGreaterThan(0);
    // RFP pipeline tests run in parallel and can create valid RFP-* records.
    // The page head only needs to satisfy the tolerant persisted-read contract.
    expect(body.items[0]).toMatchObject({
      id: expect.any(String),
      code: expect.any(String),
      stage: expect.stringMatching(
        /^(s1_lead|s1_ongoing|s2_sent|s3_technical_iteration|s4_negotiation|closed_won|closed_lost|S1 Lead|S1 Ongoing|S2 Sent|S3 Technical Iteration|S4 Negotiation|Closed Won|Closed Lost)$/,
      ),
      probability: expect.any(Number),
    });

    const seed = await prisma.opportunity.findFirst({
      where: {
        orgId: orgId!,
        deletedAt: null,
        code: { startsWith: 'OP-' },
      },
      orderBy: { code: 'asc' },
      select: { id: true, code: true },
    });
    expect(seed).not.toBeNull();

    const seedRes = await server.inject({
      method: 'GET',
      url: `/api/opportunities?search=${encodeURIComponent(seed!.code)}&limit=20`,
    });
    expect(seedRes.statusCode).toBe(200);
    const seedBody = seedRes.json<{ items: OpportunityListItem[] }>();
    const seedItem = seedBody.items.find((item) => item.id === seed!.id);
    expect(seedItem).toMatchObject({
      id: seed!.id,
      // \d{4,}: codes zero-pad to 4 but grow past OP-9999 once an org exceeds
      // 9,999 opportunities (real at 100k scale) — accept any 4+ digit suffix.
      code: expect.stringMatching(/^OP-\d{4,}$/),
      probability: expect.any(Number),
    });
  });

  skipIfNoDb('GET /api/opportunities supports search', async () => {
    const searchable = await prisma.opportunity.findFirst({
      where: { orgId: orgId!, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, customer: true },
    });
    expect(searchable).not.toBeNull();

    const res = await server.inject({
      method: 'GET',
      url: `/api/opportunities?search=${encodeURIComponent(searchable!.customer)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: string; customer: string }> }>();
    expect(body.items.some((o) => o.id === searchable!.id)).toBe(true);
  });

  skipIfNoDb('mintNextCode sorts OP suffixes numerically beyond four digits', async () => {
    const org = await prisma.org.create({
      data: {
        clerkOrg: `org_code_alloc_${randomUUID()}`,
        name: 'Opportunity Code Allocation Test',
      },
    });

    try {
      await prisma.opportunity.createMany({
        data: [
          {
            orgId: org.id,
            code: 'OP-9999',
            customer: 'Allocator',
            name: 'Four digit ceiling',
            stage: 's1_lead',
            probability: 0,
          },
          {
            orgId: org.id,
            code: 'OP-10000',
            customer: 'Allocator',
            name: 'Five digit successor',
            stage: 's1_lead',
            probability: 0,
          },
        ],
      });

      const code = await prisma.$transaction((tx) => mintNextCode(tx, org.id));
      expect(code).toBe('OP-10001');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
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

  skipIfNoDb('POST /api/opportunities/:id/brief returns a grounded account brief', async () => {
    const list = (await server.inject({ method: 'GET', url: '/api/opportunities?limit=1' })).json();
    const id = list.items[0].id;
    const res = await server.inject({ method: 'POST', url: `/api/opportunities/${id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.model).toBe('crm-grounded-v1');
    expect(body.brief).toContain('Source-grounded account brief');
    expect(body.brief).not.toMatch(/stub|DUST_API_KEY|DUST_AGENT_EXEC_BRIEF/i);
    expect(body.tokens).toBeGreaterThan(50);
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
    expect(move.json()).toHaveProperty('pipelineStage');

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

  skipIfNoDb('POST /api/opportunities/:id/stage rejects archived pipeline stages', async () => {
    const opportunity = await prisma.opportunity.findFirst({
      where: { orgId: orgId!, deletedAt: null },
      select: { id: true },
    });
    if (!opportunity) {
      console.warn('[skip] no opportunity to move');
      return;
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        orgId: orgId!,
        name: `Archived pipeline test ${Date.now()}`,
        archived: true,
      },
    });
    const stage = await prisma.pipelineStage.create({
      data: {
        orgId: orgId!,
        pipelineId: pipeline.id,
        key: `archived_stage_${Date.now()}`,
        name: 'Archived Stage',
        orderIndex: 1,
        probability: 10,
      },
    });

    try {
      const move = await server.inject({
        method: 'POST',
        url: `/api/opportunities/${opportunity.id}/stage`,
        payload: { pipelineStageId: stage.id },
      });
      expect(move.statusCode).toBe(400);
      expect(move.json().message).toBe('Invalid pipeline stage');
    } finally {
      await prisma.pipelineStage.delete({ where: { id: stage.id } });
      await prisma.pipeline.delete({ where: { id: pipeline.id } });
    }
  });

  skipIfNoDb(
    'POST /api/opportunities/:id/stage notifies the owner when a different actor moves it',
    async () => {
      // The stub actor resolves to the isolated org's Admin (oldest user) — a
      // second, distinct user proves the notification reaches the OWNER, not
      // the actor performing the move.
      const owner = await prisma.user.create({
        data: {
          orgId: orgId!,
          clerkUser: `u_stage_owner_${Date.now()}`,
          email: `stage-owner-${Date.now()}@t.local`,
          name: 'Stage Owner',
        },
      });
      const opp = await prisma.opportunity.create({
        data: {
          orgId: orgId!,
          code: `OP-STAGE-${Date.now()}`,
          customer: 'Stage Notify Co',
          name: 'Stage notify fixture',
          stage: 's1_lead',
          probability: 10,
          ownerId: owner.id,
        },
      });
      try {
        const move = await server.inject({
          method: 'POST',
          url: `/api/opportunities/${opp.id}/stage`,
          payload: { stage: 's2_sent' },
        });
        expect(move.statusCode).toBe(200);

        const notif = await prisma.notification.findFirst({
          where: { orgId: orgId!, userId: owner.id, entityType: 'opportunity', entityId: opp.id },
        });
        expect(notif).toMatchObject({ type: 'stage_change', userId: owner.id });
      } finally {
        await prisma.notification.deleteMany({ where: { entityId: opp.id } });
        await prisma.opportunity.delete({ where: { id: opp.id } }).catch(() => undefined);
        await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
      }
    },
  );

  skipIfNoDb(
    'POST /api/opportunities/:id/stage does not self-notify when the owner moves their own card',
    async () => {
      // The stub actor IS the isolated org's Admin — owning the opp here means
      // actor === owner, so the "someone else" guard must suppress the alert.
      const adminId = await prisma.user
        .findFirstOrThrow({ where: { orgId: orgId! }, orderBy: { createdAt: 'asc' } })
        .then((u) => u.id);
      const opp = await prisma.opportunity.create({
        data: {
          orgId: orgId!,
          code: `OP-STAGE-SELF-${Date.now()}`,
          customer: 'Self Move Co',
          name: 'Self-notify guard fixture',
          stage: 's1_lead',
          probability: 10,
          ownerId: adminId,
        },
      });
      try {
        const move = await server.inject({
          method: 'POST',
          url: `/api/opportunities/${opp.id}/stage`,
          payload: { stage: 's2_sent' },
        });
        expect(move.statusCode).toBe(200);

        const notif = await prisma.notification.findFirst({
          where: {
            orgId: orgId!,
            userId: adminId,
            entityType: 'opportunity',
            entityId: opp.id,
            type: 'stage_change',
          },
        });
        expect(notif).toBeNull();
      } finally {
        await prisma.notification.deleteMany({ where: { entityId: opp.id } });
        await prisma.opportunity.delete({ where: { id: opp.id } }).catch(() => undefined);
      }
    },
  );

  skipIfNoDb(
    'DELETE /api/opportunities/:id soft-deletes the record and writes an audit_log entry',
    async () => {
      // Create a throwaway fixture — deleting a seeded record would break the
      // ≥8 count assertion in the GET list test above.
      const fixture = await prisma.opportunity.create({
        data: {
          orgId: orgId!,
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

  skipIfNoDb(
    'PATCH /api/opportunities/:id enforces optimistic concurrency via expectedUpdatedAt',
    async () => {
      // WHY: without a concurrency token, two people editing the same bid are
      // last-write-wins — the loser's fields vanish silently. The token is
      // opt-in so legacy clients keep working, but when supplied a stale one
      // must 409, never overwrite.
      const list = (
        await server.inject({ method: 'GET', url: '/api/opportunities?limit=1' })
      ).json();
      const id = list.items[0].id as string;
      const detail = (await server.inject({ method: 'GET', url: `/api/opportunities/${id}` })).json();
      const loadedUpdatedAt = detail.updatedAt as string;

      // Fresh token → accepted.
      const first = await server.inject({
        method: 'PATCH',
        url: `/api/opportunities/${id}`,
        payload: { probability: 42, expectedUpdatedAt: loadedUpdatedAt },
      });
      expect(first.statusCode).toBe(200);

      // Same token again is now stale (first PATCH bumped updatedAt) → 409.
      const stale = await server.inject({
        method: 'PATCH',
        url: `/api/opportunities/${id}`,
        payload: { probability: 43, expectedUpdatedAt: loadedUpdatedAt },
      });
      expect(stale.statusCode).toBe(409);
      // The stale write must NOT have been applied.
      const after = (await server.inject({ method: 'GET', url: `/api/opportunities/${id}` })).json();
      expect(after.probability).toBe(42);

      // No token → legacy last-write-wins behavior preserved.
      const legacy = await server.inject({
        method: 'PATCH',
        url: `/api/opportunities/${id}`,
        payload: { probability: 44 },
      });
      expect(legacy.statusCode).toBe(200);
    },
  );

  // A1 (bid clock): dueWithinDays / overdue power the "Due ≤ 7d" and
  // "Overdue" list chips plus the dashboard "Closing this week" strip.
  // WHY this exact boundary matters: a bid due in 3 days must appear so a
  // lead can act on it; a bid due in 30 days must NOT appear in the 7-day
  // window, or the filter is worthless noise that hides real urgency.
  skipIfNoDb('GET /api/opportunities?dueWithinDays=7 returns near-term rows and excludes far-out ones', async () => {
    const suffix = randomUUID().slice(0, 8);
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 86_400_000);
    const in30Days = new Date(now.getTime() + 30 * 86_400_000);
    const yesterday = new Date(now.getTime() - 1 * 86_400_000);

    const [dueSoon, dueFar, overdue] = await prisma.$transaction([
      prisma.opportunity.create({
        data: {
          orgId: orgId!,
          code: `OP-DUE3-${suffix}`,
          customer: 'Due Window Test',
          name: 'Due in 3 days',
          stage: 's2_sent',
          probability: 40,
          dueDate: in3Days,
        },
      }),
      prisma.opportunity.create({
        data: {
          orgId: orgId!,
          code: `OP-DUE30-${suffix}`,
          customer: 'Due Window Test',
          name: 'Due in 30 days',
          stage: 's2_sent',
          probability: 40,
          dueDate: in30Days,
        },
      }),
      prisma.opportunity.create({
        data: {
          orgId: orgId!,
          code: `OP-OVERDUE-${suffix}`,
          customer: 'Due Window Test',
          name: 'Overdue yesterday',
          stage: 's2_sent',
          probability: 40,
          dueDate: yesterday,
        },
      }),
    ]);

    try {
      const withinRes = await server.inject({
        method: 'GET',
        url: '/api/opportunities?dueWithinDays=7&limit=100',
      });
      expect(withinRes.statusCode).toBe(200);
      const withinIds = withinRes.json<{ items: Array<{ id: string }> }>().items.map((i) => i.id);
      expect(withinIds).toContain(dueSoon.id);
      expect(withinIds).not.toContain(dueFar.id);
      // Overdue rows are strictly before the window's start (today), not
      // inside [today, today+7] — they must not leak into the "due soon" list.
      expect(withinIds).not.toContain(overdue.id);

      const overdueRes = await server.inject({
        method: 'GET',
        url: '/api/opportunities?overdue=true&limit=100',
      });
      expect(overdueRes.statusCode).toBe(200);
      const overdueIds = overdueRes.json<{ items: Array<{ id: string }> }>().items.map((i) => i.id);
      expect(overdueIds).toContain(overdue.id);
      expect(overdueIds).not.toContain(dueSoon.id);
      expect(overdueIds).not.toContain(dueFar.id);
    } finally {
      await prisma.opportunity.deleteMany({
        where: { id: { in: [dueSoon.id, dueFar.id, overdue.id] } },
      });
    }
  });
});

describe('contacts + tasks + reports routes', () => {
  skipIfNoDb('GET /api/contacts returns seeded contacts', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/contacts' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });

  skipIfNoDb('GET /api/tasks returns seeded tasks', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
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
});
