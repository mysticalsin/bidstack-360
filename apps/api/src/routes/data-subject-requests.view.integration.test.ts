// WHY: the API view used to return the raw varchar. An unknown stored status
// must be shown as failed through the same table the worker uses, and the
// stored value must stay put so a later writer does not treat it as queued.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';

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
  org = await createIsolatedOrg('dsr-view');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

describe('data subject request view', () => {
  it('maps an unknown stored status to failed and does not rewrite the row', async () => {
    if (!dbReachable) throw new Error('[skip] DATABASE_URL not reachable');
    const row = await prisma.dataSubjectRequest.create({
      data: {
        orgId: org.orgId,
        kind: 'export',
        subjectType: 'contact',
        subjectId: randomUUID(),
        dryRun: true,
        status: 'mystery',
      },
    });
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/orgs/${org.orgId}/data-subject-requests/${row.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('failed');
    const stored = await prisma.dataSubjectRequest.findFirst({
      where: { id: row.id, orgId: org.orgId },
    });
    expect(stored?.status).toBe('mystery');
  });
});
