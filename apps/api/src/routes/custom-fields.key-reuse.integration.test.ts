// Soft-deleting a custom field leaves the (org, entity, key) unique row in
// place, so the key cannot be created again, and the values of that field
// stay on the entity read because the definition include is not filtered.
import { randomUUID } from 'node:crypto';

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
let companyId = '';

describe('custom field key after soft delete', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('cf-key');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    companyId = (
      await prisma.company.findFirstOrThrow({
        where: { orgId: org.orgId, deletedAt: null },
        select: { id: true },
      })
    ).id;
    server = await buildServer();
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  async function createField(fieldKey: string): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/custom-fields/definitions',
      payload: {
        entityType: 'company',
        fieldKey,
        label: 'Berth',
        fieldType: 'text',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }

  skipIfNoDb('values of a deleted field are not listed on the company', async () => {
    const fieldKey = `berth_${randomUUID().slice(0, 8)}`;
    const firstId = await createField(fieldKey);
    const written = await server.inject({
      method: 'PATCH',
      url: '/api/v1/custom-fields/values',
      payload: {
        entityType: 'company',
        entityId: companyId,
        values: { [firstId]: 'keep-me' },
      },
    });
    expect(written.statusCode, written.body).toBe(200);

    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/custom-fields/definitions/${firstId}`,
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const listed = await server.inject({
      method: 'GET',
      url: `/api/v1/custom-fields/values?entityType=company&entityId=${companyId}`,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const items = (listed.json() as { items: Array<{ definitionId: string; value: unknown }> })
      .items;
    expect(items.some((item) => item.definitionId === firstId && item.value === 'keep-me')).toBe(
      false,
    );
  });

  skipIfNoDb('the same field key can be created again after delete', async () => {
    const fieldKey = `quay_${randomUUID().slice(0, 8)}`;
    const firstId = await createField(fieldKey);
    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/custom-fields/definitions/${firstId}`,
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const second = await server.inject({
      method: 'POST',
      url: '/api/v1/custom-fields/definitions',
      payload: {
        entityType: 'company',
        fieldKey,
        label: 'Berth again',
        fieldType: 'text',
      },
    });
    expect(second.statusCode, second.body).toBe(201);
    const secondId = (second.json() as { id: string }).id;
    expect(secondId).not.toBe(firstId);

    const defs = await server.inject({
      method: 'GET',
      url: '/api/v1/custom-fields/definitions?entityType=company',
    });
    expect(defs.statusCode, defs.body).toBe(200);
    const keys = (
      defs.json() as { items: Array<{ id: string; fieldKey: string }> }
    ).items.filter((item) => item.fieldKey === fieldKey);
    expect(keys).toEqual([expect.objectContaining({ id: secondId, fieldKey })]);
  });
});
