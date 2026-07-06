import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, beforeAll, afterAll } from 'vitest';

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
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdIds = {
  opportunities: [] as string[],
  tasks: [] as string[],
  auditLogs: [] as bigint[],
  activities: [] as string[],
};
let foreignOrgId: string | null = null;

describe('opportunity timeline', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
      const org = await createIsolatedOrg('opportunity-timeline');
      orgId = org.orgId;
      restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    } catch {
      dbReachable = false;
    }
    server = await buildServer();
  });

  afterAll(async () => {
    if (dbReachable) {
      await prisma.activity.deleteMany({ where: { id: { in: createdIds.activities } } });
      await prisma.auditLog.deleteMany({ where: { id: { in: createdIds.auditLogs } } });
      await prisma.task.deleteMany({ where: { id: { in: createdIds.tasks } } });
      await prisma.opportunity.deleteMany({ where: { id: { in: createdIds.opportunities } } });
    }
    await server.close();
    if (restoreAuth) restoreAuth();
    if (orgId) await dropIsolatedOrg(orgId);
    // Foreign-org rows cascade with the org row itself.
    if (foreignOrgId) await dropIsolatedOrg(foreignOrgId);
    if (dbReachable) await prisma.$disconnect();
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('returns 404 for an opportunity that does not exist', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/opportunities/00000000-0000-0000-0000-000000000000/timeline',
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('returns timeline items for an existing opportunity', async () => {
    if (!orgId) throw new Error('isolated org missing');
    const code = `TL-${crypto.randomUUID().slice(0, 8)}`;
    const opportunity = await prisma.opportunity.create({
      data: {
        orgId,
        code,
        customer: 'timeline-test',
        name: 'Timeline Test Opportunity',
        stage: 's1_lead',
      },
    });
    createdIds.opportunities.push(opportunity.id);

    const task = await prisma.task.create({
      data: {
        orgId,
        oppId: opportunity.id,
        title: 'Timeline follow-up',
        status: 'open',
      },
    });
    createdIds.tasks.push(task.id);

    const auditLog = await prisma.auditLog.create({
      data: {
        orgId,
        action: 'opportunity.create',
        targetType: 'opportunity',
        targetId: opportunity.id,
        diff: { code },
      },
    });
    createdIds.auditLogs.push(auditLog.id);

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opportunity.id}/timeline`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'audit', text: expect.stringContaining(code) }),
        expect.objectContaining({ kind: 'task', text: 'Task created: Timeline follow-up' }),
      ]),
    );
  });

  // WHY: the Activity chatter model (calls/emails/notes/stage events) was
  // built in parallel with the timeline and never merged — the deal narrative
  // silently omitted everything logged through /activities. This pins the
  // merge: typed entries, actor resolution, occurredAt ordering, soft-delete.
  skipIfNoDb('merges Activity chatter rows into the timeline as typed entries', async () => {
    if (!orgId) throw new Error('isolated org missing');
    const opportunity = await prisma.opportunity.create({
      data: {
        orgId,
        code: `TLA-${crypto.randomUUID().slice(0, 8)}`,
        customer: 'timeline-activity-test',
        name: 'Timeline Activity Merge',
        stage: 's1_lead',
      },
    });
    createdIds.opportunities.push(opportunity.id);

    // Seeded admin is created first, so this is the stub-auth user too.
    const owner = await prisma.user.findFirstOrThrow({
      where: { orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });

    const call = await prisma.activity.create({
      data: {
        orgId,
        type: 'call',
        subject: 'Intro call with CTO',
        entityType: 'opportunity',
        entityId: opportunity.id,
        ownerId: owner.id,
        actorId: owner.id,
        actorType: 'user',
        status: 'completed',
        occurredAt: new Date('2026-07-01T10:00:00.000Z'),
      },
    });
    const note = await prisma.activity.create({
      data: {
        orgId,
        type: 'note',
        description: 'Budget confirmed at steering committee',
        entityType: 'opportunity',
        entityId: opportunity.id,
        actorType: 'system',
        status: 'completed',
        occurredAt: new Date('2026-07-02T10:00:00.000Z'),
      },
    });
    const ghost = await prisma.activity.create({
      data: {
        orgId,
        type: 'email',
        subject: 'GHOST soft-deleted email',
        entityType: 'opportunity',
        entityId: opportunity.id,
        deletedAt: new Date(),
        occurredAt: new Date('2026-07-03T10:00:00.000Z'),
      },
    });
    createdIds.activities.push(call.id, note.id, ghost.id);

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opportunity.id}/timeline`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: Array<{ id: string; kind: string; text: string; actorName: string | null; createdAt: string }>;
    };

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'call',
          text: 'Intro call with CTO',
          actorName: owner.name,
          createdAt: '2026-07-01T10:00:00.000Z',
        }),
        expect.objectContaining({
          kind: 'note',
          text: 'Budget confirmed at steering committee',
          actorName: null,
        }),
      ]),
    );
    // Soft-deleted chatter must stay invisible.
    expect(body.items.some((i) => i.text.includes('GHOST'))).toBe(false);
    // Merged feed stays newest-first (occurredAt drives activity ordering).
    const times = body.items.map((i) => new Date(i.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  // WHY: the activity query is polymorphic (entityType/entityId) — without the
  // orgId predicate a foreign org's activity attached to the same entityId
  // would leak straight into this org's deal narrative. Regression-pins
  // multi-tenant scoping and same-org/other-entity isolation.
  skipIfNoDb('never leaks activities from another org or another entity', async () => {
    if (!orgId) throw new Error('isolated org missing');
    const opportunity = await prisma.opportunity.create({
      data: {
        orgId,
        code: `TLX-${crypto.randomUUID().slice(0, 8)}`,
        customer: 'timeline-scope-test',
        name: 'Timeline Scope Guard',
        stage: 's1_lead',
      },
    });
    const otherOpp = await prisma.opportunity.create({
      data: {
        orgId,
        code: `TLY-${crypto.randomUUID().slice(0, 8)}`,
        customer: 'timeline-scope-test',
        name: 'Timeline Scope Other',
        stage: 's1_lead',
      },
    });
    createdIds.opportunities.push(opportunity.id, otherOpp.id);

    // Bare foreign org — no seeding needed, we only attach a hostile row to it.
    const foreignOrg = await prisma.org.create({
      data: {
        clerkOrg: `org_tl_foreign_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        name: 'Timeline Foreign Org',
      },
    });
    foreignOrgId = foreignOrg.id;

    // Same entityId, different org — the exact cross-tenant leak shape.
    await prisma.activity.create({
      data: {
        orgId: foreignOrg.id,
        type: 'call',
        subject: 'FOREIGN-ORG call must not leak',
        entityType: 'opportunity',
        entityId: opportunity.id,
      },
    });
    // Same org, different opportunity — must not bleed across records.
    const sibling = await prisma.activity.create({
      data: {
        orgId,
        type: 'note',
        subject: 'OTHER-OPP note must not leak',
        entityType: 'opportunity',
        entityId: otherOpp.id,
      },
    });
    createdIds.activities.push(sibling.id);

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opportunity.id}/timeline`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: Array<{ text: string }> };
    expect(body.items.some((i) => i.text.includes('FOREIGN-ORG'))).toBe(false);
    expect(body.items.some((i) => i.text.includes('OTHER-OPP'))).toBe(false);
  });

  // WHY: the timeline exposes audit-log diffs, comment bodies, and chatter for
  // an opportunity, so it must gate on `opportunities:read` like every sibling
  // read route (calendar-deadlines.ts, win-loss.ts). Without the preHandler any
  // authenticated actor lacking the grant could read the deal's full history.
  // An API key scoped to `write` only stands in for a caller without read.
  skipIfNoDb('rejects a caller lacking opportunities:read with 403', async () => {
    if (!orgId) throw new Error('isolated org missing');
    const opportunity = await prisma.opportunity.create({
      data: {
        orgId,
        code: `TLR-${randomUUID().slice(0, 8)}`,
        customer: 'timeline-rbac-test',
        name: 'Timeline RBAC Guard',
        stage: 's1_lead',
      },
    });
    createdIds.opportunities.push(opportunity.id);

    const rawKey = `tl_write_only_${randomUUID()}`;
    const writeOnlyKey = await prisma.apiKey.create({
      data: {
        orgId,
        name: 'timeline write-only key',
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        prefix: rawKey.slice(0, 8),
        scopes: ['write'],
      },
    });
    try {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/opportunities/${opportunity.id}/timeline`,
        headers: { 'x-api-key': rawKey },
      });
      // 403 (not 404): the permission gate runs in the preHandler, before the
      // handler's existence check — an unauthorized caller must not even learn
      // whether the opportunity exists.
      expect(res.statusCode).toBe(403);
    } finally {
      await prisma.apiKey.deleteMany({ where: { id: writeOnlyKey.id } });
    }
  });

  // WHY: complements the 403 case — a caller that DOES hold `opportunities:read`
  // reaches the handler and gets 200, proving the gate authorizes rather than
  // blanket-denies. An API key scoped to the exact permission is the read grant.
  skipIfNoDb('allows a caller with opportunities:read through with 200', async () => {
    if (!orgId) throw new Error('isolated org missing');
    const opportunity = await prisma.opportunity.create({
      data: {
        orgId,
        code: `TLP-${randomUUID().slice(0, 8)}`,
        customer: 'timeline-rbac-test',
        name: 'Timeline RBAC Permit',
        stage: 's1_lead',
      },
    });
    createdIds.opportunities.push(opportunity.id);

    const rawKey = `tl_read_${randomUUID()}`;
    const readKey = await prisma.apiKey.create({
      data: {
        orgId,
        name: 'timeline read key',
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        prefix: rawKey.slice(0, 8),
        scopes: ['opportunities:read'],
      },
    });
    try {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/opportunities/${opportunity.id}/timeline`,
        headers: { 'x-api-key': rawKey },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await prisma.apiKey.deleteMany({ where: { id: readKey.id } });
    }
  });
});
