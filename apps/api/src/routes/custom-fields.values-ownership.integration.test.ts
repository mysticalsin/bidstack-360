// Custom-field values are org data. A definition id from another org must not
// be stored (the FK would cascade-delete this org's value when they delete
// their field, and the id's existence is a cross-tenant oracle). An entity id
// from another org must 404, the same as every other :id read.
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
let otherOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let companyId = '';
let otherCompanyId = '';
let ownDefinitionId = '';
let foreignDefinitionId = '';

describe('custom field value ownership', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('cf-values');
    const other = await createIsolatedOrg('cf-values-b');
    orgId = org.orgId;
    otherOrgId = other.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    companyId = (await prisma.company.findFirstOrThrow({ where: { orgId }, select: { id: true } })).id;
    otherCompanyId = (
      await prisma.company.findFirstOrThrow({ where: { orgId: other.orgId }, select: { id: true } })
    ).id;
    ownDefinitionId = (
      await prisma.customFieldDefinition.create({
        data: {
          orgId,
          entityType: 'company',
          fieldKey: 'plant',
          label: 'Plant',
          fieldType: 'text',
        },
        select: { id: true },
      })
    ).id;
    foreignDefinitionId = (
      await prisma.customFieldDefinition.create({
        data: {
          orgId: other.orgId,
          entityType: 'company',
          fieldKey: 'plant',
          label: 'Plant',
          fieldType: 'text',
        },
        select: { id: true },
      })
    ).id;
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
    if (otherOrgId) await dropIsolatedOrg(otherOrgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('GET of another org company id is 404', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/custom-fields/values?entityType=company&entityId=${otherCompanyId}`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('PATCH refuses another org company id and writes nothing', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/v1/custom-fields/values',
      headers: { authorization: 'Bearer stub' },
      payload: {
        entityType: 'company',
        entityId: otherCompanyId,
        values: { [ownDefinitionId]: 'north' },
      },
    });
    expect(res.statusCode).toBe(404);
    const stored = await prisma.customFieldValue.count({
      where: { orgId: orgId!, entityId: otherCompanyId },
    });
    expect(stored).toBe(0);
  });

  skipIfNoDb('PATCH refuses another org definition id and writes nothing', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/v1/custom-fields/values',
      headers: { authorization: 'Bearer stub' },
      payload: {
        entityType: 'company',
        entityId: companyId,
        values: { [foreignDefinitionId]: 'north' },
      },
    });
    expect(res.statusCode).toBe(400);
    const stored = await prisma.customFieldValue.count({
      where: { orgId: orgId!, definitionId: foreignDefinitionId },
    });
    expect(stored).toBe(0);
  });

  skipIfNoDb('PATCH stores a value for this org definition on this org company', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/v1/custom-fields/values',
      headers: { authorization: 'Bearer stub' },
      payload: {
        entityType: 'company',
        entityId: companyId,
        values: { [ownDefinitionId]: 'north' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ definitionId: string; value: unknown }> };
    expect(body.items).toEqual([
      expect.objectContaining({ definitionId: ownDefinitionId, value: 'north' }),
    ]);
  });
});
