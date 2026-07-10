// Integration tests for the cross-sell action log (A2).
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
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
let stubUserId: string | null = null;
let restoreAuth: (() => void) | null = null;
const ACCOUNT = 'xsell-test-account';
const createdIds: string[] = [];
const cleanupCompanyIds: string[] = [];
const cleanupGroupIds: string[] = [];

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
  const stubUser = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  stubUserId = stubUser?.id ?? null;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.crossSellAction.deleteMany({
      where: { orgId, OR: [{ accountKey: ACCOUNT }, { id: { in: createdIds } }] },
    });
    if (cleanupGroupIds.length > 0) {
      await prisma.userGroupMember.deleteMany({
        where: { orgId, groupId: { in: cleanupGroupIds } },
      });
      await prisma.userGroup.deleteMany({ where: { orgId, id: { in: cleanupGroupIds } } });
    }
    if (cleanupCompanyIds.length > 0) {
      await prisma.company.deleteMany({ where: { orgId, id: { in: cleanupCompanyIds } } });
    }
    await prisma.auditLog.deleteMany({
      where: { orgId, action: { startsWith: 'cross_sell_action.' } },
    });
    if (stubUserId) invalidateAccessScope(orgId, stubUserId);
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

function accountKeyFor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

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

  t('requires read scope on list and rejects API-key write actors', async () => {
    const writeOnlyRawKey = `xsell_write_only_${randomUUID()}`;
    const writeOnlyApiKey = await prisma.apiKey.create({
      data: {
        orgId: orgId!,
        name: 'cross-sell write-only integration key',
        hashedKey: createHash('sha256').update(writeOnlyRawKey).digest('hex'),
        prefix: writeOnlyRawKey.slice(0, 8),
        scopes: ['write'],
      },
    });
    const writeRawKey = `xsell_write_${randomUUID()}`;
    const writeApiKey = await prisma.apiKey.create({
      data: {
        orgId: orgId!,
        name: 'cross-sell write integration key',
        hashedKey: createHash('sha256').update(writeRawKey).digest('hex'),
        prefix: writeRawKey.slice(0, 8),
        scopes: ['read', 'write'],
      },
    });
    try {
      const list = await server.inject({
        method: 'GET',
        url: `/api/cross-sell-actions?accountKey=${ACCOUNT}`,
        headers: { 'x-api-key': writeOnlyRawKey },
      });
      expect(list.statusCode).toBe(403);

      const create = await server.inject({
        method: 'POST',
        url: '/api/cross-sell-actions',
        headers: { 'x-api-key': writeRawKey },
        payload: {
          accountKey: ACCOUNT,
          description: 'API key should not create human action',
          requestingUnit: 'CA',
          assignedUnit: 'UK',
        },
      });
      expect(create.statusCode).toBe(403);
      expect(create.json<{ message: string }>().message).toContain('user session');
    } finally {
      await prisma.apiKey.deleteMany({
        where: { id: { in: [writeOnlyApiKey.id, writeApiKey.id] } },
      });
    }
  });

  t('filters org-wide list by account visibility scope', async () => {
    if (!stubUserId) throw new Error('[skip] scoped cross-sell: no stub user');
    const marker = `XSell Scope ${randomUUID()}`;
    const visibleName = `${marker} ZZ`;
    const hiddenName = `${marker} QQ`;
    const visibleKey = accountKeyFor(visibleName);
    const hiddenKey = accountKeyFor(hiddenName);

    const [visibleCompany, hiddenCompany] = await Promise.all([
      prisma.company.create({
        data: { orgId: orgId!, name: visibleName, countryCode: 'ZZ', tier: 'key' },
      }),
      prisma.company.create({
        data: { orgId: orgId!, name: hiddenName, countryCode: 'QQ', tier: 'key' },
      }),
    ]);
    cleanupCompanyIds.push(visibleCompany.id, hiddenCompany.id);

    const [visibleAction, hiddenAction] = await Promise.all([
      prisma.crossSellAction.create({
        data: {
          orgId: orgId!,
          accountKey: visibleKey,
          description: 'visible expansion action',
          requestingUnit: 'FR',
          assignedUnit: 'DE',
          createdById: stubUserId,
        },
      }),
      prisma.crossSellAction.create({
        data: {
          orgId: orgId!,
          accountKey: hiddenKey,
          description: 'hidden expansion action',
          requestingUnit: 'FR',
          assignedUnit: 'DE',
          createdById: stubUserId,
        },
      }),
    ]);
    createdIds.push(visibleAction.id, hiddenAction.id);

    const group = await prisma.userGroup.create({
      data: {
        orgId: orgId!,
        name: `Cross-sell scoped group ${randomUUID()}`,
        scopeCountries: ['ZZ'],
        scopeAll: false,
      },
    });
    cleanupGroupIds.push(group.id);
    await prisma.userGroupMember.create({
      data: { orgId: orgId!, groupId: group.id, userId: stubUserId },
    });
    invalidateAccessScope(orgId!, stubUserId);

    try {
      const list = await server.inject({ method: 'GET', url: '/api/cross-sell-actions' });
      expect(list.statusCode).toBe(200);
      const keys = new Set(
        list.json<{ items: Array<{ accountKey: string }> }>().items.map((item) => item.accountKey),
      );
      expect(keys.has(visibleKey)).toBe(true);
      expect(keys.has(hiddenKey)).toBe(false);

      const hiddenDirect = await server.inject({
        method: 'GET',
        url: `/api/cross-sell-actions?accountKey=${hiddenKey}`,
      });
      expect(hiddenDirect.statusCode).toBe(404);

      const visibleDirect = await server.inject({
        method: 'GET',
        url: `/api/cross-sell-actions?accountKey=${visibleKey}`,
      });
      expect(visibleDirect.statusCode).toBe(200);
      expect(visibleDirect.json<{ items: Array<{ accountKey: string }> }>().items).toHaveLength(1);
    } finally {
      await prisma.userGroupMember.deleteMany({
        where: { orgId: orgId!, groupId: group.id, userId: stubUserId },
      });
      await prisma.userGroup.deleteMany({ where: { orgId: orgId!, id: group.id } });
      const groupIndex = cleanupGroupIds.indexOf(group.id);
      if (groupIndex >= 0) cleanupGroupIds.splice(groupIndex, 1);
      invalidateAccessScope(orgId!, stubUserId);
    }
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
