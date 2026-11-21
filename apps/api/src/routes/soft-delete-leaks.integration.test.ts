// Soft-delete middleware only filters the top-level where. Relation counts,
// raw joins, and a to-one include still read tombstones, and deleting a
// company leaves its children pointing at that tombstone.
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

const PARENT_NAME = 'Harbor Parent Synthetic';
const DEAL_MICROS = 5_000_000_000n;

let server: FastifyInstance;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

describe('soft-deleted rows stay out of reads', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('soft-delete');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    server = await buildServer();
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('an opportunity list counts only live tasks', async () => {
    const suffix = randomUUID().slice(0, 8);
    const opp = await prisma.opportunity.create({
      data: {
        orgId: orgId!,
        code: `OP-SD${suffix}`,
        customer: 'Harbor Synthetic Co',
        name: `Soft delete count ${suffix}`,
        stage: 's1_lead',
        valueMicros: 0n,
        probability: 10,
        industry: 'logistics',
      },
      select: { id: true },
    });
    const live = await prisma.task.create({
      data: { orgId: orgId!, oppId: opp.id, title: `Live task ${suffix}` },
      select: { id: true },
    });
    const gone = await prisma.task.create({
      data: { orgId: orgId!, oppId: opp.id, title: `Deleted task ${suffix}` },
      select: { id: true },
    });
    await prisma.task.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/opportunities?limit=200',
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: Array<{ id: string; taskCount: number }> }).items;
    const row = items.find((item) => item.id === opp.id);
    expect(row?.taskCount).toBe(1);
    expect(live.id).not.toBe(gone.id);
  });

  skipIfNoDb('proposal analytics omit a soft-deleted opportunity value', async () => {
    const before = await server.inject({
      method: 'GET',
      url: '/api/v1/proposals/admin/analytics',
    });
    expect(before.statusCode, before.body).toBe(200);
    const beforeTotal = BigInt(
      (before.json() as { totalValueMicros: string }).totalValueMicros,
    );

    const suffix = randomUUID().slice(0, 8);
    const opp = await prisma.opportunity.create({
      data: {
        orgId: orgId!,
        code: `OP-PA${suffix}`,
        customer: 'Harbor Synthetic Co',
        name: `Analytics deal ${suffix}`,
        stage: 's2_sent',
        valueMicros: DEAL_MICROS,
        probability: 40,
        industry: 'logistics',
      },
      select: { id: true },
    });
    await prisma.proposal.create({
      data: {
        orgId: orgId!,
        name: `Harbor proposal ${suffix}`,
        opportunityId: opp.id,
      },
    });

    const linked = await server.inject({
      method: 'GET',
      url: '/api/v1/proposals/admin/analytics',
    });
    expect(linked.statusCode, linked.body).toBe(200);
    const linkedTotal = BigInt(
      (linked.json() as { totalValueMicros: string }).totalValueMicros,
    );
    expect(linkedTotal - beforeTotal).toBe(DEAL_MICROS);

    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { deletedAt: new Date() },
    });

    const after = await server.inject({
      method: 'GET',
      url: '/api/v1/proposals/admin/analytics',
    });
    expect(after.statusCode, after.body).toBe(200);
    const afterTotal = BigInt((after.json() as { totalValueMicros: string }).totalValueMicros);
    expect(linkedTotal - afterTotal).toBe(DEAL_MICROS);
  });

  skipIfNoDb('deleting a company hides it as a parent and clears the child link', async () => {
    const suffix = randomUUID().slice(0, 8);
    const parent = await prisma.company.create({
      data: { orgId: orgId!, name: `${PARENT_NAME} ${suffix}` },
      select: { id: true },
    });
    const child = await prisma.company.create({
      data: { orgId: orgId!, name: `Harbor Child Synthetic ${suffix}`, parentId: parent.id },
      select: { id: true },
    });
    const liveParent = await prisma.company.create({
      data: { orgId: orgId!, name: `Harbor Live Parent ${suffix}` },
      select: { id: true },
    });
    const liveChild = await prisma.company.create({
      data: {
        orgId: orgId!,
        name: `Harbor Live Child ${suffix}`,
        parentId: liveParent.id,
      },
      select: { id: true },
    });

    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${parent.id}`,
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const detail = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${child.id}`,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.body).not.toContain(PARENT_NAME);
    expect(detail.json()).toMatchObject({ parent: null, parentId: null });

    const stillLinked = await server.inject({
      method: 'GET',
      url: `/api/v1/companies/${liveChild.id}`,
    });
    expect(stillLinked.statusCode, stillLinked.body).toBe(200);
    expect(stillLinked.json()).toMatchObject({
      parentId: liveParent.id,
      parent: { id: liveParent.id, name: `Harbor Live Parent ${suffix}` },
    });
  });
});
