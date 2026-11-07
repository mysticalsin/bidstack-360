// Review swarm, accounts section: contacts, leads, companies, territories,
// accounts and search. Happy path, validation 400, RBAC 403, tenant isolation
// (other org gets 404), pagination bounds and idempotent retries, plus one
// regression case per bug fixed in this section.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgA: IsolatedOrg | null = null;
let orgB: IsolatedOrg | null = null;
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;

const READ_ONLY = { 'x-bidstack-e2e-role': 'read-only' };
const SDR = { 'x-bidstack-e2e-role': 'sdr' };
const tag = randomUUID().slice(0, 8);

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('acctrev');
  orgB = await createIsolatedOrg('acctrevb');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  if (server) await server.close();
  if (orgA) await dropIsolatedOrg(orgA.orgId);
  if (orgB) await dropIsolatedOrg(orgB.orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgA && !!orgB);

async function adminUserId(orgId: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({
    where: { orgId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return user.id;
}

async function otherUserId(orgId: string, notId: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({
    where: { orgId, deletedAt: null, id: { not: notId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return user.id;
}

async function foreignDefinition(entityType: string): Promise<string> {
  const def = await prisma.customFieldDefinition.create({
    data: {
      orgId: orgB!.orgId,
      entityType,
      fieldKey: `foreign_${entityType}_${tag}`,
      label: 'Foreign field',
      fieldType: 'text',
    },
    select: { id: true },
  });
  return def.id;
}

async function createLead(payload: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/leads',
    payload: {
      firstName: 'Review',
      lastName: `Lead ${tag}`,
      companyName: `Review Co ${tag}`,
      source: 'website',
      priority: 'medium',
      score: 10,
      ...payload,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

describe('leads', () => {
  skipIfNoDb('PATCH ownerId reassigns the lead to another org user', async () => {
    const lead = await createLead();
    const admin = await adminUserId(orgA!.orgId);
    const other = await otherUserId(orgA!.orgId, admin);
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { ownerId: other },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ownerId).toBe(other);

    const cleared = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { ownerId: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().ownerId).toBeNull();
  });

  skipIfNoDb('PATCH status moves statusChangedAt; other fields do not', async () => {
    const lead = await createLead();
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    await new Promise((r) => setTimeout(r, 20));
    const notes = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { notes: 'no status change' },
    });
    expect(notes.statusCode).toBe(200);
    expect(notes.json().statusChangedAt).toBe(before.statusChangedAt.toISOString());

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { status: 'contacted' },
    });
    expect(res.statusCode).toBe(200);
    expect(new Date(res.json().statusChangedAt).getTime()).toBeGreaterThan(
      before.statusChangedAt.getTime(),
    );
  });

  skipIfNoDb('PATCH cannot set or leave the converted status', async () => {
    const lead = await createLead();
    const toConverted = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { status: 'converted' },
    });
    expect(toConverted.statusCode).toBe(400);

    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'converted' } });
    const reopen = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { status: 'new' },
    });
    expect(reopen.statusCode).toBe(409);
  });

  skipIfNoDb('PATCH rejects a custom field definition from another org', async () => {
    const lead = await createLead();
    const defId = await foreignDefinition('lead');
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { customFieldValues: [{ definitionId: defId, value: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    const leaked = await prisma.customFieldValue.count({ where: { definitionId: defId } });
    expect(leaked).toBe(0);
  });

  skipIfNoDb('validation, RBAC, tenant isolation and pagination bounds', async () => {
    const bad = await server.inject({
      method: 'POST',
      url: '/api/leads',
      payload: { firstName: '', lastName: 'x', companyName: 'x' },
    });
    expect(bad.statusCode).toBe(400);

    const lead = await createLead();
    const denied = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      headers: READ_ONLY,
      payload: { notes: 'nope' },
    });
    expect(denied.statusCode).toBe(403);

    const foreign = await prisma.lead.findFirstOrThrow({
      where: { orgId: orgB!.orgId, deletedAt: null },
      select: { id: true },
    });
    expect((await server.inject({ method: 'GET', url: `/api/leads/${foreign.id}` })).statusCode).toBe(404);
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/leads/${foreign.id}`,
          payload: { notes: 'cross-tenant' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await server.inject({ method: 'DELETE', url: `/api/leads/${foreign.id}` })).statusCode).toBe(404);

    expect((await server.inject({ method: 'GET', url: '/api/leads?limit=0' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/leads?limit=101' })).statusCode).toBe(400);

    const first = await server.inject({ method: 'GET', url: '/api/leads?limit=2' });
    expect(first.statusCode).toBe(200);
    const page1 = first.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(page1.items.length).toBeLessThanOrEqual(2);
    if (page1.nextCursor) {
      const second = await server.inject({
        method: 'GET',
        url: `/api/leads?limit=2&cursor=${page1.nextCursor}`,
      });
      const ids2 = (second.json() as { items: Array<{ id: string }> }).items.map((l) => l.id);
      for (const l of page1.items) expect(ids2).not.toContain(l.id);
    }
  });

  skipIfNoDb('DELETE retried returns 404, PATCH retried is stable', async () => {
    const lead = await createLead();
    const patch1 = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { priority: 'high' },
    });
    const patch2 = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${lead.id}`,
      payload: { priority: 'high' },
    });
    expect(patch1.statusCode).toBe(200);
    expect(patch2.statusCode).toBe(200);
    expect(patch2.json().priority).toBe('high');
    expect((await server.inject({ method: 'DELETE', url: `/api/leads/${lead.id}` })).statusCode).toBe(204);
    expect((await server.inject({ method: 'DELETE', url: `/api/leads/${lead.id}` })).statusCode).toBe(404);
  });

  skipIfNoDb('bulk delete of a full page is not rate limited to 10', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const row = await prisma.lead.create({
        data: {
          orgId: orgA!.orgId,
          firstName: 'Bulk',
          lastName: `${i} ${tag}`,
          companyName: `Bulk Co ${tag}`,
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    const codes: number[] = [];
    for (const id of ids) {
      codes.push((await server.inject({ method: 'DELETE', url: `/api/leads/${id}` })).statusCode);
    }
    expect(codes.every((c) => c === 204)).toBe(true);
  });
});

