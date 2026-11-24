// PATCH /opportunities/:id accepts customFieldValues. Contacts, companies, and
// leads reject a definition id from another org. This route did not, so the
// value row's foreign key pointed at the other org's field.
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
let opportunityId = '';
let foreignDefinitionId = '';

describe('opportunity custom field ownership', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('opp-cf');
    const other = await createIsolatedOrg('opp-cf-b');
    orgId = org.orgId;
    otherOrgId = other.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    opportunityId = (
      await prisma.opportunity.findFirstOrThrow({ where: { orgId }, select: { id: true } })
    ).id;
    foreignDefinitionId = (
      await prisma.customFieldDefinition.create({
        data: {
          orgId: other.orgId,
          entityType: 'opportunity',
          fieldKey: 'bid_code',
          label: 'Bid code',
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

  skipIfNoDb('PATCH rejects a definition owned by another org and stores nothing', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/opportunities/${opportunityId}`,
      headers: { authorization: 'Bearer stub' },
      payload: { customFieldValues: [{ definitionId: foreignDefinitionId, value: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    const stored = await prisma.customFieldValue.count({
      where: { orgId: orgId!, entityId: opportunityId, definitionId: foreignDefinitionId },
    });
    expect(stored).toBe(0);
  });
});
