// Integration tests for /api/v1/kam/handoffs/* against the live dev DB.
// The handoff is minted by the Initiative→opportunity transition; here we test
// the export contract (ABC-OM payload), status flow, and cross-tenant guard.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let companyId = '';
let handoffId = '';
let otherOrgId = '';
let otherHandoffId = '';
const createdInitiativeIds: string[] = [];
const createdOpportunityIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const seedOrg = await prisma.org.findFirst({ where: { clerkOrg: 'org_seed_mantu' } });
  if (!seedOrg) {
    dbReachable = false;
    return;
  }
  orgId = seedOrg.id;
  const company = await prisma.company.create({
    data: { orgId, name: `KAMHandoff-${randomUUID().slice(0, 8)}`, source: 'manual', countryCode: 'ES' },
  });
  companyId = company.id;

  server = await buildServer();
  await server.ready();

  // Drive an initiative to `opportunity` so a handoff is minted.
  const init = await server.inject({
    method: 'POST',
    url: '/api/v1/kam/initiatives',
    payload: { companyId, title: 'Handoff me', estimatedValueMicros: 750_000_000 },
  });
  const initId = init.json().id as string;
  createdInitiativeIds.push(initId);
  await server.inject({ method: 'POST', url: `/api/v1/kam/initiatives/${initId}/transition`, payload: { toStage: 'lead' } });
  const opp = await server.inject({
    method: 'POST',
    url: `/api/v1/kam/initiatives/${initId}/transition`,
    payload: { toStage: 'opportunity' },
  });
  createdOpportunityIds.push(opp.json().convertedToOpportunityId);
  handoffId = opp.json().handoffId as string;

  // Foreign-tenant handoff for the cross-tenant guard.
  const other = await prisma.org.create({
    data: { clerkOrg: `org_kamh_other_${randomUUID().slice(0, 8)}`, name: 'KAMH Other' },
  });
  otherOrgId = other.id;
  const oc = await prisma.company.create({ data: { orgId: other.id, name: `OC-${randomUUID().slice(0, 8)}`, source: 'manual' } });
  const oi = await prisma.kamInitiative.create({ data: { orgId: other.id, companyId: oc.id, title: 'foreign', stage: 'opportunity' } });
  const oh = await prisma.kamHandoff.create({ data: { orgId: other.id, companyId: oc.id, initiativeId: oi.id, status: 'draft' } });
  otherHandoffId = oh.id;
});

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;
  try {
    if (createdInitiativeIds.length) {
      await prisma.kamHandoff.deleteMany({ where: { initiativeId: { in: createdInitiativeIds } } });
      await prisma.kamInitiative.deleteMany({ where: { id: { in: createdInitiativeIds } } });
    }
    if (createdOpportunityIds.length) {
      await prisma.opportunity.deleteMany({ where: { id: { in: createdOpportunityIds } } });
    }
    if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — dev DB / seed org not reachable`);
    await fn();
  });

describe('KAM handoff export (ABC-OM interface)', () => {
  t('lists the draft handoff minted by the transition', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/v1/kam/handoffs?companyId=${companyId}` });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string; status: string }>;
    expect(items.find((h) => h.id === handoffId)?.status).toBe('draft');
  });

  t('export produces the ABC-OM payload and marks the handoff exported', async () => {
    const res = await server.inject({ method: 'POST', url: `/api/v1/kam/handoffs/${handoffId}/export` });
    expect(res.statusCode).toBe(200);
    const { handoff, payload } = res.json();
    expect(handoff.status).toBe('exported');
    expect(payload).toMatchObject({
      schemaVersion: 1,
      source: 'bidstack_kam',
      handoffId,
      account: { companyId, country: 'ES' },
    });
    expect(payload.initiative.title).toBe('Handoff me');
    expect(payload.opportunity.code).toMatch(/^OP-/);
    expect(payload.opportunity.valueMicros).toBe(750_000_000);
  });

  t('confirm records the ABC OM id and is terminal to re-export', async () => {
    const confirm = await server.inject({
      method: 'POST',
      url: `/api/v1/kam/handoffs/${handoffId}/confirm`,
      payload: { externalRef: 'ABC-OM-12345' },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json()).toMatchObject({ status: 'confirmed', externalRef: 'ABC-OM-12345' });
    const reExport = await server.inject({ method: 'POST', url: `/api/v1/kam/handoffs/${handoffId}/export` });
    expect(reExport.statusCode).toBe(409);
  });

  t('rejects a cross-tenant handoff export with 404 (B3)', async () => {
    const res = await server.inject({ method: 'POST', url: `/api/v1/kam/handoffs/${otherHandoffId}/export` });
    expect(res.statusCode).toBe(404);
  });
});
