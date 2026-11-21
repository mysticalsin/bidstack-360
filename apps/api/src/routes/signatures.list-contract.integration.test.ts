// The web list sends SignatureRequestFilter and reads SignatureRequestPage.
// dateFrom must drop older rows, a lowercase stored role must come back as
// SIGNER, and the page must carry nextCursor and total.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import { SignatureRequestPage } from '@bidstack/shared';

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
let oldId = '';
let foreignId = '';

describe('signature list contract', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('sig-list');
    const other = await createIsolatedOrg('sig-list-b');
    orgId = org.orgId;
    otherOrgId = other.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    const document = await prisma.document.create({
      data: { orgId, name: 'Order form', kind: 'proposal', storageUrl: 'synthetic://order' },
    });
    const old = await prisma.signatureRequest.create({
      data: {
        orgId,
        documentId: document.id,
        status: 'SENT',
        recipients: [{ email: 'a@example.com', name: 'A', role: 'signer' }],
        createdAt: new Date('2020-01-15T00:00:00.000Z'),
      },
    });
    oldId = old.id;
    const foreignDoc = await prisma.document.create({
      data: {
        orgId: other.orgId,
        name: 'Foreign',
        kind: 'proposal',
        storageUrl: 'synthetic://foreign',
      },
    });
    foreignId = (
      await prisma.signatureRequest.create({
        data: {
          orgId: other.orgId,
          documentId: foreignDoc.id,
          status: 'SENT',
          recipients: [{ email: 'b@example.com', name: 'B', role: 'SIGNER' }],
        },
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

  skipIfNoDb('dateFrom drops the old row, and the role matches the shared enum', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/signatures/requests?dateFrom=2026-01-01&limit=10',
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = SignatureRequestPage.parse(res.json());
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.items.some((item) => item.id === oldId)).toBe(false);
  });

  skipIfNoDb('a stored signer role is returned as SIGNER', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/signatures/requests?dateTo=2020-12-31&limit=10',
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = SignatureRequestPage.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(oldId);
    expect(body.items[0]?.recipients[0]?.role).toBe('SIGNER');
  });

  skipIfNoDb('another org signature id is 404', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/signatures/requests/${foreignId}`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('b@example.com');
  });
});
