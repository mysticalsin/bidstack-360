// Two proposals with the same updatedAt must page in a stable id order.
// updatedAt alone is not unique, so offset pages can repeat or skip a row.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: FastifyInstance;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let higherId = '';
let lowerId = '';
const token = `tie-${Date.now()}`;

describe('proposal list order', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('proposal-order');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const first = await prisma.proposal.create({ data: { orgId, name: `${token} one` } });
    const second = await prisma.proposal.create({ data: { orgId, name: `${token} two` } });
    higherId = first.id > second.id ? first.id : second.id;
    lowerId = first.id > second.id ? second.id : first.id;
    const stamp = new Date('2026-06-01T00:00:00.000Z');
    await prisma.$executeRaw`UPDATE proposals SET updated_at = ${stamp} WHERE id IN (${first.id}::uuid, ${second.id}::uuid)`;
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('pages a tied updatedAt by id descending', async () => {
    const headers = { authorization: 'Bearer stub' };
    const page = async (offset: number) => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/proposals?search=${token}&limit=1&offset=${offset}`,
        headers,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { items: Array<{ id: string }>; total: number });
    };
    const first = await page(0);
    const second = await page(1);
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(first.items[0]?.id).toBe(higherId);
    expect(second.items[0]?.id).toBe(lowerId);
  });
});
