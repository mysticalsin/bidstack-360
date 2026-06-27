// Integration tests for the cross-sell action log (A2).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const ACCOUNT = 'xsell-test-account';
const createdIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('cross-sell');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.crossSellAction.deleteMany({ where: { orgId, accountKey: ACCOUNT } });
    await prisma.auditLog.deleteMany({
      where: { orgId, action: { startsWith: 'cross_sell_action.' } },
    });
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) throw new Error(`[skip] ${name}: DB/isolated org unavailable`);
    await fn();
  });

describe('cross-sell actions routes', () => {
  t('create -> list -> patch status', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/cross-sell-actions',
      payload: {
        accountKey: ACCOUNT,
        description: 'Intro the UK cyber team',
        requestingUnit: 'CA',
        assignedUnit: 'UK',
      },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: string; status: string }).id;
    createdIds.push(id);
    expect((create.json() as { status: string }).status).toBe('open');

    const list = await server.inject({
      method: 'GET',
      url: `/api/cross-sell-actions?accountKey=${ACCOUNT}`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/cross-sell-actions/${id}`,
      payload: { status: 'done' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { status: string }).status).toBe('done');

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'cross_sell_action.create', targetId: id },
    });
    expect(audit).not.toBeNull();

    const updateAudit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'cross_sell_action.update', targetId: id },
    });
    expect(updateAudit).not.toBeNull();
  });

  t('rejects an assignee from another org with 400', async () => {
    const foreignOrg = await prisma.org.create({
      data: { name: 'XSell Foreign', clerkOrg: `org_xsell_${Date.now()}` },
    });
    const foreignUser = await prisma.user.create({
      data: {
        orgId: foreignOrg.id,
        clerkUser: `u_xsell_${Date.now()}`,
        email: `xsell-${Date.now()}@t.local`,
        name: 'X',
      },
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/cross-sell-actions',
        payload: {
          accountKey: ACCOUNT,
          description: 'bad assignee',
          requestingUnit: 'CA',
          assignedUnit: 'UK',
          assigneeId: foreignUser.id,
        },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await prisma.user.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });

  t('cross-org: another org action id 404s on patch and delete', async () => {
    const foreignOrg = await prisma.org.create({
      data: { name: 'XSell Foreign2', clerkOrg: `org_xsell2_${Date.now()}` },
    });
    const foreignUser = await prisma.user.create({
      data: {
        orgId: foreignOrg.id,
        clerkUser: `u2_${Date.now()}`,
        email: `f2-${Date.now()}@t.local`,
        name: 'F',
      },
    });
    const foreignAction = await prisma.crossSellAction.create({
      data: {
        orgId: foreignOrg.id,
        accountKey: 'foreign',
        description: 'theirs',
        requestingUnit: 'X',
        assignedUnit: 'Y',
        createdById: foreignUser.id,
      },
    });
    try {
      const patch = await server.inject({
        method: 'PATCH',
        url: `/api/cross-sell-actions/${foreignAction.id}`,
        payload: { status: 'done' },
      });
      expect(patch.statusCode).toBe(404);
      const del = await server.inject({
        method: 'DELETE',
        url: `/api/cross-sell-actions/${foreignAction.id}`,
      });
      expect(del.statusCode).toBe(404);
    } finally {
      await prisma.crossSellAction.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.user.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });
});
