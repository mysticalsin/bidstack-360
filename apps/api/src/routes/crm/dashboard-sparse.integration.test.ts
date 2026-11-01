// Regression: an account with no opportunities or enrichment yet (a new, imported or
// sparse account) must still get a cockpit from GET /crm/dashboard?account=, instead of
// a 404 that the account page shows as "Couldn't load the account cockpit".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../../lib/access-scope.js';
import { buildServer } from '../../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../../test-support/isolated-org.js';

const TAG = `dsp${Date.now()}`;
let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
const c: Record<string, string> = {};

const dash = (account: string) =>
  server.inject({ method: 'GET', url: `/api/v1/crm/dashboard?account=${encodeURIComponent(account)}` });

beforeAll(async () => {
  orgA = await createIsolatedOrg('dsp-a');
  orgB = await createIsolatedOrg('dsp-b');
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  c.sparse = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Example Corp`, domain: 'example.com', countryCode: 'BR' } })).id;
  c.bare = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Bare Account` } })).id;
  c.deleted = (await prisma.company.create({ data: { orgId: orgA.orgId, name: `${TAG} Gone`, deletedAt: new Date() } })).id;
  c.otherOrg = (await prisma.company.create({ data: { orgId: orgB.orgId, name: `${TAG} Other Org` } })).id;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  for (const o of [orgA, orgB]) {
    invalidateAccessScope(o.orgId);
    if (o.orgId) await dropIsolatedOrg(o.orgId);
  }
});

describe('crm dashboard for a sparse account', () => {
  it('builds the cockpit for an account with no opportunities, contacts or enrichment', async () => {
    const res = await dash(c.sparse!);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cockpit.company.id).toBe(c.sparse);
    expect(body.cockpit.company.name).toBe(`${TAG} Example Corp`);
    expect(body.cockpit.company.domain).toBe('example.com');
    expect(body.companies.some((x: { id: string }) => x.id === c.sparse)).toBe(true);
  });

  it('works for a bare account with only a name, and by exact name', async () => {
    const byId = await dash(c.bare!);
    expect(byId.statusCode).toBe(200);
    expect(byId.json().cockpit.company.id).toBe(c.bare);
    const byName = await dash(`${TAG} bare account`);
    expect(byName.statusCode).toBe(200);
    expect(byName.json().cockpit.company.id).toBe(c.bare);
  });

  it('still 404s for a deleted account, another org account or an unknown id', async () => {
    expect((await dash(c.deleted!)).statusCode).toBe(404);
    expect((await dash(c.otherOrg!)).statusCode).toBe(404);
    expect((await dash('c9999999-0000-4000-8000-000000000999')).statusCode).toBe(404);
  });
});
