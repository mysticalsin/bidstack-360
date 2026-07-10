// Integration tests for /api/v1/kam/initiatives/:id/tasks + /kam/accounts/:id/todos
// against the live dev DB. Covers the per-account roll-up, status flow, the
// lastActivityAt bump (M3), the soft 1–3 hint, and cross-tenant guards (B3).

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
let otherInitiativeId = '';
let restoreAuth: (() => void) | undefined;
const createdInitiativeIds: string[] = [];
const createdCompanyIds: string[] = [];
const createdOrgIds: string[] = [];

async function newInitiative(cId: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/v1/kam/initiatives',
    payload: { companyId: cId, title: `Init ${randomUUID().slice(0, 6)}` },
  });
  const id = res.json().id as string;
  createdInitiativeIds.push(id);
  return id;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('kam-tasks');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const company = await prisma.company.create({
    data: { orgId, name: `KAMTask-${randomUUID().slice(0, 8)}`, source: 'manual' },
  });
  companyId = company.id;
  createdCompanyIds.push(companyId);
  // Foreign tenant + its initiative for the cross-tenant graft test.
  const other = await prisma.org.create({
    data: { clerkOrg: `org_kamtask_other_${randomUUID().slice(0, 8)}`, name: 'KAMTask Other' },
  });
  createdOrgIds.push(other.id);
  const otherCompany = await prisma.company.create({
    data: { orgId: other.id, name: `Other-${randomUUID().slice(0, 8)}`, source: 'manual' },
  });
  const otherInit = await prisma.kamInitiative.create({
    data: { orgId: other.id, companyId: otherCompany.id, title: 'foreign initiative' },
  });
  otherInitiativeId = otherInit.id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;
  try {
    // Tasks cascade on initiative delete (FK onDelete Cascade).
    if (createdInitiativeIds.length) {
      await prisma.kamInitiative.deleteMany({ where: { id: { in: createdInitiativeIds } } });
    }
    for (const oid of createdOrgIds) await prisma.org.deleteMany({ where: { id: oid } });
    if (createdCompanyIds.length) {
      await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    }
  } catch {
    /* ignore */
  }
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable);

describe('KAM tasks + per-account to-do', () => {
  t(
    'creates a task under an initiative (accountId denormalized) and bumps lastActivityAt',
    async () => {
      const initId = await newInitiative(companyId);
      const before = (
        await server.inject({ method: 'GET', url: `/api/v1/kam/initiatives/${initId}` })
      ).json().lastActivityAt as string;
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/kam/initiatives/${initId}/tasks`,
        payload: { title: 'Call the sponsor', type: 'prospection' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        initiativeId: initId,
        accountId: companyId,
        status: 'open',
      });
      const after = (
        await server.inject({ method: 'GET', url: `/api/v1/kam/initiatives/${initId}` })
      ).json().lastActivityAt as string;
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    },
  );

  t('surfaces open tasks in the per-account to-do and moves them out on done', async () => {
    const initId = await newInitiative(companyId);
    const created = await server.inject({
      method: 'POST',
      url: `/api/v1/kam/initiatives/${initId}/tasks`,
      payload: { title: 'Send recap' },
    });
    const taskId = created.json().id as string;

    const todo1 = await server.inject({
      method: 'GET',
      url: `/api/v1/kam/accounts/${companyId}/todos`,
    });
    expect(todo1.statusCode).toBe(200);
    expect(todo1.json().items.some((i: { id: string }) => i.id === taskId)).toBe(true);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/v1/kam/tasks/${taskId}`,
      payload: { status: 'done' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().status).toBe('done');

    const todo2 = await server.inject({
      method: 'GET',
      url: `/api/v1/kam/accounts/${companyId}/todos`,
    });
    expect(todo2.json().items.some((i: { id: string }) => i.id === taskId)).toBe(false);
    expect(todo2.json().doneCount).toBeGreaterThanOrEqual(1);
  });

  t('flags stale (0 open tasks) and overloaded (>3) initiatives in the soft 1–3 hint', async () => {
    const staleInit = await newInitiative(companyId);
    const loadedInit = await newInitiative(companyId);
    for (let i = 0; i < 4; i++) {
      await server.inject({
        method: 'POST',
        url: `/api/v1/kam/initiatives/${loadedInit}/tasks`,
        payload: { title: `task ${i}` },
      });
    }
    const todo = await server.inject({
      method: 'GET',
      url: `/api/v1/kam/accounts/${companyId}/todos`,
    });
    const body = todo.json();
    expect(body.staleInitiativeIds).toContain(staleInit);
    expect(body.overloadedInitiativeIds).toContain(loadedInit);
  });

  t('rejects creating a task under a cross-tenant initiative (B3) with 404', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/kam/initiatives/${otherInitiativeId}/tasks`,
      payload: { title: 'graft' },
    });
    expect(res.statusCode).toBe(404);
  });

  t('soft-deletes a task (204) and drops it from the to-do', async () => {
    const initId = await newInitiative(companyId);
    const created = await server.inject({
      method: 'POST',
      url: `/api/v1/kam/initiatives/${initId}/tasks`,
      payload: { title: 'temp' },
    });
    const taskId = created.json().id as string;
    expect(
      (await server.inject({ method: 'DELETE', url: `/api/v1/kam/tasks/${taskId}` })).statusCode,
    ).toBe(204);
    const todo = await server.inject({
      method: 'GET',
      url: `/api/v1/kam/accounts/${companyId}/todos`,
    });
    expect(todo.json().items.some((i: { id: string }) => i.id === taskId)).toBe(false);
  });
});
