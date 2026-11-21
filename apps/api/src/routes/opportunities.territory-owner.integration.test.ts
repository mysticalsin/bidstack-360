// A territory id is a foreign key with no org column in the key. Copying the
// caller's territoryId onto the deal without an org check stores Quay's
// territory on Harbor's opportunity, and the create/list payload then returns
// Quay's territory name.
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

const HARBOR = 'Harbor Synthetic Co';
const QUAY_TERRITORY = 'Quay Synthetic Region';

let server: FastifyInstance;
let dbReachable = false;
let harborOrgId: string | null = null;
let quayOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let quayTerritoryId = '';
let harborTerritoryId = '';

const deal = {
  customer: HARBOR,
  name: 'Berth expansion',
  value: 12000,
  probability: 20,
  dueDate: null,
  owner: null,
  industry: 'logistics',
  logo: null,
  country: null,
  stage: null,
  pipelineStageId: null,
};

describe('opportunity territory ownership', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const harbor = await createIsolatedOrg('harbor-territory');
    const quay = await createIsolatedOrg('quay-territory');
    harborOrgId = harbor.orgId;
    quayOrgId = quay.orgId;
    restoreAuth = useIsolatedOrgAuth(harbor.clerkOrg);
    const harborOwner = await prisma.user.findFirstOrThrow({
      where: { orgId: harbor.orgId },
      select: { id: true },
    });
    const quayOwner = await prisma.user.findFirstOrThrow({
      where: { orgId: quay.orgId },
      select: { id: true },
    });
    harborTerritoryId = (
      await prisma.territory.create({
        data: {
          orgId: harbor.orgId,
          name: 'Harbor Synthetic Region',
          countryCodes: ['HS'],
          ownerId: harborOwner.id,
        },
        select: { id: true },
      })
    ).id;
    quayTerritoryId = (
      await prisma.territory.create({
        data: {
          orgId: quay.orgId,
          name: QUAY_TERRITORY,
          countryCodes: ['QS'],
          ownerId: quayOwner.id,
        },
        select: { id: true },
      })
    ).id;
    server = await buildServer();
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (harborOrgId) await dropIsolatedOrg(harborOrgId);
    if (quayOrgId) await dropIsolatedOrg(quayOrgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!harborOrgId);

  skipIfNoDb('create refuses another org territory and stores nothing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/opportunities',
      payload: { ...deal, territoryId: quayTerritoryId },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).not.toContain(QUAY_TERRITORY);
    const linked = await prisma.opportunity.count({
      where: { orgId: harborOrgId!, territoryId: quayTerritoryId },
    });
    expect(linked).toBe(0);
  });

  skipIfNoDb('patch refuses another org territory and leaves the deal unchanged', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/opportunities',
      payload: { ...deal, name: 'Own berth', territoryId: null },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { id: string }).id;

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/opportunities/${id}`,
      payload: { territoryId: quayTerritoryId },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).not.toContain(QUAY_TERRITORY);
    const stored = await prisma.opportunity.findFirstOrThrow({
      where: { id, orgId: harborOrgId! },
      select: { territoryId: true },
    });
    expect(stored.territoryId).toBeNull();
  });

  skipIfNoDb('create accepts a territory in the caller org', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/opportunities',
      payload: { ...deal, name: 'Home berth', territoryId: harborTerritoryId },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      territoryId: harborTerritoryId,
      territoryName: 'Harbor Synthetic Region',
    });
  });
});
