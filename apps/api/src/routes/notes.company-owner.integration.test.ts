// Notes.companyId is a foreign key with no org in the key. An admin's account
// check returns immediately, so Harbor can store Quay's company id on a note.
// That row keeps Quay's company from being removed and ties Harbor's note to
// Quay's account.
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

const QUAY = 'Quay Synthetic Ltd';

let server: FastifyInstance;
let dbReachable = false;
let harborOrgId: string | null = null;
let quayOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let harborCompanyId = '';
let quayCompanyId = '';

describe('note company ownership', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const harbor = await createIsolatedOrg('harbor-note');
    const quay = await createIsolatedOrg('quay-note');
    harborOrgId = harbor.orgId;
    quayOrgId = quay.orgId;
    restoreAuth = useIsolatedOrgAuth(harbor.clerkOrg);
    harborCompanyId = (
      await prisma.company.create({
        data: { orgId: harbor.orgId, name: 'Harbor Synthetic Co' },
        select: { id: true },
      })
    ).id;
    quayCompanyId = (
      await prisma.company.create({
        data: { orgId: quay.orgId, name: QUAY },
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

  skipIfNoDb('create refuses another org company and stores nothing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: {
        accountId: 'harbor-synthetic',
        companyId: quayCompanyId,
        title: 'Berth note',
        bodyMd: 'Synthetic note body',
      },
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(res.body).not.toContain(QUAY);
    const linked = await prisma.note.count({
      where: { orgId: harborOrgId!, companyId: quayCompanyId },
    });
    expect(linked).toBe(0);
  });

  skipIfNoDb('meeting import refuses another org company and stores nothing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/notes/import-meeting',
      payload: {
        accountId: 'harbor-synthetic',
        companyId: quayCompanyId,
        companyName: 'Harbor Synthetic Co',
        title: 'Quay meeting',
        bodyMd: 'Synthetic meeting notes for the berth.',
      },
    });
    expect(res.statusCode, res.body).toBe(404);
    const linked = await prisma.note.count({
      where: { orgId: harborOrgId!, companyId: quayCompanyId },
    });
    expect(linked).toBe(0);
  });

  skipIfNoDb('create stores a company in the caller org', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: {
        accountId: 'harbor-synthetic',
        companyId: harborCompanyId,
        title: 'Home note',
        bodyMd: 'Synthetic note on Harbor',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ companyId: harborCompanyId, title: 'Home note' });
  });
});
