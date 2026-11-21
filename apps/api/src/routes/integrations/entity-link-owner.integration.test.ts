// SMS and email sends store entityId with no org check. Harbor can name Quay's
// contact on the message. The route must 404 that id before any provider call.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: FastifyInstance;
let dbReachable = false;
let harborOrgId: string | null = null;
let quayOrgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let harborContactId = '';
let quayContactId = '';

describe('outbound message entity ownership', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const harbor = await createIsolatedOrg('harbor-msg');
    const quay = await createIsolatedOrg('quay-msg');
    harborOrgId = harbor.orgId;
    quayOrgId = quay.orgId;
    restoreAuth = useIsolatedOrgAuth(harbor.clerkOrg);
    harborContactId = (
      await prisma.contact.create({
        data: { orgId: harbor.orgId, customer: 'Harbor Synthetic Co', name: 'Harbor Buyer' },
        select: { id: true },
      })
    ).id;
    quayContactId = (
      await prisma.contact.create({
        data: { orgId: quay.orgId, customer: 'Quay Synthetic Ltd', name: 'Quay Buyer' },
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

  skipIfNoDb('SMS send 404s another org contact and stores nothing', async () => {
    const foreign = await server.inject({
      method: 'POST',
      url: '/api/v1/sms/send',
      payload: {
        toNumber: '+15555550123',
        body: 'Harbor ping',
        entityType: 'CONTACT',
        entityId: quayContactId,
      },
    });
    expect(foreign.statusCode, foreign.body).toBe(404);
    const linked = await prisma.smsMessage.count({
      where: { orgId: harborOrgId!, entityId: quayContactId },
    });
    expect(linked).toBe(0);

    const own = await server.inject({
      method: 'POST',
      url: '/api/v1/sms/send',
      payload: {
        toNumber: '+15555550123',
        body: 'Harbor ping',
        entityType: 'CONTACT',
        entityId: harborContactId,
      },
    });
    expect(own.statusCode, own.body).not.toBe(404);
  });

  skipIfNoDb('email send 404s another org contact and stores nothing', async () => {
    const foreign = await server.inject({
      method: 'POST',
      url: '/api/v1/email/send',
      payload: {
        to: [{ email: 'buyer@quay-synthetic.test' }],
        subject: 'Harbor note',
        text: 'Synthetic',
        entityType: 'contact',
        entityId: quayContactId,
      },
    });
    expect(foreign.statusCode, foreign.body).toBe(404);
    const linked = await prisma.emailMessage.count({
      where: { orgId: harborOrgId!, entityId: quayContactId },
    });
    expect(linked).toBe(0);

    const own = await server.inject({
      method: 'POST',
      url: '/api/v1/email/send',
      payload: {
        to: [{ email: 'buyer@harbor-synthetic.test' }],
        subject: 'Harbor note',
        text: 'Synthetic',
        entityType: 'contact',
        entityId: harborContactId,
      },
    });
    expect(own.statusCode, own.body).not.toBe(404);
  });
});
