// Integration tests for /api/workflows/* (admin section review).
// Covers happy path, validation 400, RBAC 403, tenant isolation 404,
// pagination bounds, boolean query parsing and idempotent write retries.

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
let foreignWorkflowId: string | null = null;

const VALID = {
  name: 'Review audit workflow',
  description: null,
  active: true,
  triggerKind: 'manual',
  triggerConfig: {},
  actions: [],
};

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
  org = await createIsolatedOrg('workflows');
  otherOrg = await createIsolatedOrg('workflows-other');
  const foreign = await prisma.workflow.create({
    data: {
      orgId: otherOrg.orgId,
      name: 'Other tenant workflow',
      triggerKind: 'manual',
      triggerConfig: {},
    },
  });
  foreignWorkflowId = foreign.id;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
  if (otherOrg) await dropIsolatedOrg(otherOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
}, 60_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!org);

async function create(payload: Record<string, unknown> = VALID) {
  return server.inject({ method: 'POST', url: '/api/workflows', payload });
}

describe('workflows routes', () => {
  skipIfNoDb('creates, reads, lists and runs a workflow', async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;

    const get = await server.inject({ method: 'GET', url: `/api/workflows/${id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ id, name: VALID.name, active: true });

    const list = await server.inject({ method: 'GET', url: '/api/workflows?limit=200' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: { id: string }[] }).items.some((w) => w.id === id)).toBe(true);

    const run = await server.inject({
      method: 'POST',
      url: `/api/workflows/${id}/run`,
      payload: { input: {} },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({ workflowId: id, status: 'succeeded' });

    const runs = await server.inject({ method: 'GET', url: `/api/workflows/${id}/runs` });
    expect(runs.statusCode).toBe(200);
    expect((runs.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  skipIfNoDb('rejects an invalid body with 400', async () => {
    const res = await create({ ...VALID, name: '' });
    expect(res.statusCode).toBe(400);
    const bad = await create({ ...VALID, triggerKind: 'not-a-trigger' });
    expect(bad.statusCode).toBe(400);
  });

  skipIfNoDb('enforces RBAC: SDR cannot read, Read-Only cannot write', async () => {
    const read = await server.inject({
      method: 'GET',
      url: '/api/workflows',
      headers: { 'x-bidstack-e2e-role': 'sdr' },
    });
    expect(read.statusCode).toBe(403);
    const write = await server.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: VALID,
    });
    expect(write.statusCode).toBe(403);
  });

  skipIfNoDb('hides another tenant workflow behind 404 on every route', async () => {
    const id = foreignWorkflowId!;
    const get = await server.inject({ method: 'GET', url: `/api/workflows/${id}` });
    expect(get.statusCode).toBe(404);
    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/workflows/${id}`,
      payload: { name: 'hijack' },
    });
    expect(patch.statusCode).toBe(404);
    const run = await server.inject({
      method: 'POST',
      url: `/api/workflows/${id}/run`,
      payload: { input: {} },
    });
    expect(run.statusCode).toBe(404);
    const runs = await server.inject({ method: 'GET', url: `/api/workflows/${id}/runs` });
    expect(runs.statusCode).toBe(404);
    const del = await server.inject({ method: 'DELETE', url: `/api/workflows/${id}` });
    expect(del.statusCode).toBe(404);
    const still = await prisma.workflow.findUnique({ where: { id } });
    expect(still?.name).toBe('Other tenant workflow');
    expect(still?.deletedAt).toBeNull();
  });

  skipIfNoDb('bounds pagination', async () => {
    for (const limit of ['0', '201', '-1', 'abc']) {
      const res = await server.inject({ method: 'GET', url: `/api/workflows?limit=${limit}` });
      expect(res.statusCode, `limit=${limit}`).toBe(400);
    }
    const runs = await server.inject({
      method: 'GET',
      url: `/api/workflows/${foreignWorkflowId}/runs?limit=101`,
    });
    expect(runs.statusCode).toBe(400);
  });

  skipIfNoDb('active=false lists only paused workflows', async () => {
    const paused = await create({ ...VALID, name: 'Paused workflow', active: false });
    expect(paused.statusCode).toBe(201);
    const pausedId = (paused.json() as { id: string }).id;

    const res = await server.inject({ method: 'GET', url: '/api/workflows?active=false&limit=200' });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { id: string; active: boolean }[] }).items;
    expect(items.some((w) => w.id === pausedId)).toBe(true);
    expect(items.every((w) => w.active === false)).toBe(true);

    const active = await server.inject({ method: 'GET', url: '/api/workflows?active=true&limit=200' });
    const activeItems = (active.json() as { items: { id: string; active: boolean }[] }).items;
    expect(activeItems.some((w) => w.id === pausedId)).toBe(false);

    const junk = await server.inject({ method: 'GET', url: '/api/workflows?active=maybe' });
    expect(junk.statusCode).toBe(400);
  });

  skipIfNoDb('retried PATCH and DELETE are idempotent', async () => {
    const res = await create({ ...VALID, name: 'Retry target' });
    const id = (res.json() as { id: string }).id;
    const patch = () =>
      server.inject({
        method: 'PATCH',
        url: `/api/workflows/${id}`,
        payload: {
          name: 'Retried',
          actions: [{ kind: 'create_notification', config: { message: 'hi' }, sortOrder: 0 }],
        },
      });
    const first = await patch();
    const second = await patch();
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { actions: unknown[] }).actions).toHaveLength(1);
    expect(await prisma.workflowAction.count({ where: { workflowId: id } })).toBe(1);

    const del1 = await server.inject({ method: 'DELETE', url: `/api/workflows/${id}` });
    const del2 = await server.inject({ method: 'DELETE', url: `/api/workflows/${id}` });
    expect(del1.statusCode).toBe(204);
    expect(del2.statusCode).toBe(404);
  });
});
