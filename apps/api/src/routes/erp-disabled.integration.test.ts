/**
 * With ERP_ENABLED off, the ERP surface stays unregistered except for the
 * status probe, which answers "not configured" so the settings card does not
 * log a 404 for every visitor.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId = '';
let restoreAuth: (() => void) | null = null;
const previous = process.env.ERP_ENABLED;

beforeAll(async () => {
  delete process.env.ERP_ENABLED;
  const org = await createIsolatedOrg('erpoff');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (previous === undefined) delete process.env.ERP_ENABLED;
  else process.env.ERP_ENABLED = previous;
});

describe('ERP surface when disabled', () => {
  it('answers the status probe with not configured', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/integrations/erp/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      configured: false,
      url: null,
      database: null,
      reachable: false,
      toolCount: null,
      lastError: null,
    });
  });

  it('keeps every other ERP route unregistered', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/integrations/erp/presales-kit' });
    expect(res.statusCode).toBe(404);
  });
});
