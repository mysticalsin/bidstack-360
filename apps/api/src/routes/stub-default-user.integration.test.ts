// WHY: stub auth picks the oldest user in the org when no role header is
// sent. A read-only override user created earlier keeps that createdAt when
// the header moves them into this org, so the next header-less request is
// no longer the Admin. settings:write then fails closed with 403, including
// a call that should have been 404.

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restore: (() => void) | undefined;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  await prisma.user.upsert({
    where: { email: 'e2e-read-only@bidstack.local' },
    create: {
      orgId: (await prisma.org.findFirstOrThrow()).id,
      clerkUser: 'e2e_read_only',
      email: 'e2e-read-only@bidstack.local',
      name: 'E2E Read Only',
      role: 'member',
      createdAt: new Date(Date.now() - 24 * 3600_000),
    },
    update: {
      role: 'member',
      createdAt: new Date(Date.now() - 24 * 3600_000),
    },
  });
  org = await createIsolatedOrg('stub-default');
  restore = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  restore?.();
  if (server) await server.close();
  if (org) await dropIsolatedOrg(org.orgId);
});

const t = makeSkipIfNoDb(() => dbReachable);

describe('stub default user', () => {
  t('a read-only override does not replace the admin on the next request', async () => {
    const missing = '00000000-0000-4000-8000-000000000099';
    const asReader = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${missing}/cancel`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(asReader.statusCode).toBe(403);

    const asDefault = await server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${missing}/cancel`,
    });
    expect(asDefault.statusCode).toBe(404);
  });
});
