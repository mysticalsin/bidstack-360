/**
 * Role read restore (approved by Tony Walteur, 2026-10-31 14:47 BRT).
 *
 * The secure-by-default read gates removed reads that three seeded system
 * roles relied on. Migration 20261031180000_restore_role_read_grants and the
 * seed give them back:
 *
 *   SDR               opportunities, proposals, reports
 *   Customer Success  leads
 *   Account Executive documents, territory analytics, migrations
 *
 * Each role must be able to read those resources again and must still be
 * refused every write on them. Writes are probed with DELETE on a random id:
 * there is no body to validate, so the permission gate answers before any
 * lookup could return 404.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousRoleHeader: string | undefined;

beforeAll(async () => {
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  const org = await createIsolatedOrg('role-read-restore');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  if (orgId) await dropIsolatedOrg(orgId);
});

function call(method: 'GET' | 'DELETE', url: string, role: string) {
  return server.inject({ method, url, headers: { 'x-bidstack-e2e-role': role } });
}

// [stub header role, GET url that must be readable]
const READS: Array<[string, string]> = [
  ['sdr', '/api/v1/opportunities'],
  ['sdr', '/api/v1/opportunities/count'],
  ['sdr', '/api/v1/forecasts/projection'],
  ['sdr', '/api/v1/proposals'],
  ['sdr', '/api/v1/reports'],
  ['sdr', '/api/v1/dashboards'],
  ['customer-success', '/api/v1/leads'],
  ['account-executive', '/api/v1/document-templates'],
  ['account-executive', '/api/v1/territories/analytics'],
  ['account-executive', '/api/v1/migrations'],
  ['account-executive', '/api/v1/migrations/mappings'],
];

// [stub header role, DELETE url (":id" is replaced by a random uuid)]
const WRITES: Array<[string, string]> = [
  ['sdr', '/api/v1/opportunities/:id'],
  ['sdr', '/api/v1/proposals/:id'],
  ['sdr', '/api/v1/reports/:id'],
  ['sdr', '/api/v1/dashboards/:id'],
  ['customer-success', '/api/v1/leads/:id'],
  ['account-executive', '/api/v1/document-templates/:id'],
  ['account-executive', '/api/v1/territories/:id'],
  ['account-executive', '/api/v1/migrations/:id/cancel'],
  ['account-executive', '/api/v1/migrations/:id/undo'],
];

describe('restored role reads', () => {
  it.each(READS)('%s can GET %s again', async (role, url) => {
    const res = await call('GET', url, role);
    expect(res.statusCode, res.body).not.toBe(403);
    expect(res.statusCode, res.body).toBeLessThan(500);
  });

  it.each(WRITES)('%s still cannot DELETE %s', async (role, url) => {
    const res = await call('DELETE', url.replace(':id', randomUUID()), role);
    expect(res.statusCode, res.body).toBe(403);
  });

  it('account-executive gets migrations without the wider settings reads', async () => {
    expect((await call('GET', '/api/v1/migrations', 'account-executive')).statusCode).not.toBe(403);
    expect((await call('GET', '/api/v1/org-settings/stage-gate', 'account-executive')).statusCode).toBe(403);
    expect((await call('GET', '/api/v1/roles', 'account-executive')).statusCode).toBe(403);
  });
});
