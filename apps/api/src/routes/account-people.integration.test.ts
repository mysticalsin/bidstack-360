// Why these rows exist: a job title is not evidence, a customer promise is
// not an internal follow-up, and a second tenant must not see the first
// tenant's people.

import { afterAll, beforeAll, describe, expect } from 'vitest';

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
let restoreAuth: (() => void) | null = null;
const orgIds: string[] = [];

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
  if (restoreAuth) restoreAuth();
  for (const orgId of orgIds) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('account people map and commitments', () => {
  skipIfNoDb('a person with no evidence stays unknown, even with a senior title', async () => {
    const org = await createIsolatedOrg('people-unknown');
    orgIds.push(org.orgId);
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const company = await prisma.company.create({
      data: { orgId: org.orgId, name: 'Unknown Co' },
      select: { id: true },
    });
    await prisma.contact.create({
      data: {
        orgId: org.orgId,
        companyId: company.id,
        customer: 'Unknown Co',
        name: 'Ada Lovelace',
        role: 'Chief Executive Officer',
      },
    });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${company.id}/people-map`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      people: Array<{ name: string; title: string | null; standing: string; reportsToContactId: string | null }>;
    };
    expect(body.people).toHaveLength(1);
    expect(body.people[0]).toMatchObject({
      name: 'Ada Lovelace',
      title: 'Chief Executive Officer',
      standing: 'unknown',
      reportsToContactId: null,
    });
  });

  skipIfNoDb('a customer commitment is not returned as an internal task', async () => {
    const org = await createIsolatedOrg('people-commit');
    orgIds.push(org.orgId);
    restoreAuth?.();
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const company = await prisma.company.create({
      data: { orgId: org.orgId, name: 'Promise Co' },
      select: { id: true },
    });
    await prisma.task.create({
      data: {
        orgId: org.orgId,
        accountId: company.id,
        title: 'Send the deck',
        status: 'open',
      },
    });
    const created = await server.inject({
      method: 'POST',
      url: `/api/v1/companies/${company.id}/commitments`,
      payload: { promise: 'Customer will sign the statement of work', dueDate: '2026-11-15' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ recordKind: 'customer_commitment' });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${company.id}/commitments`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      commitments: Array<{ recordKind: string; promise: string }>;
      internalTasks: Array<{ recordKind: string; title: string }>;
    };
    expect(body.commitments.map((row) => row.promise)).toEqual([
      'Customer will sign the statement of work',
    ]);
    expect(body.commitments.every((row) => row.recordKind === 'customer_commitment')).toBe(true);
    expect(body.internalTasks.map((row) => row.title)).toContain('Send the deck');
    expect(body.internalTasks.every((row) => row.recordKind === 'internal_task')).toBe(true);
    expect(body.commitments.some((row) => 'title' in row)).toBe(false);
  });

  skipIfNoDb('a second tenant cannot read the first tenant people', async () => {
    const first = await createIsolatedOrg('people-a');
    const second = await createIsolatedOrg('people-b');
    orgIds.push(first.orgId, second.orgId);
    restoreAuth?.();
    restoreAuth = useIsolatedOrgAuth(first.clerkOrg);
    const company = await prisma.company.create({
      data: { orgId: first.orgId, name: 'Tenant A Co' },
      select: { id: true },
    });
    await prisma.contact.create({
      data: {
        orgId: first.orgId,
        companyId: company.id,
        customer: 'Tenant A Co',
        name: 'Private Person',
        role: 'Buyer',
      },
    });

    process.env.BIDSTACK_STUB_ORG_CLERK = second.clerkOrg;
    const denied = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${company.id}/people-map`,
    });
    expect(denied.statusCode).toBe(404);

    const secondCompany = await prisma.company.create({
      data: { orgId: second.orgId, name: 'Tenant B Co' },
      select: { id: true },
    });
    const own = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${secondCompany.id}/people-map`,
    });
    expect(own.statusCode).toBe(200);
    const body = own.json() as { people: Array<{ name: string }> };
    expect(body.people.map((person) => person.name)).not.toContain('Private Person');
  });

  skipIfNoDb('ambiguous historical text is stored unlinked', async () => {
    const org = await createIsolatedOrg('people-review');
    orgIds.push(org.orgId);
    restoreAuth?.();
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const company = await prisma.company.create({
      data: { orgId: org.orgId, name: 'Review Co' },
      select: { id: true },
    });
    const contact = await prisma.contact.create({
      data: {
        orgId: org.orgId,
        companyId: company.id,
        customer: 'Review Co',
        name: 'Grace Hopper',
      },
      select: { id: true },
    });
    const other = await prisma.contact.create({
      data: {
        orgId: org.orgId,
        companyId: company.id,
        customer: 'Review Co',
        name: 'Someone Else',
      },
      select: { id: true },
    });
    const created = await server.inject({
      method: 'POST',
      url: `/api/v1/contacts/${contact.id}/facts`,
      payload: {
        kind: 'reports_to',
        claim: 'The senior stakeholder will decide',
        ambiguous: true,
        reportsToContactId: other.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'needs_review',
      reportsToContactId: null,
    });
    const stored = await prisma.contact.findFirst({
      where: { id: contact.id, orgId: org.orgId },
      select: { reportsToContactId: true },
    });
    expect(stored?.reportsToContactId).toBeNull();
  });
});
