/**
 * Secure-by-default read gates (issue #28 and the route-authz census).
 *
 * Real RBAC decisions against the seeded system roles: a role WITHOUT the
 * resource's :read permission gets 403, a role with it gets through.
 */
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
  const org = await createIsolatedOrg('rbac-read-gates');
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

function get(url: string, role: string) {
  return server.inject({ method: 'GET', url, headers: { 'x-bidstack-e2e-role': role } });
}

// [url, role that lacks the permission, role that holds it]
const CASES: Array<[string, string, string]> = [
  ['/api/v1/leads', 'customer-success', 'sdr'], // #28
  ['/api/v1/opportunities', 'sdr', 'account-executive'],
  ['/api/v1/opportunities/count', 'sdr', 'customer-success'],
  ['/api/v1/opportunities/export', 'sdr', 'account-executive'],
  ['/api/v1/forecasts/projection', 'sdr', 'account-executive'],
  ['/api/v1/proposals', 'sdr', 'account-executive'],
  ['/api/v1/dashboards', 'sdr', 'customer-success'],
  ['/api/v1/service-cases', 'account-executive', 'customer-success'],
  ['/api/v1/document-templates', 'account-executive', 'read-only'],
  ['/api/v1/migrations', 'account-executive', 'read-only'],
  ['/api/v1/territories/analytics', 'account-executive', 'sales-manager'],
  ['/api/v1/integrations/webhooks', 'account-executive', 'read-only'],
];

describe('secure-by-default read gates', () => {
  it.each(CASES)('GET %s: %s -> 403, %s -> allowed', async (url, denied, allowed) => {
    const deny = await get(url, denied);
    expect(deny.statusCode, deny.body).toBe(403);
    const ok = await get(url, allowed);
    expect(ok.statusCode, ok.body).not.toBe(403);
    expect(ok.statusCode, ok.body).toBeLessThan(500);
  });

  it('admin still reads leads (#28 does not lock out full roles)', async () => {
    const res = await get('/api/v1/leads', 'admin');
    expect(res.statusCode, res.body).toBe(200);
  });

});
