// Re-confirm of an intake draft loads the agreement by id only. A
// confirmedContractId that points at another org returned that org's companyId.
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
let draftId = '';
let foreignCompanyId = '';

describe('msa intake confirm stays in the org', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('msa-confirm');
    const other = await createIsolatedOrg('msa-confirm-b');
    orgId = org.orgId;
    otherOrgId = other.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const creator = await prisma.user.findFirstOrThrow({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const otherUser = await prisma.user.findFirstOrThrow({
      where: { orgId: other.orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const company = await prisma.company.findFirstOrThrow({
      where: { orgId: other.orgId },
      select: { id: true },
    });
    foreignCompanyId = company.id;
    const agreement = await prisma.contractAgreement.create({
      data: {
        orgId: other.orgId,
        accountKey: 'foreign-msa',
        reference: 'FOREIGN-MSA',
        createdById: otherUser.id,
        companyId: company.id,
      },
      select: { id: true },
    });
    const draft = await prisma.msaIntakeDraft.create({
      data: {
        orgId,
        status: 'confirmed',
        fileName: 'foreign.pdf',
        contentType: 'application/pdf',
        bytes: 4,
        sha256: 'a'.repeat(64),
        storageKey: 'synthetic/foreign.pdf',
        confirmedContractId: agreement.id,
        createdById: creator.id,
      },
      select: { id: true },
    });
    draftId = draft.id;
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

  skipIfNoDb('re-confirm of another org agreement is 404 and does not echo its company', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/msa/intake/${draftId}/confirm`,
      headers: { authorization: 'Bearer stub' },
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(res.body).not.toContain(foreignCompanyId);
  });
});
