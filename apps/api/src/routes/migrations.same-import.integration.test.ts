// Same import is one org, one source, and one uploaded file. The file is the
// sha256 of its rows. A second start of that file is refused. A different
// file proceeds, including one started while the first is still running.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';
import { retireActiveImports } from './migrations.test-helpers.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('same-import');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

beforeEach(async () => {
  if (org) await retireActiveImports(org.orgId);
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

function start(rows: Array<Record<string, string>>) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/migrations/start-csv',
    payload: {
      source: 'CSV',
      entityType: 'company',
      rows,
      mappings: { name: 'company.name' },
    },
  });
}

describe('same import guard', () => {
  t('a different file can start while another import is still running', async () => {
    // WHY: the guard used to be one active CSV per org. A second file, or
    // another user with their own file, has to proceed.
    const first = await start([{ name: 'North file' }]);
    const second = await start([{ name: 'South file' }]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json<{ id: string }>().id).not.toBe(first.json<{ id: string }>().id);
  });

  t('starting the same file twice returns 409', async () => {
    // WHY: the same uploaded rows are the same import. The second start must
    // not open a second job while the first is still active.
    const rows = [{ name: 'Same file', city: 'Lyon' }];
    const [first, second] = await Promise.all([start(rows), start([{ city: 'Lyon', name: 'Same file' }])]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const refused = first.statusCode === 409 ? first : second;
    expect(refused.json()).toMatchObject({ message: expect.stringMatching(/already running/) });
    const winnerId = (first.statusCode === 201 ? first : second).json<{ id: string }>().id;
    expect(await prisma.migrationJob.count({ where: { orgId: org.orgId, id: winnerId } })).toBe(1);
  });
});
