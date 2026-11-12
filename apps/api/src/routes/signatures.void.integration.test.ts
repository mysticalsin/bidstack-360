// WHY: the void route's response is what callers see. A findMany without a
// bound is committed, then the query guard replaces 204 and 500 with 400.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';

const docusign = vi.hoisted(() => ({ on: false }));

vi.mock('../env.js', async (importOriginal) => {
  const actual = (await importOriginal()) as { getEnv: () => { DOCUSIGN_ACCOUNT_ID?: string } };
  return {
    ...actual,
    getEnv: () => {
      const env = actual.getEnv();
      if (!docusign.on) return env;
      return { ...env, DOCUSIGN_ACCOUNT_ID: 'acct-http' };
    },
  };
});

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('sig-void-http');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
  docusign.on = false;
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('void signature route', () => {
  t('a successful void answers 204', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const document = await prisma.document.create({
      data: { orgId: org.orgId, name: 'proposal.pdf', kind: 'proposal', storageUrl: `s3://test/${ns}` },
    });
    const request = await prisma.signatureRequest.create({
      data: {
        orgId: org.orgId,
        documentId: document.id,
        provider: 'INTERNAL',
        status: 'SENT',
        recipients: [],
      },
    });
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/signatures/requests/${request.id}/void`,
      payload: { reason: 'withdrawn' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).not.toContain('Unbounded queries');
    const stored = await prisma.signatureRequest.findUnique({
      where: { id: request.id },
      select: { status: true },
    });
    expect(stored?.status).toBe('VOIDED');
  });

  t('a provider failure answers 500', async () => {
    // WHY: DocuSign rejecting the void must not be reported as a bad request.
    // The row goes back to the status it had.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const document = await prisma.document.create({
      data: { orgId: org.orgId, name: 'proposal.pdf', kind: 'proposal', storageUrl: `s3://test/${ns}` },
    });
    const request = await prisma.signatureRequest.create({
      data: {
        orgId: org.orgId,
        documentId: document.id,
        provider: 'DOCUSIGN',
        providerRequestId: `env-${ns}`,
        status: 'SENT',
        recipients: [],
      },
    });
    docusign.on = true;
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/signatures/requests/${request.id}/void`,
      payload: { reason: 'withdrawn' },
    });
    docusign.on = false;
    expect(res.statusCode).toBe(500);
    expect(res.json<{ message: string }>().message).toBe('Something went wrong');
    expect(res.body).not.toContain('Unbounded queries');
    expect(res.body).not.toContain('DocuSign');
    const stored = await prisma.signatureRequest.findUnique({
      where: { id: request.id },
      select: { status: true, voidReason: true },
    });
    expect(stored).toMatchObject({ status: 'SENT', voidReason: null });
  });
});
