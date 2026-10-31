import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// Task 4: closedAt is maintained by a DB trigger for every writer, and
// contracts / project references link to a company from their accountKey.

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    return;
  }
  const org = await createIsolatedOrg('close-dates');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('opportunity close dates', () => {
  skipIfNoDb('stamps closedAt on entering a closed stage, clears it on reopening', async () => {
    const company = await prisma.company.create({ data: { orgId: orgId!, name: `Close Co ${Date.now()}` } });
    const opp = await prisma.opportunity.create({
      data: { orgId: orgId!, code: `OP-${Date.now() % 100000}`, customer: company.name, companyId: company.id, name: 'Close test', stage: 's2_sent' },
    });
    expect(opp.closedAt).toBeNull();

    const before = Date.now();
    const won = await prisma.opportunity.update({ where: { id: opp.id }, data: { stage: 'closed_won' } });
    expect(won.closedAt).not.toBeNull();
    expect(won.closedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);

    // Editing something else keeps the stamp.
    const renamed = await prisma.opportunity.update({ where: { id: opp.id }, data: { name: 'Renamed', stage: 'closed_won' } });
    expect(renamed.closedAt?.toISOString()).toBe(won.closedAt!.toISOString());

    // A writer may record an explicit close date.
    const explicit = new Date('2026-03-15T00:00:00.000Z');
    const set = await prisma.opportunity.update({ where: { id: opp.id }, data: { closedAt: explicit } });
    expect(set.closedAt?.toISOString()).toBe(explicit.toISOString());

    const reopened = await prisma.opportunity.update({ where: { id: opp.id }, data: { stage: 's4_negotiation' } });
    expect(reopened.closedAt).toBeNull();

    // The account watchdog reports the real close date, not updatedAt.
    await prisma.opportunity.update({ where: { id: opp.id }, data: { stage: 'closed_lost', closedAt: explicit } });
    const res = await server.inject({ method: 'GET', url: `/api/v1/accounts/${company.id}/watchdog` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pastProjects: Array<{ id: string; outcome: string; closedAt: string }> };
    const row = body.pastProjects.find((p) => p.id === opp.id);
    expect(row).toMatchObject({ outcome: 'lost', closedAt: explicit.toISOString() });

    // And the opportunities list carries it for the charts.
    const list = await server.inject({ method: 'GET', url: `/api/v1/opportunities?limit=100` });
    expect(list.statusCode).toBe(200);
    const item = (list.json() as { items: Array<{ id: string; closedAt?: string | null }> }).items.find((i) => i.id === opp.id);
    if (item) expect(item.closedAt).toBe(explicit.toISOString());
  });
});

describe('account links for contracts and project references', () => {
  skipIfNoDb('resolves companyId from an unambiguous accountKey (id, name or slug)', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { orgId: orgId! }, orderBy: { createdAt: 'asc' } });
    const name = `Link Holdings ${Date.now()}`;
    const company = await prisma.company.create({ data: { orgId: orgId!, name } });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const byName = await prisma.contractAgreement.create({
      data: { orgId: orgId!, accountKey: name.toUpperCase(), reference: 'MSA-1', createdById: admin.id },
    });
    expect(byName.companyId).toBe(company.id);

    const bySlug = await prisma.projectReference.create({ data: { orgId: orgId!, accountKey: slug, title: 'Ref' } });
    expect(bySlug.companyId).toBe(company.id);

    const byId = await prisma.projectReference.create({ data: { orgId: orgId!, accountKey: company.id, title: 'Ref 2' } });
    expect(byId.companyId).toBe(company.id);

    const unknown = await prisma.contractAgreement.create({
      data: { orgId: orgId!, accountKey: 'nobody-at-all', reference: 'MSA-2', createdById: admin.id },
    });
    expect(unknown.companyId).toBeNull();

    // Ambiguous names never link.
    await prisma.company.create({ data: { orgId: orgId!, name: name.toLowerCase() } });
    const ambiguous = await prisma.contractAgreement.update({ where: { id: byName.id }, data: { accountKey: name } });
    expect(ambiguous.companyId).toBeNull();
  });
});
