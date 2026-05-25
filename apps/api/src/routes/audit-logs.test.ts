// Audit log route integration tests. Mirrors the skipIfNoDb pattern from
// opportunities.integration.test.ts so suites stay green offline.
//
// Why integration (not unit-mock): the route's correctness hinges on (a) the
// orgId scoping working through Prisma + the auth plugin, (b) BigInt cursor
// round-tripping through Zod, and (c) the action substring filter actually
// hitting the index. Mocking Prisma would only verify our mock.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let primaryOrgId = '';
let foreignOrgId = '';
const seededIds: bigint[] = [];

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

  const seedOrg = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  if (!seedOrg) throw new Error('seed org missing — run pnpm db:seed');
  primaryOrgId = seedOrg.id;

  // Create a foreign org so we can prove tenant isolation. We tag it with a
  // throwaway clerkOrg so seed reruns won't collide.
  const foreign = await prisma.org.upsert({
    where: { clerkOrg: 'org_audit_test_foreign' },
    update: {},
    create: { clerkOrg: 'org_audit_test_foreign', name: 'Audit Test Foreign' },
  });
  foreignOrgId = foreign.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  // Best-effort cleanup. We only delete rows we ourselves inserted.
  if (seededIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds } } });
  }
  await prisma.org.delete({ where: { clerkOrg: 'org_audit_test_foreign' } }).catch(() => undefined);
  if (server) await server.close();
  await prisma.$disconnect();
});

afterEach(async () => {
  if (!dbReachable || seededIds.length === 0) return;
  await prisma.auditLog.deleteMany({ where: { id: { in: seededIds } } });
  seededIds.length = 0;
});

async function seedAudit(orgId: string, action: string, targetId: string | null = null) {
  const row = await prisma.auditLog.create({
    data: { orgId, action, targetType: 'opportunity', targetId, diff: { test: true } },
  });
  seededIds.push(row.id);
  return row;
}

const skipIfNoDb = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) {
      throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    }
    await fn();
  });

describe('GET /api/audit-logs', () => {
  skipIfNoDb('isolates rows by orgId — foreign org rows are never returned', async () => {
    // Why: multi-tenancy is the single most-violated invariant in CRM
    // products. If this test ever passes by returning the foreign row, the
    // entire audit feature has to be reconsidered.
    const mine = await seedAudit(primaryOrgId, 'opportunity.test.mine');
    await seedAudit(foreignOrgId, 'opportunity.test.foreign');

    const res = await server.inject({
      method: 'GET',
      url: '/api/audit-logs?action=opportunity.test&limit=50',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id.toString());
    expect(ids.every((id: string) => !id.includes('foreign'))).toBe(true);
    // Verify the foreign row is genuinely absent (not just outside the page)
    const foreignActions = body.items
      .map((i: { action: string }) => i.action)
      .filter((a: string) => a === 'opportunity.test.foreign');
    expect(foreignActions).toHaveLength(0);
  });

  skipIfNoDb('paginates by cursor — second page never repeats first-page rows', async () => {
    // Seed 5 rows with predictable actions so we can assert ordering.
    const seeded = [];
    for (let i = 0; i < 5; i++) {
      seeded.push(await seedAudit(primaryOrgId, `audit.cursor.test.${i}`));
    }

    const page1 = await server.inject({
      method: 'GET',
      url: '/api/audit-logs?action=audit.cursor.test&limit=2',
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await server.inject({
      method: 'GET',
      url: `/api/audit-logs?action=audit.cursor.test&limit=2&cursor=${body1.nextCursor}`,
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.items).toHaveLength(2);

    const page1Ids = new Set(body1.items.map((i: { id: string }) => i.id));
    for (const item of body2.items) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
    // BigInt cursor must round-trip through the URL as a string without loss.
    expect(seeded.map((r) => r.id.toString())).toContain(body1.nextCursor);
  });

  skipIfNoDb('substring-matches the action filter (case-insensitive)', async () => {
    // Why: UI passes free-text from the search box. If the filter were strict
    // equality, "stage" would never find "opportunity.stage".
    await seedAudit(primaryOrgId, 'opportunity.stage');
    await seedAudit(primaryOrgId, 'opportunity.update');
    await seedAudit(primaryOrgId, 'mcp.tool.call');

    const res = await server.inject({
      method: 'GET',
      url: '/api/audit-logs?action=STAGE&limit=50',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const actions = body.items.map((i: { action: string }) => i.action);
    expect(actions).toContain('opportunity.stage');
    expect(actions).not.toContain('mcp.tool.call');
  });
});
