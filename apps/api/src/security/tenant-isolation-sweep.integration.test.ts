/**
 * Cross-tenant isolation sweep.
 *
 * Provisions a second org with one record per core CRM entity, then, as the
 * seed-org admin (the most privileged caller), probes every registered
 * GET/PATCH/PUT/DELETE `/:id` route for that entity with the foreign id.
 * Nothing may succeed (2xx) and the foreign record must be unchanged.
 * Lists must not include foreign ids either.
 */
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';

type Entity = 'companies' | 'contacts' | 'leads' | 'tasks' | 'opportunities';

let server: FastifyInstance;
let dbOk = false;
let foreignOrgId = '';
const foreign: Record<Entity, string> = {
  companies: '',
  contacts: '',
  leads: '',
  tasks: '',
  opportunities: '',
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const seed = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
    dbOk = !!seed;
  } catch {
    dbOk = false;
  }
  if (!dbOk) return;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_sweep_${randomUUID()}`, name: 'Isolation Sweep Foreign Org' },
  });
  foreignOrgId = org.id;
  foreign.companies = (
    await prisma.company.create({ data: { orgId: org.id, name: 'SWEEP-FOREIGN-CO' } })
  ).id;
  foreign.contacts = (
    await prisma.contact.create({
      data: { orgId: org.id, customer: 'SWEEP-FOREIGN', name: 'Foreign Contact' },
    })
  ).id;
  foreign.leads = (
    await prisma.lead.create({
      data: { orgId: org.id, firstName: 'Foreign', lastName: 'Lead', companyName: 'SWEEP-FOREIGN' },
    })
  ).id;
  foreign.tasks = (await prisma.task.create({ data: { orgId: org.id, title: 'SWEEP-FOREIGN' } }))
    .id;
  foreign.opportunities = (
    await prisma.opportunity.create({
      data: {
        orgId: org.id,
        code: `OP-SW-${randomUUID().slice(0, 8).toUpperCase()}`,
        customer: 'SWEEP-FOREIGN',
        name: 'Sweep target',
        stage: 's1_lead',
        valueMicros: BigInt(0),
        probability: 0,
        industry: 'other',
      },
    })
  ).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbOk && foreignOrgId) {
    await prisma.task.deleteMany({ where: { orgId: foreignOrgId } });
    await prisma.lead.deleteMany({ where: { orgId: foreignOrgId } });
    await prisma.contact.deleteMany({ where: { orgId: foreignOrgId } });
    await prisma.opportunity.deleteMany({ where: { orgId: foreignOrgId } });
    await prisma.company.deleteMany({ where: { orgId: foreignOrgId } });
    await prisma.org.deleteMany({ where: { id: foreignOrgId } });
  }
  if (server) await server.close();
});

const METHODS: HTTPMethods[] = ['GET', 'PATCH', 'PUT', 'DELETE'];
const ENTITIES: Entity[] = ['companies', 'contacts', 'leads', 'tasks', 'opportunities'];

describe('tenant isolation sweep (seed admin vs foreign org)', () => {
  for (const entity of ENTITIES) {
    it(`/${entity}/:id never succeeds for a foreign ${entity} id`, async (t) => {
      if (!dbOk) t.skip();
      const id = foreign[entity];
      const probed: string[] = [];
      for (const method of METHODS) {
        const url = `/api/v1/${entity}/:id`;
        if (!server.hasRoute({ method, url })) continue;
        probed.push(method);
        const res = await server.inject({
          method,
          url: `/api/v1/${entity}/${id}`,
          ...(method === 'PATCH' || method === 'PUT'
            ? { headers: { 'content-type': 'application/json' }, payload: { name: 'ATTACKER' } }
            : {}),
        });
        expect(res.statusCode, `${method} /${entity}/:id -> ${res.statusCode}`).toBeGreaterThanOrEqual(
          400,
        );
        expect(res.body).not.toContain('SWEEP-FOREIGN');
      }
      expect(probed).toContain('GET');
    });
  }

  it('foreign records are untouched after the probes', async (t) => {
    if (!dbOk) t.skip();
    expect(await prisma.company.findUnique({ where: { id: foreign.companies } })).toMatchObject({
      name: 'SWEEP-FOREIGN-CO',
    });
    expect(await prisma.contact.findUnique({ where: { id: foreign.contacts } })).not.toBeNull();
    expect(await prisma.lead.findUnique({ where: { id: foreign.leads } })).not.toBeNull();
    expect(await prisma.task.findUnique({ where: { id: foreign.tasks } })).toMatchObject({
      title: 'SWEEP-FOREIGN',
    });
    expect(
      await prisma.opportunity.findUnique({ where: { id: foreign.opportunities } }),
    ).toMatchObject({ name: 'Sweep target' });
  });

  for (const entity of ENTITIES) {
    it(`GET /${entity} list never includes foreign rows`, async (t) => {
      if (!dbOk) t.skip();
      const res = await server.inject({ method: 'GET', url: `/api/v1/${entity}` });
      expect(res.statusCode, `GET /${entity} -> ${res.statusCode}`).toBe(200);
      expect(res.body).not.toContain(foreign[entity]);
      expect(res.body).not.toContain('SWEEP-FOREIGN');
    });
  }

  it('global search never returns foreign rows', async (t) => {
    if (!dbOk) t.skip();
    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=SWEEP-FOREIGN' });
    expect(res.statusCode, `search -> ${res.statusCode}`).toBe(200);
    expect(res.body).not.toContain('SWEEP-FOREIGN');
  });
});
