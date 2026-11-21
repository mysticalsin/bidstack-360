// Soft-deleting a company leaves opportunities.company_id pointing at the
// tombstone. The deal detail does not join the company, so rollups that key
// on company_id still attribute the deal to a deleted account.
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
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

describe('company delete clears opportunity company links', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('harbor-co-del');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    server = await buildServer();
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('deleting a company drops companyId on live and tombstoned deals', async () => {
    const suffix = randomUUID().slice(0, 8);
    const company = await prisma.company.create({
      data: { orgId: orgId!, name: `Harbor Synthetic Co ${suffix}` },
      select: { id: true },
    });
    const other = await prisma.company.create({
      data: { orgId: orgId!, name: `Harbor Other Synthetic ${suffix}` },
      select: { id: true },
    });
    const live = await prisma.opportunity.create({
      data: {
        orgId: orgId!,
        code: `OP-L${suffix}`,
        customer: 'Harbor Synthetic Co',
        name: `Live deal ${suffix}`,
        stage: 's1_lead',
        valueMicros: 1_000_000n,
        probability: 10,
        industry: 'logistics',
        companyId: company.id,
      },
      select: { id: true },
    });
    const tombstoned = await prisma.opportunity.create({
      data: {
        orgId: orgId!,
        code: `OP-T${suffix}`,
        customer: 'Harbor Synthetic Co',
        name: `Deleted deal ${suffix}`,
        stage: 's1_lead',
        valueMicros: 1_000_000n,
        probability: 10,
        industry: 'logistics',
        companyId: company.id,
      },
      select: { id: true },
    });
    await prisma.opportunity.update({
      where: { id: tombstoned.id },
      data: { deletedAt: new Date() },
    });
    const kept = await prisma.opportunity.create({
      data: {
        orgId: orgId!,
        code: `OP-K${suffix}`,
        customer: 'Harbor Other Synthetic',
        name: `Kept deal ${suffix}`,
        stage: 's1_lead',
        valueMicros: 1_000_000n,
        probability: 10,
        industry: 'logistics',
        companyId: other.id,
      },
      select: { id: true },
    });

    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${company.id}`,
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const [liveRow, tombstoneRow, keptRow] = await Promise.all([
      prisma.opportunity.findFirst({
        where: { id: live.id, deletedAt: null },
        select: { companyId: true },
      }),
      prisma.opportunity.findFirst({
        where: { id: tombstoned.id, deletedAt: { not: null } },
        select: { companyId: true },
      }),
      prisma.opportunity.findFirst({
        where: { id: kept.id, deletedAt: null },
        select: { companyId: true },
      }),
    ]);
    expect(liveRow?.companyId).toBeNull();
    expect(tombstoneRow?.companyId).toBeNull();
    expect(keptRow?.companyId).toBe(other.id);
  });
});
