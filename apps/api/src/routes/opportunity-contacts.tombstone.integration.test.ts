// The buying-committee list includes the contact. Soft-delete middleware does
// not filter that nested relation, so a deleted contact stayed on the deal.
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
let liveContactId = '';
let deletedContactId = '';

describe('opportunity contacts hide a soft-deleted contact', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    const org = await createIsolatedOrg('opp-contact-tomb');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
    opportunityId = (
      await prisma.opportunity.findFirstOrThrow({ where: { orgId }, select: { id: true } })
    ).id;
    const live = await prisma.contact.create({
      data: { orgId, customer: 'Acme', name: 'Live Buyer' },
    });
    const deleted = await prisma.contact.create({
      data: { orgId, customer: 'Acme', name: 'Deleted Buyer' },
    });
    liveContactId = live.id;
    deletedContactId = deleted.id;
    await prisma.opportunityContact.createMany({
      data: [
        { orgId, opportunityId, contactId: live.id, role: 'champion' },
        { orgId, opportunityId, contactId: deleted.id, role: 'influencer' },
      ],
    });
    await prisma.contact.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    restoreAuth?.();
    if (orgId) await dropIsolatedOrg(orgId);
  });

  const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

  skipIfNoDb('omits the deleted contact and keeps the live one', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/opportunities/${opportunityId}/contacts`,
      headers: { authorization: 'Bearer stub' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const ids = (res.json() as { items: Array<{ contactId: string }> }).items.map((i) => i.contactId);
    expect(ids).toContain(liveContactId);
    expect(ids).not.toContain(deletedContactId);
  });
});
