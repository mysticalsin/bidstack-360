import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

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
});

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

const skipIfNoDb = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL or isolated org not reachable`);
    }
    await fn();
  });

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
});
