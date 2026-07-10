import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest';

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
const createdCompanyIds: string[] = [];
const auditIds: bigint[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }

  const org = await createIsolatedOrg('companies');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  server = await buildServer();
  await server.ready();
}, 30_000);

afterEach(async () => {
  if (!dbReachable) return;
  if (auditIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
    auditIds.length = 0;
  }
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    createdCompanyIds.length = 0;
  }
});

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('companies routes', () => {
  skipIfNoDb(
    'writes rich company CRUD audit rows without duplicate generic request rows',
    async () => {
      const startedAt = new Date();
      const suffix = randomUUID().slice(0, 8);
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/companies',
        payload: {
          name: `Audit Company ${suffix}`,
          legalName: `Audit Company ${suffix} LLC`,
          domain: `audit-${suffix}.example.com`,
          industry: 'Professional Services',
          employeeCount: 120,
          countryCode: 'US',
          address: null,
          billingEmail: `billing-${suffix}@example.com`,
          taxId: 'TAX-OLD',
          logoUrl: null,
          website: `https://audit-${suffix}.example.com`,
          tier: 'standard',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const companyId = createRes.json<{ id: string }>().id;
      createdCompanyIds.push(companyId);

      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/companies/${companyId}`,
        payload: {
          industry: 'Technology',
          employeeCount: 180,
          taxId: 'NEW-TAX-ID',
        },
      });
      expect(patchRes.statusCode).toBe(200);

      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/companies/${companyId}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      const audits = await prisma.auditLog.findMany({
        where: {
          orgId: orgId!,
          targetType: 'company',
          targetId: companyId,
          at: { gte: startedAt },
        },
        orderBy: { id: 'asc' },
      });
      auditIds.push(...audits.map((audit) => audit.id));

      expect(audits.map((audit) => audit.action)).toEqual([
        'company.create',
        'company.update',
        'company.delete',
      ]);

      const updateDiff = audits.find((audit) => audit.action === 'company.update')?.diff as
        | Record<string, unknown>
        | undefined;
      expect(updateDiff).toBeTruthy();
      expect(updateDiff).toMatchObject({
        actorKind: 'user',
        changedFields: expect.arrayContaining(['industry', 'employeeCount', 'taxId']),
        changes: {
          industry: { from: 'Professional Services', to: 'Technology' },
          employeeCount: { from: 120, to: 180 },
          taxId: { changed: true },
        },
      });
      expect(JSON.stringify(updateDiff)).not.toContain('NEW-TAX-ID');

      const genericRows = await prisma.auditLog.findMany({
        where: {
          orgId: orgId!,
          action: 'http.mutation.success',
          at: { gte: startedAt },
          OR: [
            { diff: { path: ['path'], equals: '/api/v1/companies' } },
            { diff: { path: ['path'], equals: `/api/v1/companies/${companyId}` } },
          ],
        },
        select: { id: true },
      });
      auditIds.push(...genericRows.map((audit) => audit.id));
      expect(genericRows).toHaveLength(0);
    },
  );

  skipIfNoDb(
    'hierarchy endpoint terminates on a pre-existing parentId cycle instead of hanging',
    async () => {
      // WHY: parentId has no DB-level acyclicity constraint, so a corrupt
      // A<->B cycle is representable. Without a visited-set guard the ancestor
      // while-loop spins forever (and buildTree stack-overflows), blocking the
      // single Node event-loop thread for every tenant on the process. The
      // endpoint must return instead of hanging.
      const suffix = randomUUID().slice(0, 8);
      const a = await prisma.company.create({
        data: { orgId: orgId!, name: `Cycle A ${suffix}` },
        select: { id: true },
      });
      const b = await prisma.company.create({
        data: { orgId: orgId!, name: `Cycle B ${suffix}`, parentId: a.id },
        select: { id: true },
      });
      // Close the loop: A points back at B.
      await prisma.company.update({ where: { id: a.id }, data: { parentId: b.id } });
      createdCompanyIds.push(a.id, b.id);

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/companies/${a.id}/hierarchy`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        ancestors: Array<{ id: string }>;
        tree: { children: unknown[] };
      }>();
      // The ancestor walk broke at the cycle rather than accumulating forever.
      expect(body.ancestors.length).toBeLessThanOrEqual(2);
      // buildTree placed each node at most once — no runaway recursion.
      expect(Array.isArray(body.tree.children)).toBe(true);
    },
  );

  skipIfNoDb(
    'cursor pagination covers every row across pages — no gap, no overlap',
    async () => {
      // WHY: nextCursor must be the id of the LAST row the client actually
      // received, not the discarded look-ahead probe row. When the cursor
      // points at the probe, the next query (cursor + skip: 1) starts strictly
      // AFTER a row that was never returned — silently and permanently hiding
      // one company per page boundary from every org's Companies list.
      const suffix = randomUUID().slice(0, 8);
      const base = Date.now();
      const created = await Promise.all(
        [0, 1, 2, 3].map((i) =>
          prisma.company.create({
            data: {
              orgId: orgId!,
              name: `Cursor Page ${suffix} ${i}`,
              // Distinct createdAt per row keeps the createdAt-desc ordering
              // deterministic so the page boundary always falls between row 2
              // and row 3.
              createdAt: new Date(base - i * 60_000),
            },
            select: { id: true },
          }),
        ),
      );
      createdCompanyIds.push(...created.map((c) => c.id));

      const page1 = await server.inject({
        method: 'GET',
        url: `/api/v1/companies?search=${suffix}&limit=3`,
      });
      expect(page1.statusCode).toBe(200);
      const page1Body = page1.json<{ items: Array<{ id: string }>; nextCursor?: string }>();
      expect(page1Body.items).toHaveLength(3);
      expect(page1Body.nextCursor).toBe(page1Body.items[2]!.id);

      const page2 = await server.inject({
        method: 'GET',
        url: `/api/v1/companies?search=${suffix}&limit=3&cursor=${page1Body.nextCursor}`,
      });
      expect(page2.statusCode).toBe(200);
      const page2Body = page2.json<{ items: Array<{ id: string }>; nextCursor?: string }>();
      expect(page2Body.nextCursor).toBeUndefined();

      const seen = [...page1Body.items, ...page2Body.items].map((c) => c.id);
      expect(new Set(seen).size).toBe(seen.length); // no overlap
      expect(new Set(seen)).toEqual(new Set(created.map((c) => c.id))); // no gap
    },
  );
});
