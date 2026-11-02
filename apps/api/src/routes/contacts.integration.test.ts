// Integration tests for /api/contacts/*.
// Covers CRUD and the `customer` linking convention (free-text account tag).

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
let orgId: string | null = null;
let seedCompanyName: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdContactIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  // Per-file throwaway org so leftover contacts can never collide on a shared
  // tenant fixture between runs.
  const iso = await createIsolatedOrg('contacts');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

  const company = await prisma.company.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { name: true },
  });
  seedCompanyName = company?.name ?? null;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  for (const id of createdContactIds) {
    await prisma.auditLog.deleteMany({ where: { targetType: 'contact', targetId: id } });
    await prisma.contact.deleteMany({ where: { id } });
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('contacts routes', () => {
  skipIfNoDb('GET /api/contacts returns seeded contacts', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/contacts?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; customer: string; name: string }> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const row of body.items) {
      expect(typeof row.name).toBe('string');
      expect(typeof row.customer).toBe('string');
    }
  });

  skipIfNoDb('POST /api/contacts creates a contact linked to a customer', async () => {
    const customer = seedCompanyName ?? 'Integration Account';
    const res = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        customer,
        name: 'Integration Contact',
        role: 'Manager',
        email: 'integration@example.com',
        phone: '+1-555-0000',
        influence: 4,
        sentiment: 'hot',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; customer: string; name: string; sentiment: string };
    expect(body.customer).toBe(customer);
    expect(body.name).toBe('Integration Contact');
    expect(body.sentiment).toBe('hot');
    createdContactIds.push(body.id);
  });

  skipIfNoDb('GET /api/contacts/:id returns the contact', async () => {
    if (createdContactIds.length === 0) return;
    const id = createdContactIds[0];
    const res = await server.inject({ method: 'GET', url: `/api/contacts/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; name: string; email: string | null };
    expect(body.id).toBe(id);
    expect(body.email).toBe('integration@example.com');
  });

  skipIfNoDb('GET /api/contacts filters by customer', async () => {
    if (createdContactIds.length === 0) return;
    const customer = seedCompanyName ?? 'Integration Account';
    const res = await server.inject({
      method: 'GET',
      url: `/api/contacts?customer=${encodeURIComponent(customer)}&limit=10`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ customer: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    for (const row of body.items) {
      expect(row.customer).toBe(customer);
    }
  });

  skipIfNoDb('GET /api/contacts supports search across name, email, and role', async () => {
    if (createdContactIds.length === 0) return;
    const res = await server.inject({
      method: 'GET',
      url: '/api/contacts?search=Integration%20Contact&limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ name: string }> };
    expect(body.items.some((c) => c.name === 'Integration Contact')).toBe(true);
  });

  skipIfNoDb('PATCH /api/contacts/:id updates fields and audit-logs the change', async () => {
    if (createdContactIds.length === 0) return;
    const id = createdContactIds[0];
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/contacts/${id}`,
      payload: { name: 'Updated Contact Name', role: 'Director', sentiment: 'warm' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; role: string | null; sentiment: string | null };
    expect(body.name).toBe('Updated Contact Name');
    expect(body.role).toBe('Director');
    expect(body.sentiment).toBe('warm');
  });

  skipIfNoDb('PATCH /api/contacts/:id re-links to a different customer', async () => {
    if (createdContactIds.length === 0) return;
    const id = createdContactIds[0];
    const newCustomer = 'Re-linked Account';
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/contacts/${id}`,
      payload: { customer: newCustomer },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { customer: string };
    expect(body.customer).toBe(newCustomer);
  });

  skipIfNoDb('DELETE /api/contacts/:id removes the contact and writes audit', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        customer: 'Delete Test Account',
        name: 'Contact to Delete',
        role: null,
        email: 'delete@example.com',
        phone: null,
        influence: null,
        sentiment: null,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const id = (createRes.json() as { id: string }).id;
    createdContactIds.push(id);

    const delRes = await server.inject({ method: 'DELETE', url: `/api/contacts/${id}` });
    expect(delRes.statusCode).toBe(204);

    const getRes = await server.inject({ method: 'GET', url: `/api/contacts/${id}` });
    expect(getRes.statusCode).toBe(404);
  });

  skipIfNoDb('POST links a contact only on an exact unique company name or an explicit id', async () => {
    // WHY: free-text customer used to be the only association, so Dust could
    // not tell a real company link from an ambiguous name. Zero or many name
    // matches must stay needs_review and must not rewrite older rows.
    const unique = await prisma.company.create({
      data: { orgId: orgId!, name: `Unique Link ${Date.now()}` },
    });
    const ambiguousName = `Ambiguous Co ${Date.now()}`;
    // (org_id, name) is unique, so two exact strings cannot exist. Two casings
    // still match one case-insensitive lookup, which must not pick a winner.
    await prisma.company.create({ data: { orgId: orgId!, name: ambiguousName } });
    await prisma.company.create({ data: { orgId: orgId!, name: ambiguousName.toLowerCase() } });

    const linked = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        customer: unique.name,
        name: 'Linked Person',
        role: null,
        email: null,
        phone: null,
        influence: null,
        sentiment: null,
      },
    });
    expect(linked.statusCode).toBe(201);
    const linkedBody = linked.json() as {
      id: string;
      customer: string;
      companyId: string | null;
      linkState: string;
    };
    createdContactIds.push(linkedBody.id);
    expect(linkedBody.customer).toBe(unique.name);
    expect(linkedBody.companyId).toBe(unique.id);
    expect(linkedBody.linkState).toBe('linked');

    const ambiguous = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        customer: ambiguousName,
        name: 'Ambiguous Person',
        role: null,
        email: null,
        phone: null,
        influence: null,
        sentiment: null,
      },
    });
    expect(ambiguous.statusCode).toBe(201);
    const ambiguousBody = ambiguous.json() as {
      id: string;
      customer: string;
      companyId: string | null;
      linkState: string;
    };
    createdContactIds.push(ambiguousBody.id);
    expect(ambiguousBody.customer).toBe(ambiguousName);
    expect(ambiguousBody.companyId).toBeNull();
    expect(ambiguousBody.linkState).toBe('needs_review');

    const explicit = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        customer: 'Free text stays',
        companyId: unique.id,
        name: 'Explicit Person',
        role: null,
        email: null,
        phone: null,
        influence: null,
        sentiment: null,
      },
    });
    expect(explicit.statusCode).toBe(201);
    const explicitBody = explicit.json() as { id: string; companyId: string | null; customer: string };
    createdContactIds.push(explicitBody.id);
    expect(explicitBody.customer).toBe('Free text stays');
    expect(explicitBody.companyId).toBe(unique.id);

    const missing = await server.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        customer: 'Nobody',
        companyId: '00000000-0000-4000-8000-000000000099',
        name: 'Missing Company',
        role: null,
        email: null,
        phone: null,
        influence: null,
        sentiment: null,
      },
    });
    expect(missing.statusCode).toBe(404);

    const historical = await prisma.contact.create({
      data: {
        orgId: orgId!,
        customer: unique.name,
        name: 'Historical Person',
        companyId: null,
      },
    });
    createdContactIds.push(historical.id);
    const read = await server.inject({ method: 'GET', url: `/api/contacts/${historical.id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ companyId: null, linkState: 'needs_review', customer: unique.name });
    const stored = await prisma.contact.findUnique({ where: { id: historical.id } });
    expect(stored?.companyId).toBeNull();
  });

  skipIfNoDb('PATCH /api/contacts/:id returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/contacts/11111111-2222-3333-4444-555555555555',
      payload: { name: 'Ghost' },
    });
    expect(res.statusCode).toBe(404);
  });
});