function contactPayload(fields: Record<string, unknown>): Record<string, unknown> {
  return { role: null, email: null, phone: null, influence: null, sentiment: null, ...fields };
}

describe('contacts', () => {
  skipIfNoDb('PATCH customer re-resolves the company link', async () => {
    const companies = await prisma.company.findMany({
      where: { orgId: orgA!.orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
      take: 2,
    });
    expect(companies.length).toBe(2);
    const [a, b] = companies as [{ id: string; name: string }, { id: string; name: string }];
    const created = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: contactPayload({ customer: a.name, companyId: a.id, name: `Relink ${tag}` }),
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const moved = await server.inject({
      method: 'PATCH',
      url: `/api/contacts/${id}`,
      payload: { customer: b.name },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ companyId: b.id, linkState: 'linked' });

    const unknown = await server.inject({
      method: 'PATCH',
      url: `/api/contacts/${id}`,
      payload: { customer: `No Such Company ${tag}` },
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toMatchObject({ companyId: null, linkState: 'needs_review' });

    const sameName = await server.inject({
      method: 'PATCH',
      url: `/api/contacts/${id}`,
      payload: { role: 'Buyer' },
    });
    expect(sameName.json()).toMatchObject({ companyId: null, role: 'Buyer' });
  });

  skipIfNoDb('PATCH rejects a custom field definition from another org', async () => {
    const contact = await prisma.contact.findFirstOrThrow({
      where: { orgId: orgA!.orgId, deletedAt: null },
      select: { id: true },
    });
    const defId = await foreignDefinition('contact');
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/contacts/${contact.id}`,
      payload: { customFieldValues: [{ definitionId: defId, value: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.customFieldValue.count({ where: { definitionId: defId } })).toBe(0);
  });

  skipIfNoDb('validation, RBAC, tenant isolation, pagination and retries', async () => {
    expect(
      (await server.inject({ method: 'POST', url: '/api/contacts', payload: { name: 'x' } })).statusCode,
    ).toBe(400);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/contacts',
          headers: READ_ONLY,
          payload: contactPayload({ customer: 'x', name: 'x' }),
        })
      ).statusCode,
    ).toBe(403);
    const foreign = await prisma.contact.findFirstOrThrow({
      where: { orgId: orgB!.orgId, deletedAt: null },
      select: { id: true },
    });
    expect((await server.inject({ method: 'GET', url: `/api/contacts/${foreign.id}` })).statusCode).toBe(404);
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/contacts/${foreign.id}`,
          payload: { role: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await server.inject({ method: 'GET', url: '/api/contacts?limit=0' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/contacts?limit=101' })).statusCode).toBe(400);

    const created = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: contactPayload({ customer: `Retry Co ${tag}`, name: `Retry ${tag}` }),
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect((await server.inject({ method: 'DELETE', url: `/api/contacts/${id}` })).statusCode).toBe(204);
    expect((await server.inject({ method: 'DELETE', url: `/api/contacts/${id}` })).statusCode).toBe(404);
  });
});

describe('companies', () => {
  skipIfNoDb('PATCH parentId terminates on a corrupt parent cycle', async () => {
    const [x, y, z] = await Promise.all(
      ['X', 'Y', 'Z'].map((n) =>
        prisma.company.create({
          data: { orgId: orgA!.orgId, name: `Cycle ${n} ${tag}` },
          select: { id: true },
        }),
      ),
    );
    await prisma.company.update({ where: { id: x!.id }, data: { parentId: y!.id } });
    await prisma.company.update({ where: { id: y!.id }, data: { parentId: x!.id } });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/companies/${z!.id}`,
      payload: { parentId: x!.id },
    });
    expect(res.statusCode).toBe(400);
  }, 20_000);

  skipIfNoDb('PATCH rejects a custom field definition from another org', async () => {
    const company = await prisma.company.findFirstOrThrow({
      where: { orgId: orgA!.orgId, deletedAt: null },
      select: { id: true },
    });
    const defId = await foreignDefinition('company');
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/companies/${company.id}`,
      payload: { customFieldValues: [{ definitionId: defId, value: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.customFieldValue.count({ where: { definitionId: defId } })).toBe(0);
  });

  skipIfNoDb('GET /companies/:id bounds the related contact list', async () => {
    const company = await prisma.company.create({
      data: { orgId: orgA!.orgId, name: `Big Account ${tag}` },
      select: { id: true, name: true },
    });
    await prisma.contact.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        orgId: orgA!.orgId,
        companyId: company.id,
        customer: company.name,
        name: `Person ${i}`,
      })),
    });
    const res = await server.inject({ method: 'GET', url: `/api/companies/${company.id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { contacts: unknown[] }).contacts.length).toBe(200);
  });

  skipIfNoDb('validation, RBAC, tenant isolation and pagination bounds', async () => {
    expect(
      (await server.inject({ method: 'POST', url: '/api/companies', payload: {} })).statusCode,
    ).toBe(400);
    const own = await prisma.company.findFirstOrThrow({
      where: { orgId: orgA!.orgId, deletedAt: null },
      select: { id: true },
    });
    expect(
      (
        await server.inject({
          method: 'DELETE',
          url: `/api/companies/${own.id}`,
          headers: READ_ONLY,
        })
      ).statusCode,
    ).toBe(403);
    const foreign = await prisma.company.findFirstOrThrow({
      where: { orgId: orgB!.orgId, deletedAt: null },
      select: { id: true },
    });
    expect((await server.inject({ method: 'GET', url: `/api/companies/${foreign.id}` })).statusCode).toBe(404);
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/companies/${foreign.id}`,
          payload: { name: 'cross-tenant' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await server.inject({ method: 'GET', url: '/api/companies?limit=0' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/companies?limit=201' })).statusCode).toBe(400);
  });
});

describe('territories', () => {
  async function createTerritory(orgId: string): Promise<string> {
    const ownerId = await adminUserId(orgId);
    const t = await prisma.territory.create({
      data: { orgId, name: `Terr ${tag} ${randomUUID().slice(0, 4)}`, countryCodes: ['FR'], ownerId },
      select: { id: true },
    });
    return t.id;
  }

  skipIfNoDb('GET /territories requires territories:read', async () => {
    expect((await server.inject({ method: 'GET', url: '/api/territories' })).statusCode).toBe(200);
    expect(
      (await server.inject({ method: 'GET', url: '/api/territories', headers: SDR })).statusCode,
    ).toBe(403);
  });

  skipIfNoDb('PATCH and DELETE of a deleted territory return 404', async () => {
    const id = await createTerritory(orgA!.orgId);
    expect((await server.inject({ method: 'DELETE', url: `/api/territories/${id}` })).statusCode).toBe(200);
    expect((await server.inject({ method: 'DELETE', url: `/api/territories/${id}` })).statusCode).toBe(404);
    const revived = await server.inject({
      method: 'PATCH',
      url: `/api/territories/${id}`,
      payload: { active: true },
    });
    expect(revived.statusCode).toBe(404);
  });

  skipIfNoDb('validation, RBAC and tenant isolation', async () => {
    expect(
      (await server.inject({ method: 'POST', url: '/api/territories', payload: { name: '' } })).statusCode,
    ).toBe(400);
    const id = await createTerritory(orgA!.orgId);
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/territories/${id}`,
          headers: READ_ONLY,
          payload: { name: 'nope' },
        })
      ).statusCode,
    ).toBe(403);
    const foreign = await createTerritory(orgB!.orgId);
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/territories/${foreign}`,
          payload: { name: 'cross-tenant' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await server.inject({ method: 'DELETE', url: `/api/territories/${foreign}` })).statusCode).toBe(404);
  });
});

describe('accounts', () => {
  skipIfNoDb('auto top accounts treat % and _ in search and industry literally', async () => {
    await prisma.company.updateMany({
      where: { orgId: orgA!.orgId },
      data: { topAccountRank: null },
    });
    const all = await server.inject({ method: 'GET', url: '/api/accounts/top?limit=50' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);
    const pct = await server.inject({ method: 'GET', url: '/api/accounts/top?limit=50&search=%25' });
    expect((pct.json() as { items: unknown[] }).items).toHaveLength(0);
    const ind = await server.inject({ method: 'GET', url: '/api/accounts/top?limit=50&industry=%25' });
    expect((ind.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  skipIfNoDb('RBAC, validation and tenant isolation on account writes', async () => {
    expect(
      (
        await server.inject({
          method: 'PUT',
          url: '/api/accounts/top-list',
          headers: READ_ONLY,
          payload: { companyIds: [] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await server.inject({ method: 'GET', url: '/api/accounts/key?limit=0' })).statusCode,
    ).toBe(400);
    const foreign = await prisma.company.findFirstOrThrow({
      where: { orgId: orgB!.orgId, deletedAt: null },
      select: { id: true },
    });
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/companies/${foreign.id}/tier`,
          payload: { tier: 'key' },
        })
      ).statusCode,
    ).toBe(404);
    const badList = await server.inject({
      method: 'PUT',
      url: '/api/accounts/top-list',
      payload: { companyIds: [foreign.id] },
    });
    expect(badList.statusCode).toBe(400);
  });
});

describe('account technical stack', () => {
  skipIfNoDb('a company with no enrichment row resolves by name as well as by id', async () => {
    const company = await prisma.company.create({
      data: { orgId: orgA!.orgId, name: `Plain Account ${tag}` },
      select: { id: true, name: true },
    });
    const byId = await server.inject({
      method: 'GET',
      url: `/api/crm/companies/${company.id}/technical-stack`,
    });
    expect(byId.statusCode).toBe(200);
    const byName = await server.inject({
      method: 'GET',
      url: `/api/crm/companies/${encodeURIComponent(company.name)}/technical-stack`,
    });
    expect(byName.statusCode).toBe(200);
    expect(byName.json()).toEqual(byId.json());

    const foreign = await prisma.company.create({
      data: { orgId: orgB!.orgId, name: `Foreign Plain ${tag}` },
      select: { name: true },
    });
    const leaked = await server.inject({
      method: 'GET',
      url: `/api/crm/companies/${encodeURIComponent(foreign.name)}/technical-stack`,
    });
    expect(leaked.statusCode).toBe(404);
  });
});

describe('search', () => {
  skipIfNoDb('company results are CRM companies linking to their account page', async () => {
    const company = await prisma.company.create({
      data: { orgId: orgA!.orgId, name: `Zephyrine Holdings ${tag}` },
      select: { id: true },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(`Zephyrine ${tag}`)}&types=company`,
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Array<{ id: string; url: string }> }).items;
    expect(items.map((i) => i.id)).toContain(company.id);
    expect(items.find((i) => i.id === company.id)?.url).toBe(`/accounts/${company.id}`);
  });

  skipIfNoDb('contact results link to the contact detail page', async () => {
    const contact = await prisma.contact.create({
      data: { orgId: orgA!.orgId, customer: 'Search Co', name: `Quillon Searchable ${tag}` },
      select: { id: true },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(`Quillon ${tag}`)}&types=contact`,
    });
    const items = (res.json() as { items: Array<{ id: string; url: string }> }).items;
    expect(items.find((i) => i.id === contact.id)?.url).toBe(`/contacts/${contact.id}`);
  });

  skipIfNoDb('search never returns another org rows and validates q', async () => {
    const foreign = await prisma.contact.create({
      data: { orgId: orgB!.orgId, customer: 'Foreign Co', name: `Vexmoor Foreign ${tag}` },
      select: { id: true },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(`Vexmoor ${tag}`)}`,
    });
    const ids = (res.json() as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(ids).not.toContain(foreign.id);
    expect((await server.inject({ method: 'GET', url: '/api/search?q=' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/search?q=a&limit=21' })).statusCode).toBe(400);
  });
});
