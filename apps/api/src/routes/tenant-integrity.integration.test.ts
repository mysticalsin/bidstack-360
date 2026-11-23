// Why these tests exist: Sweep 16 proved four integrity holes that are still
// on this tree. An unrestricted admin's account check returns before it looks
// at companyId, a client-supplied territory id was copied onto a deal, a
// soft-deleted custom-field key stayed unique, and relation counts/includes
// do not pass through the soft-delete middleware. Each case must 404 or hide
// the tombstone. A test that only checks the happy path would stay green if
// the guard was removed.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

describe('tenant integrity on related ids and soft-deletes', () => {
  let server: FastifyInstance | null = null;
  let dbReachable = false;
  let orgId = '';
  let otherOrgId = '';
  let restoreAuth: (() => void) | null = null;
  const namespace = randomUUID().slice(0, 8);

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }

    const org = await createIsolatedOrg('integrity');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

    const other = await prisma.org.create({
      data: { clerkOrg: `org_integrity_other_${namespace}`, name: 'Quay Synthetic' },
    });
    otherOrgId = other.id;

    server = await buildServer();
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    if (server) await server.close();
    if (restoreAuth) restoreAuth();
    if (otherOrgId) {
      await prisma.org.delete({ where: { id: otherOrgId } }).catch(() => undefined);
    }
    if (orgId) await dropIsolatedOrg(orgId);
    if (dbReachable) await prisma.$disconnect();
  });

  function requireReady(): FastifyInstance {
    if (!dbReachable || !server) {
      throw new Error('[skip] tenant integrity — DATABASE_URL not reachable');
    }
    return server;
  }

  const opportunityBody = (territoryId: string | null) => ({
    customer: `Integrity ${namespace}`,
    name: `Integrity bid ${namespace}`,
    stage: null,
    value: 12,
    probability: 20,
    dueDate: null,
    owner: null,
    industry: null,
    logo: null,
    country: null,
    territoryId,
  });

  it('rejects a territory that belongs to another org on create and patch', async () => {
    const app = requireReady();
    const owner = await prisma.user.findFirstOrThrow({
      where: { orgId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const foreignOwner = await prisma.user.create({
      data: {
        orgId: otherOrgId,
        clerkUser: `user_integrity_${namespace}`,
        email: `quay.${namespace}@example.test`,
        name: 'Quay Owner',
      },
      select: { id: true },
    });
    const [ownTerritory, foreignTerritory] = await Promise.all([
      prisma.territory.create({
        data: {
          orgId,
          name: 'Harbor Region',
          countryCodes: ['FR'],
          ownerId: owner.id,
        },
        select: { id: true },
      }),
      prisma.territory.create({
        data: {
          orgId: otherOrgId,
          name: 'Quay Region',
          countryCodes: ['GB'],
          ownerId: foreignOwner.id,
        },
        select: { id: true },
      }),
    ]);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/opportunities',
      payload: opportunityBody(foreignTerritory.id),
    });
    expect(rejected.statusCode).toBe(404);
    expect(
      await prisma.opportunity.count({
        where: { orgId, territoryId: foreignTerritory.id },
      }),
    ).toBe(0);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/opportunities',
      payload: opportunityBody(ownTerritory.id),
    });
    expect(created.statusCode).toBe(201);
    const opportunityId = created.json<{ id: string; territoryId: string }>().id;
    expect(created.json<{ territoryId: string }>().territoryId).toBe(ownTerritory.id);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/opportunities/${opportunityId}`,
      payload: { territoryId: foreignTerritory.id },
    });
    expect(patched.statusCode).toBe(404);
    const stored = await prisma.opportunity.findFirstOrThrow({
      where: { id: opportunityId, orgId },
      select: { territoryId: true },
    });
    expect(stored.territoryId).toBe(ownTerritory.id);
  });

  it('rejects a note that points at another org company', async () => {
    const app = requireReady();
    const foreign = await prisma.company.create({
      data: { orgId: otherOrgId, name: `Quay Co ${namespace}` },
      select: { id: true },
    });
    const own = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      payload: {
        name: `Harbor Co ${namespace}`,
        legalName: null,
        domain: `harbor-${namespace}.example.test`,
        industry: null,
        employeeCount: null,
        countryCode: null,
        address: null,
        billingEmail: null,
        taxId: null,
        logoUrl: null,
        website: null,
        tier: 'standard',
      },
    });
    expect(own.statusCode).toBe(201);
    const ownId = own.json<{ id: string }>().id;

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: {
        accountId: `harbor-${namespace}`,
        companyId: foreign.id,
        title: 'Cross-org note',
        bodyMd: 'must not store',
      },
    });
    expect(rejected.statusCode).toBe(404);
    expect(await prisma.note.count({ where: { orgId, companyId: foreign.id } })).toBe(0);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: {
        accountId: `harbor-${namespace}`,
        companyId: ownId,
        title: 'Own-org note',
        bodyMd: 'stored',
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json<{ companyId: string }>().companyId).toBe(ownId);
  });

  it('frees a custom-field key on soft delete and hides the old value', async () => {
    const app = requireReady();
    const company = await prisma.company.create({
      data: { orgId, name: `Field Co ${namespace}` },
      select: { id: true },
    });
    const key = `keep_${namespace}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields/definitions',
      payload: {
        entityType: 'company',
        fieldKey: key,
        label: 'Keep me',
        fieldType: 'text',
      },
    });
    expect(created.statusCode).toBe(201);
    const definitionId = created.json<{ id: string }>().id;

    const written = await app.inject({
      method: 'PATCH',
      url: '/api/v1/custom-fields/values',
      payload: {
        entityType: 'company',
        entityId: company.id,
        values: { [definitionId]: 'keep-me' },
      },
    });
    expect(written.statusCode).toBe(200);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/custom-fields/definitions/${definitionId}`,
    });
    expect(removed.statusCode).toBe(200);

    const recreated = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields/definitions',
      payload: {
        entityType: 'company',
        fieldKey: key,
        label: 'Keep me again',
        fieldType: 'text',
      },
    });
    expect(recreated.statusCode).toBe(201);
    expect(recreated.json<{ id: string }>().id).not.toBe(definitionId);

    const values = await app.inject({
      method: 'GET',
      url: `/api/v1/custom-fields/values?entityType=company&entityId=${company.id}`,
    });
    expect(values.statusCode).toBe(200);
    const items = values.json<{ items: Array<{ definitionId: string }> }>().items;
    expect(items.map((item) => item.definitionId)).not.toContain(definitionId);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${company.id}`,
    });
    expect(detail.statusCode).toBe(200);
    const detailValues = detail.json<{ customFieldValues: Array<{ definitionId: string }> }>()
      .customFieldValues;
    expect(detailValues.map((item) => item.definitionId)).not.toContain(definitionId);
  });

  it('drops a soft-deleted parent from the child and ignores tombstoned tasks', async () => {
    const app = requireReady();
    const parent = await prisma.company.create({
      data: { orgId, name: `Parent ${namespace}` },
      select: { id: true },
    });
    const child = await prisma.company.create({
      data: { orgId, name: `Child ${namespace}`, parentId: parent.id },
      select: { id: true },
    });
    const deletedParent = await app.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${parent.id}`,
    });
    expect(deletedParent.statusCode).toBe(204);

    const childRow = await prisma.company.findFirstOrThrow({
      where: { id: child.id },
      select: { parentId: true },
    });
    expect(childRow.parentId).toBeNull();

    // A row that already pointed at a tombstone (delete ran before this
    // detach existed) must still not render the dead parent's name.
    await prisma.company.update({
      where: { id: child.id },
      data: { parentId: parent.id },
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${child.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ parent: { name: string } | null }>().parent).toBeNull();

    const opportunity = await prisma.opportunity.create({
      data: {
        orgId,
        code: `INT-${namespace}`,
        customer: `Task Count ${namespace}`,
        name: `Task count ${namespace}`,
        stage: 's1_lead',
        valueMicros: 1_000_000n,
        probability: 10,
      },
      select: { id: true },
    });
    const [live, tombstone] = await Promise.all([
      prisma.task.create({
        data: { orgId, oppId: opportunity.id, title: `Live ${namespace}` },
        select: { id: true },
      }),
      prisma.task.create({
        data: { orgId, oppId: opportunity.id, title: `Gone ${namespace}` },
        select: { id: true },
      }),
    ]);
    await prisma.task.update({
      where: { id: tombstone.id },
      data: { deletedAt: new Date() },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/opportunities?search=${encodeURIComponent(`Task Count ${namespace}`)}`,
    });
    expect(list.statusCode).toBe(200);
    const row = list.json<{ items: Array<{ id: string; taskCount: number }> }>().items.find(
      (item) => item.id === opportunity.id,
    );
    expect(row?.taskCount).toBe(1);

    const full = await app.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opportunity.id}`,
    });
    expect(full.statusCode).toBe(200);
    const titles = full.json<{ tasks: Array<{ id: string; title: string }> }>().tasks;
    expect(titles.map((task) => task.id)).toEqual([live.id]);
  });
});
