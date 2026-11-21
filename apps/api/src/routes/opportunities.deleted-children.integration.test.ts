// GET /opportunities/:id includes tasks and documents. The soft-delete
// middleware only injects deletedAt on the top-level where, so a tombstoned
// task or file was still coming back on the deal.
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
let opportunityId = '';
let liveTaskId = '';
let deletedTaskId = '';
let liveDocumentId = '';
let deletedDocumentId = '';

describe('opportunity detail hides soft-deleted children', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('opp-tombstone');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    opportunityId = (
      await prisma.opportunity.findFirstOrThrow({ where: { orgId }, select: { id: true } })
    ).id;
    const liveTask = await prisma.task.create({
      data: { orgId, oppId: opportunityId, title: 'Live task' },
    });
    const deletedTask = await prisma.task.create({
      data: { orgId, oppId: opportunityId, title: 'Deleted task' },
    });
    liveTaskId = liveTask.id;
    deletedTaskId = deletedTask.id;
    await prisma.task.update({ where: { id: deletedTaskId }, data: { deletedAt: new Date() } });
    const liveDoc = await prisma.document.create({
      data: {
        orgId,
        oppId: opportunityId,
        name: 'Live file',
        kind: 'rfp',
        storageUrl: 'synthetic://live',
      },
    });
    const deletedDoc = await prisma.document.create({
      data: {
        orgId,
        oppId: opportunityId,
        name: 'Deleted file',
        kind: 'rfp',
        storageUrl: 'synthetic://deleted',
      },
    });
    liveDocumentId = liveDoc.id;
    deletedDocumentId = deletedDoc.id;
    await prisma.document.update({
      where: { id: deletedDocumentId },
      data: { deletedAt: new Date() },
    });
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('omits a soft-deleted task and document, and keeps the live ones', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opportunityId}`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasks: Array<{ id: string }>;
      documents: Array<{ id: string }>;
    };
    const taskIds = body.tasks.map((t) => t.id);
    const documentIds = body.documents.map((d) => d.id);
    expect(taskIds).toContain(liveTaskId);
    expect(taskIds).not.toContain(deletedTaskId);
    expect(documentIds).toContain(liveDocumentId);
    expect(documentIds).not.toContain(deletedDocumentId);
  });
});
