/**
 * Workspace account cards: Google Workspace and Microsoft 365.
 *
 *   GET    /integrations/workspace                     one card per provider
 *   POST   /integrations/workspace/:provider/connect   consent URL (read-only scopes)
 *   DELETE /integrations/workspace/:provider           revoke and wipe the grant
 *
 * Every route acts on the caller's own mailbox only (org + user from auth).
 * The OAuth callbacks stay on the URIs registered with each provider:
 * /integrations/gmail/oauth/callback and /integrations/microsoft/mail/oauth/callback.
 */
import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  NotConfigured,
  WorkspaceNotConfiguredError,
  buildConnectUrl,
  disconnectWorkspace,
  listWorkspaceCards,
  notConfiguredBody,
} from '../../services/workspace-connect.service.js';

const Provider = z.object({ provider: z.enum(['google', 'microsoft']) });

const Card = z.object({
  provider: z.enum(['google', 'microsoft']),
  configured: z.boolean(),
  status: z.enum(['connected', 'disconnected', 'error', 'revoked']),
  accountEmail: z.string().nullable(),
  scopes: z.array(
    z.object({ key: z.string(), label: z.string(), access: z.enum(['read', 'write']) }),
  ),
  lastSyncedAt: z.string().nullable(),
  connectedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const workspaceRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  app.get('/integrations/workspace', {
    schema: { response: { 200: z.object({ providers: z.array(Card) }) } },
    handler: async (req) => ({ providers: await listWorkspaceCards(req.auth.orgId, req.auth.userId) }),
  });

  app.post('/integrations/workspace/:provider/connect', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      params: Provider,
      response: { 200: z.object({ authUrl: z.string().url() }), 503: NotConfigured },
    },
    handler: async (req, reply) => {
      try {
        return reply.send({ authUrl: await buildConnectUrl(req.params.provider, req.auth.orgId, req.auth.userId) });
      } catch (err) {
        if (err instanceof WorkspaceNotConfiguredError) return reply.status(503).send(notConfiguredBody(err));
        throw err;
      }
    },
  });

  app.delete('/integrations/workspace/:provider', {
    schema: { params: Provider, response: { 204: z.null() } },
    handler: async (req, reply) => {
      await disconnectWorkspace(req.params.provider, req.auth.orgId, req.auth.userId, req.log);
      return reply.status(204).send(null);
    },
  });
};
