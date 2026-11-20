// Integration tests for /api/leads/*.
// Covers list, detail, CRUD, conversion, and soft-delete.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
const createdLeadIds: string[] = [];
// Convert creates an Opportunity + Contact whose org-scoped unique code the route
// derives from a small deterministic namespace (OP-<last 4 of Date.now()>). Track
// them so afterAll frees the code and accumulated rows can't collide on a later
// run. See docs/solutions/idempotent-integration-fixtures.md.
const createdOpportunityIds: string[] = [];
const createdContactIds: string[] = [];
// Stable prefix → beforeAll can purge leftovers from a prior interrupted run;
// per-run suffix → each run's convert fixtures are unique in the shared test DB.
const CONVERT_COMPANY_PREFIX = 'ConvertCorp';
const convertCompany = `${CONVERT_COMPANY_PREFIX}-${randomUUID().slice(0, 8)}`;

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
  if (dbReachable) {
    for (const id of createdLeadIds) {
      try {
        await prisma.lead.deleteMany({ where: { id } });
      } catch {
        /* ignore */
      }
    }
    // Delete after leads (which reference the opportunity) so the next run starts
    // without this run's convert Opportunity occupying its OP-code.
    try {
      if (createdOpportunityIds.length > 0) {
        await prisma.opportunity.deleteMany({ where: { id: { in: createdOpportunityIds } } });
      }
      if (createdContactIds.length > 0) {
        await prisma.contact.deleteMany({ where: { id: { in: createdContactIds } } });
      }
    } catch {
      /* ignore */
    }
    await prisma.$disconnect();
  }
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('leads routes', () => {
  skipIfNoDb('GET /api/leads returns seeded fixtures', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/leads?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(4);
    expect(body.items[0]).toMatchObject({
      id: expect.any(String),
      firstName: expect.any(String),
      lastName: expect.any(String),
      status: expect.stringMatching(/^(new|contacted|qualified|nurture|disqualified|converted)$/),
      score: expect.any(Number),
    });
  });

  skipIfNoDb('GET /api/leads supports status filter', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/leads?status=new&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((l: { status: string }) => l.status === 'new')).toBe(true);
  });

  skipIfNoDb('GET /api/leads supports search', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/leads?search=TechFlow' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((l: { companyName: string }) => l.companyName === 'TechFlow Inc')).toBe(
      true,
    );
  });

  skipIfNoDb('GET /api/leads/:id returns full detail', async () => {
    const list = (await server.inject({ method: 'GET', url: '/api/leads?limit=1' })).json();
    const id = list.items[0].id;
    const res = await server.inject({ method: 'GET', url: `/api/leads/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notes).toBeDefined();
    expect(body.budget).toBeDefined();
    expect(body.intel).toBeDefined();
  });

  skipIfNoDb('POST /api/leads creates a lead and writes audit_log', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/leads',
      payload: {
        firstName: 'Integration',
        lastName: 'TestLead',
        companyName: 'Integration Corp',
        source: 'website',
        priority: 'medium',
        score: 50,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.firstName).toBe('Integration');
    expect(body.status).toBe('new');
    createdLeadIds.push(body.id);

    const audit = await prisma.auditLog.findFirst({
      where: { targetType: 'lead', targetId: body.id, action: 'lead.create' },
    });
    expect(audit).toBeTruthy();
  });

  skipIfNoDb('PATCH /api/leads/:id updates fields', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/leads',
      payload: {
        firstName: 'Patch',
        lastName: 'Me',
        companyName: 'PatchCorp',
        source: 'referral',
        priority: 'low',
        score: 10,
      },
    });
    const id = createRes.json().id;
    createdLeadIds.push(id);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/leads/${id}`,
      payload: { score: 99, status: 'qualified' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ id, score: 99, status: 'qualified' });
  });

  skipIfNoDb('POST /api/leads/:id/convert creates opp + contact', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/leads',
      payload: {
        firstName: 'Convert',
        lastName: 'Me',
        companyName: convertCompany,
        source: 'event',
        priority: 'high',
        score: 80,
      },
    });
    const id = createRes.json().id;
    createdLeadIds.push(id);

    const convert = await server.inject({
      method: 'POST',
      url: `/api/leads/${id}/convert`,
      payload: {
        opportunityName: `Convert Opp ${convertCompany}`,
        opportunityValueMicros: 1_000_000_000,
        stage: 's1_lead',
      },
    });
    expect(convert.statusCode).toBe(200);
    const body = convert.json();
    expect(body.leadId).toBe(id);
    expect(body.opportunityId).toBeDefined();
    expect(body.contactId).toBeDefined();
    // Track for afterAll cleanup so the route's deterministic OP-code is freed and
    // cannot collide on the org-scoped unique constraint in a later run.
    createdOpportunityIds.push(body.opportunityId);
    createdContactIds.push(body.contactId);

    // Lead should now be converted
    const leadRes = await server.inject({ method: 'GET', url: `/api/leads/${id}` });
    expect(leadRes.json().status).toBe('converted');
    expect(leadRes.json().convertedToOpportunityId).toBe(body.opportunityId);
  });

  // Regression for the double-conversion race: the in-transaction status guard
  // (status != converted) must make a second convert a 409 conflict and must NOT
  // create a second opportunity/contact — otherwise pipeline value duplicates and
  // forecast/win-rate corrupt. WHY this matters: the bug let two concurrent
  // converts each mint an opportunity off the same lead.
  skipIfNoDb('POST /api/leads/:id/convert is idempotent — second convert is 409, no dup opp', async () => {
    const dupCompany = `${CONVERT_COMPANY_PREFIX}-dup-${randomUUID().slice(0, 8)}`;
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/leads',
      payload: {
        firstName: 'Double',
        lastName: 'Convert',
        companyName: dupCompany,
        source: 'event',
        priority: 'high',
        score: 70,
      },
    });
    const id = createRes.json().id;
    createdLeadIds.push(id);

    const first = await server.inject({
      method: 'POST',
      url: `/api/leads/${id}/convert`,
      payload: { opportunityName: `Dup Opp ${dupCompany}`, opportunityValueMicros: 500_000_000 },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    createdOpportunityIds.push(firstBody.opportunityId);
    createdContactIds.push(firstBody.contactId);

    // Second convert of an already-converted lead must be rejected.
    const second = await server.inject({
      method: 'POST',
      url: `/api/leads/${id}/convert`,
      payload: { opportunityName: `Dup Opp 2 ${dupCompany}`, opportunityValueMicros: 999_000_000 },
    });
    expect(second.statusCode).toBe(409);

    // The lead must still point at the original opportunity (no overwrite), and
    // exactly one opportunity must exist for this lead's company.
    const leadRes = await server.inject({ method: 'GET', url: `/api/leads/${id}` });
    expect(leadRes.json().convertedToOpportunityId).toBe(firstBody.opportunityId);
    const opps = await prisma.opportunity.findMany({ where: { customer: dupCompany } });
    expect(opps).toHaveLength(1);
  });

  skipIfNoDb('DELETE /api/leads/:id soft-deletes and returns 404 on get', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/leads',
      payload: {
        firstName: 'Delete',
        lastName: 'Me',
        companyName: 'DeleteCorp',
        source: 'other',
        priority: 'low',
        score: 5,
      },
    });
    const id = createRes.json().id;
    createdLeadIds.push(id);

    const del = await server.inject({ method: 'DELETE', url: `/api/leads/${id}` });
    expect(del.statusCode).toBe(204);

    const get = await server.inject({ method: 'GET', url: `/api/leads/${id}` });
    expect(get.statusCode).toBe(404);
  });

  skipIfNoDb('PATCH /api/leads/:id returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/leads/11111111-2222-3333-4444-555555555555',
      payload: { score: 50 },
    });
    expect(res.statusCode).toBe(404);
  });
});
