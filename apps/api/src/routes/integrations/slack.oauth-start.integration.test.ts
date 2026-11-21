// WHY: Slack OAuth start seals its state with the integration token key.
// A missing key is "not configured", the same 503 contract Gmail uses when
// its OAuth app is absent. A plain Error here becomes a generic 500.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';

import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../../test-support/isolated-org.js';

describe('GET /integrations/slack/oauth/start', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let isolated: IsolatedOrg;
  let restoreAuth: () => void;

  beforeAll(async () => {
    isolated = await createIsolatedOrg('slack-oauth-start');
    restoreAuth = useIsolatedOrgAuth(isolated.clerkOrg);
    server = await buildServer();
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    if (server) await server.close();
    restoreAuth?.();
    if (isolated) await dropIsolatedOrg(isolated.orgId);
  });

  it('answers 503 not configured when the integration token key is unset', async () => {
    const previous = process.env.INTEGRATION_TOKEN_KEY;
    delete process.env.INTEGRATION_TOKEN_KEY;
    _resetIntegrationTokenKey();
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/integrations/slack/oauth/start',
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Integration token encryption is not configured',
      });
      expect(res.body).not.toContain('INTEGRATION_TOKEN_KEY');
    } finally {
      if (previous === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
      else process.env.INTEGRATION_TOKEN_KEY = previous;
      _resetIntegrationTokenKey();
    }
  });
});
