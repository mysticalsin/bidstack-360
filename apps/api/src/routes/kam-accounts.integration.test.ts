// Integration tests for /api/v1/kam/accounts* against the live dev DB.
// Designate (kamStatus off 'identified' + write-once keyAccountSince), the
// candidate→key-account transition, FK-graft (B3), and cross-tenant (B3).

import { randomUUID } from 'node:crypto';

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
let orgId = '';
let candidateId = '';
let sponsorUserId = '';
let otherCompanyId = '';
let otherOrgId = '';
let restoreAuth: (() => void) | undefined;
const NAME = `KAMAcct-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('kam-accounts');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  sponsorUserId = user?.id ?? '';
  const candidate = await prisma.company.create({
    data: { orgId, name: NAME, source: 'manual', countryCode: 'FR', kamStatus: 'identified' },
  });
  candidateId = candidate.id;
  const other = await prisma.org.create({
    data: { clerkOrg: `org_kamacct_${randomUUID().slice(0, 8)}`, name: 'KAMAcct Other' },
  });
  otherOrgId = other.id;
  otherCompanyId = (
    await prisma.company.create({
      data: { orgId: other.id, name: 'oc', source: 'manual', kamStatus: 'identified' },
    })
  ).id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (!dbReachable) return;
  try {
    if (candidateId) await prisma.company.deleteMany({ where: { id: candidateId } });
    if (otherOrgId) await prisma.org.deleteMany({ where: { id: otherOrgId } });
  } catch {
    /* ignore */
  }
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) throw new Error(`[skip] ${name} — DB/isolated org unavailable`);
    await fn();
  });

describe('KAM accounts — designate + switch', () => {
  t('a candidate appears in /candidates and NOT in /accounts', async () => {
    const cand = await server.inject({
      method: 'GET',
      url: `/api/v1/kam/accounts/candidates?q=${NAME.slice(0, 10)}`,
    });
    expect(cand.statusCode).toBe(200);
    expect(cand.json().items.some((c: { id: string }) => c.id === candidateId)).toBe(true);
    const list = await server.inject({ method: 'GET', url: '/api/v1/kam/accounts' });
    expect(list.json().items.some((a: { id: string }) => a.id === candidateId)).toBe(false);
  });

  t(
    'designate promotes off identified, stamps keyAccountSince, and flips it into /accounts',
    async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/kam/accounts/${candidateId}`,
        payload: {
          kamStatus: 'active',
          kamOwnerModel: 'presales_driven',
          ...(sponsorUserId ? { directorSponsorId: sponsorUserId } : {}),
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ kamStatus: 'active', kamOwnerModel: 'presales_driven' });
      expect(body.keyAccountSince).toBeTruthy();

      const list = await server.inject({ method: 'GET', url: '/api/v1/kam/accounts' });
      expect(list.json().items.some((a: { id: string }) => a.id === candidateId)).toBe(true);
      const cand = await server.inject({
        method: 'GET',
        url: `/api/v1/kam/accounts/candidates?q=${NAME.slice(0, 10)}`,
      });
      expect(cand.json().items.some((c: { id: string }) => c.id === candidateId)).toBe(false);
    },
  );

  t('keyAccountSince is write-once (a later status change does not move it)', async () => {
    const before = (await server.inject({ method: 'GET', url: '/api/v1/kam/accounts' }))
      .json()
      .items.find((a: { id: string }) => a.id === candidateId).keyAccountSince;
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/kam/accounts/${candidateId}`,
      payload: { kamStatus: 'mapped' },
    });
    expect(res.json().keyAccountSince).toBe(before);
  });

  t('rejects a cross-tenant director sponsor (B3) with 400', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/kam/accounts/${candidateId}`,
      payload: { directorSponsorId: randomUUID() },
    });
    expect(res.statusCode).toBe(400);
  });

  t('rejects designating a cross-tenant company (B3) with 404', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/kam/accounts/${otherCompanyId}`,
      payload: { kamStatus: 'active' },
    });
    expect(res.statusCode).toBe(404);
  });
});
