// GET /users hides former members unless the caller asks for them with
// ?includeDeleted=true, which pickers and history views use to keep showing
// the names of people who left.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let formerId = '';

interface Row {
  id: string;
  name: string | null;
  deletedAt?: string | null;
}

async function list(query = ''): Promise<Row[]> {
  const res = await server.inject({ method: 'GET', url: `/api/v1/users?limit=200${query}` });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { items: Row[] }).items;
}

beforeAll(async () => {
  const org = await createIsolatedOrg('users-list');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const tag = randomUUID().slice(0, 8);
  formerId = (
    await prisma.user.create({
      data: {
        orgId,
        clerkUser: `user_former_${tag}`,
        email: `former-${tag}@example.test`,
        name: 'Former Colleague',
        role: 'member',
        deletedAt: new Date('2026-09-01T00:00:00Z'),
      },
    })
  ).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
});

describe('GET /users', () => {
  it('leaves former members out by default and does not add deletedAt', async () => {
    const rows = await list();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.id)).not.toContain(formerId);
    expect(rows.every((r) => !('deletedAt' in r))).toBe(true);
    expect((await list('&includeDeleted=false')).map((r) => r.id)).not.toContain(formerId);
  });

  it('includeDeleted=true returns them with their name and deletedAt for pickers', async () => {
    const rows = await list('&includeDeleted=true');
    const former = rows.find((r) => r.id === formerId);
    expect(former?.name).toBe('Former Colleague');
    expect(former?.deletedAt).toBe('2026-09-01T00:00:00.000Z');
    const active = rows.filter((r) => r.id !== formerId);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((r) => r.deletedAt === null)).toBe(true);
  });

  it('rejects anything but true or false', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/users?includeDeleted=yes' });
    expect(res.statusCode).toBe(400);
  });
});
