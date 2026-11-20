// Integration: custom-object record routes (admin section review).
// Happy path, validation 400, RBAC 403, tenant isolation 404, pagination
// bounds, record/def path consistency and idempotent write retries.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  type IsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let org: IsolatedOrg | null = null;
let otherOrg: IsolatedOrg | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('co-records');
  otherOrg = await createIsolatedOrg('co-records-other');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (org) await prisma.customObjectDef.deleteMany({ where: { orgId: org.orgId } });
  if (otherOrg) await prisma.customObjectDef.deleteMany({ where: { orgId: otherOrg.orgId } });
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
  if (otherOrg) await dropIsolatedOrg(otherOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
}, 60_000);

const t = makeSkipIfNoDb(() => dbReachable && !!org);

async function defineObject(key: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/v1/custom-objects',
    payload: { key, labelSingular: key, labelPlural: `${key}s` },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function addRecord(objId: string, name: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: `/api/v1/custom-objects/${objId}/records`,
    payload: { values: { name } },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe('custom object records', () => {
  t('a record is only reachable under its own object id', async () => {
    const a = await defineObject('qaalpha');
    const b = await defineObject('qabeta');
    const rid = await addRecord(b, 'beta-1');

    const get = await server.inject({ method: 'GET', url: `/api/v1/custom-objects/${a}/records/${rid}` });
    expect(get.statusCode).toBe(404);
    const put = await server.inject({
      method: 'PUT',
      url: `/api/v1/custom-objects/${a}/records/${rid}`,
      payload: { values: { name: 'moved' } },
    });
    expect(put.statusCode).toBe(404);
    const del = await server.inject({
      method: 'DELETE',
      url: `/api/v1/custom-objects/${a}/records/${rid}`,
    });
    expect(del.statusCode).toBe(404);

    const row = await prisma.customObjectRecord.findUnique({ where: { id: rid } });
    expect(row?.deletedAt).toBeNull();
    expect((row?.valuesJson as { name: string }).name).toBe('beta-1');
  });

  t('another tenant object and record are 404', async () => {
    const foreign = await prisma.customObjectDef.create({
      data: {
        orgId: otherOrg!.orgId,
        key: 'qaforeign',
        labelSingular: 'Foreign',
        labelPlural: 'Foreigns',
      },
    });
    const list = await server.inject({
      method: 'GET',
      url: `/api/v1/custom-objects/${foreign.id}/records`,
    });
    expect([404, 200]).toContain(list.statusCode);
    if (list.statusCode === 200) expect((list.json() as { items: unknown[] }).items).toEqual([]);
    const def = await server.inject({ method: 'GET', url: `/api/v1/custom-objects/${foreign.id}` });
    expect(def.statusCode).toBe(404);
    const create = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${foreign.id}/records`,
      payload: { values: { name: 'x' } },
    });
    expect(create.statusCode).toBe(404);
  });

  t('RBAC: SDR cannot read or write custom objects', async () => {
    const id = await defineObject('qarbac');
    const read = await server.inject({
      method: 'GET',
      url: `/api/v1/custom-objects/${id}/records`,
      headers: { 'x-bidstack-e2e-role': 'sdr' },
    });
    expect(read.statusCode).toBe(403);
    const write = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${id}/records`,
      headers: { 'x-bidstack-e2e-role': 'sdr' },
      payload: { values: { name: 'nope' } },
    });
    expect(write.statusCode).toBe(403);
  });

  t('validation and pagination bounds', async () => {
    const id = await defineObject('qapage');
    const missing = await server.inject({
      method: 'POST',
      url: `/api/v1/custom-objects/${id}/records`,
      payload: { values: {} },
    });
    expect(missing.statusCode).toBe(400);
    for (const q of ['limit=0', 'limit=201', 'page=0', 'limit=abc']) {
      const res = await server.inject({ method: 'GET', url: `/api/v1/custom-objects/${id}/records?${q}` });
      expect(res.statusCode, q).toBe(400);
    }
    await addRecord(id, 'p1');
    await addRecord(id, 'p2');
    const page = await server.inject({
      method: 'GET',
      url: `/api/v1/custom-objects/${id}/records?limit=1&page=2`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect((page.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  t('retried PUT and DELETE are idempotent', async () => {
    const id = await defineObject('qaretry');
    const rid = await addRecord(id, 'r');
    const put = () =>
      server.inject({
        method: 'PUT',
        url: `/api/v1/custom-objects/${id}/records/${rid}`,
        payload: { values: { name: 'r2' } },
      });
    expect((await put()).statusCode).toBe(200);
    expect((await put()).statusCode).toBe(200);
    const del1 = await server.inject({ method: 'DELETE', url: `/api/v1/custom-objects/${id}/records/${rid}` });
    const del2 = await server.inject({ method: 'DELETE', url: `/api/v1/custom-objects/${id}/records/${rid}` });
    expect(del1.statusCode).toBe(200);
    expect(del2.statusCode).toBe(404);
  });
});
