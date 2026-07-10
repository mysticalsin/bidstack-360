// Integration tests for KAM KPI reports + prospection mirror against the live
// dev DB. Country 'ZZ' isolates the roll-up bucket from seed data.

import { randomUUID } from 'node:crypto';

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
let orgId = '';
let companyId = '';
let otherCompanyId = '';
let otherOrgId = '';
let initA = '';
let restoreAuth: (() => void) | undefined;
const initiativeIds: string[] = [];
const opportunityIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('kam-reports');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const company = await prisma.company.create({
    data: {
      orgId,
      name: `KAMRpt-${randomUUID().slice(0, 8)}`,
      source: 'manual',
      countryCode: 'ZZ',
      kamStatus: 'active',
    },
  });
  companyId = company.id;
  const other = await prisma.org.create({
    data: { clerkOrg: `org_kamrpt_${randomUUID().slice(0, 8)}`, name: 'KAMRpt Other' },
  });
  otherOrgId = other.id;
  otherCompanyId = (
    await prisma.company.create({ data: { orgId: other.id, name: 'oc', source: 'manual' } })
  ).id;

  server = await buildServer();
  await server.ready();

  const mk = async (): Promise<string> => {
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/kam/initiatives',
      payload: { companyId, title: `i-${randomUUID().slice(0, 5)}` },
    });
    const id = r.json().id as string;
    initiativeIds.push(id);
    return id;
  };
  initA = await mk(); // stays `initiative`, made stale below
  const initB = await mk();
  const initC = await mk();
  await server.inject({
    method: 'POST',
    url: `/api/v1/kam/initiatives/${initB}/transition`,
    payload: { toStage: 'lead' },
  });
  await server.inject({
    method: 'POST',
    url: `/api/v1/kam/initiatives/${initC}/transition`,
    payload: { toStage: 'lead' },
  });
  const opp = await server.inject({
    method: 'POST',
    url: `/api/v1/kam/initiatives/${initC}/transition`,
    payload: { toStage: 'opportunity' },
  });
  opportunityIds.push(opp.json().convertedToOpportunityId);
  // Tasks on B (lead): 1 open + 1 done.
  const tk = await server.inject({
    method: 'POST',
    url: `/api/v1/kam/initiatives/${initB}/tasks`,
    payload: { title: 'open task' },
  });
  await server.inject({
    method: 'POST',
    url: `/api/v1/kam/initiatives/${initB}/tasks`,
    payload: { title: 'done task' },
  });
  await server.inject({ method: 'PATCH', url: `/api/v1/kam/tasks/${tk.json().id}`, payload: {} }); // no-op to ensure route ok
  const tasks = await prisma.task.findMany({
    where: { initiativeId: initB },
    select: { id: true },
  });
  await prisma.task.update({ where: { id: tasks[1]!.id }, data: { status: 'done' } });
  // Make initA stale (30 days idle).
  await prisma.kamInitiative.update({
    where: { id: initA },
    data: { lastActivityAt: new Date(Date.now() - 30 * 86400000) },
  });
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;
  try {
    if (initiativeIds.length)
      await prisma.kamInitiative.deleteMany({ where: { id: { in: initiativeIds } } });
    await prisma.kamInitiative.deleteMany({ where: { companyId } });
    if (opportunityIds.length)
      await prisma.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
    await prisma.kamProspection.deleteMany({ where: { companyId } });
    if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
  } catch {
    /* ignore */
  }
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable);

describe('KAM KPI reports + prospection mirror', () => {
  t('prospection import stamps orgId, validates ownership, skips cross-tenant rows', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/kam/prospections/import',
      payload: {
        source: 'abc',
        rows: [
          {
            externalId: 'ABC-1',
            companyId,
            actionType: 'call',
            occurredAt: new Date().toISOString(),
          },
          {
            externalId: 'ABC-2',
            companyId,
            actionType: 'email',
            occurredAt: new Date().toISOString(),
          },
          {
            externalId: 'ABC-3',
            companyId: otherCompanyId,
            actionType: 'call',
            occurredAt: new Date().toISOString(),
          }, // cross-tenant → skipped
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imported: 2, skipped: 1 });
  });

  t('per-account KPI aggregates stages, tasks, prospections, staleness', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/kam/reports/account/${companyId}?staleDays=14`,
    });
    expect(res.statusCode).toBe(200);
    const k = res.json();
    expect(k.initiativesByStage).toMatchObject({
      initiative: 1,
      lead: 1,
      opportunity: 1,
      dropped: 0,
    });
    expect(k.openTasks).toBe(1);
    expect(k.doneTasks).toBe(1);
    expect(k.prospectionCount).toBe(2);
    expect(k.staleInitiativeCount).toBe(1); // initA, idle 30d
  });

  t('country roll-up buckets the account under ZZ', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/kam/reports/rollup' });
    expect(res.statusCode).toBe(200);
    const zz = res.json().items.find((i: { country: string | null }) => i.country === 'ZZ');
    expect(zz).toBeTruthy();
    expect(zz.initiatives).toBeGreaterThanOrEqual(3);
    expect(zz.openOpportunities).toBeGreaterThanOrEqual(1);
    expect(zz.prospections).toBeGreaterThanOrEqual(2);
  });

  t('staleness report flags the idle initiative', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/kam/reports/stale?staleDays=14',
    });
    expect(res.statusCode).toBe(200);
    const found = res.json().items.find((i: { id: string }) => i.id === initA);
    expect(found).toBeTruthy();
    expect(found.daysStale).toBeGreaterThanOrEqual(14);
  });

  t('owner roll-up returns an array', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/kam/reports/owners' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });
});
