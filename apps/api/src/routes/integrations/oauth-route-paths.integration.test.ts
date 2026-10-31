/**
 * Regression: the Gmail / Microsoft Mail / Slack OAuth and Graph webhook plugins declare their
 * paths as '/integrations/...'. They were registered under an
 * '/api/v1/integrations' prefix, which produced '/api/v1/integrations/
 * integrations/...' routes while the OAuth redirect_uri defaults and the web
 * client call '/api/v1/integrations/<provider>/...' (404 in practice).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../../server.js';

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
});

const EXPECTED: Array<['GET' | 'DELETE' | 'POST', string]> = [
  ['GET', '/api/v1/integrations/gmail/oauth/start'],
  ['GET', '/api/v1/integrations/gmail/oauth/callback'],
  ['DELETE', '/api/v1/integrations/gmail/disconnect'],
  ['GET', '/api/v1/integrations/microsoft/mail/oauth/start'],
  ['GET', '/api/v1/integrations/microsoft/mail/oauth/callback'],
  ['DELETE', '/api/v1/integrations/microsoft/mail/disconnect'],
  ['GET', '/api/v1/integrations/slack/oauth/start'],
  ['GET', '/api/v1/integrations/slack/oauth/callback'],
  ['DELETE', '/api/v1/integrations/slack/disconnect'],
  ['POST', '/api/v1/integrations/slack/events'],
  // Graph subscriptions are created with this notificationUrl.
  ['GET', '/api/v1/integrations/microsoft/webhook'],
  ['POST', '/api/v1/integrations/microsoft/webhook'],
];

describe('integration OAuth route paths', () => {
  it.each(EXPECTED)('%s %s is registered where the client and redirect_uri expect it', (method, url) => {
    expect(server.hasRoute({ method, url })).toBe(true);
  });

  it('no route carries a doubled /integrations/integrations segment', () => {
    expect(server.printRoutes({ commonPrefix: false })).not.toContain('integrations/integrations');
  });
});
